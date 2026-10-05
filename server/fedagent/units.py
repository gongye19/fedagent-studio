"""工作单元的读和写：平台执行的单元和本地客户端提交的单元用同一段代码保存结果。

读（StepIO）：私有中间结果、收件箱、产出、样本；写：一个事务里保存私有中间结果、消息、上报值、判分结果、产出，
并把单元标为完成。跨站点的消息同时追加到运行目录（通信记录，便于审计和导出）。
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fedagent_sdk import SERVER, Artifact, Item, Manifest, Message, StepDef, TaskType, UnitResult
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from . import models as m
from .data import to_item


@dataclass(frozen=True)
class SiteView:
    """任务里的一方（从 task_sites 读出的快照）。"""

    id: str
    kind: str
    role: str
    executor: str
    participant_id: str | None
    label: str
    dataset_id: str | None
    dataset_name: str
    dataset_hash: str | None
    items: tuple[str, ...]
    labeled: int
    model_ref: str | None

    @classmethod
    def of(cls, row: m.TaskSite) -> SiteView:
        return cls(
            id=row.id,
            kind=row.kind,
            role=row.role,
            executor=row.executor,
            participant_id=row.participant_id,
            label=row.participant_name or ("服务端" if row.kind == "server" else row.id),
            dataset_id=row.dataset_id,
            dataset_name=row.dataset_name,
            dataset_hash=row.dataset_hash,
            items=tuple(str(item) for item in row.items or ()),
            labeled=row.labeled,
            model_ref=row.model_ref,
        )


def load_sites(session: Session, task_id: str) -> list[SiteView]:
    rows = session.scalars(select(m.TaskSite).where(m.TaskSite.task_id == task_id).order_by(m.TaskSite.ordinal)).all()
    return [SiteView.of(row) for row in rows]


def to_message(row: m.Message) -> Message:
    return Message(
        id=str(row.id),
        channel=row.channel,
        round=row.round,
        step=row.step,
        sender=row.sender_site,
        sender_role=row.sender_role,
        payload=row.payload,
        item_id=row.item_id,
    )


def inbox(session: Session, task_id: str, site: SiteView, channel: str, round: int) -> list[Message]:
    """发给这一方的消息。按发送方在任务里的顺序、步骤、样本在数据集里的顺序排，和各单元完成的先后无关：
    并发执行时先完成的单元先写入，如果按写入顺序，续跑和一次跑完时汇总步骤读到的顺序会不一样。
    同一个单元发出的几条保持发出的顺序。"""
    rows = session.scalars(
        select(m.Message).where(
            m.Message.task_id == task_id,
            m.Message.round == round,
            m.Message.channel == channel,
            or_(m.Message.receiver_site == site.id, m.Message.receiver_role == site.role),
        )
    ).all()
    sites = load_sites(session, task_id)
    position = {view.id: index for index, view in enumerate(sites)}
    item_order = {view.id: {item: index for index, item in enumerate(view.items)} for view in sites}

    def order(row: m.Message) -> tuple[int, str, int, int]:
        items = item_order.get(row.sender_site, {})
        item = items.get(row.item_id, len(items)) if row.item_id is not None else -1
        return position.get(row.sender_site, len(position)), row.step, item, row.id

    return [to_message(row) for row in sorted(rows, key=order)]


def latest_artifact(session: Session, task_id: str, before_round: int) -> Artifact | None:
    row = session.scalars(
        select(m.Artifact).where(m.Artifact.task_id == task_id, m.Artifact.round < before_round).order_by(m.Artifact.version.desc()).limit(1)
    ).first()
    if row is None:
        return None
    return Artifact(version=row.version, round=row.round, kind=row.kind, content=row.content)


class DbStepIO:
    """平台托管的参与方和服务端的 StepIO：读数据库和数据集文件。"""

    def __init__(
        self,
        db: Any,
        task_id: str,
        site: SiteView,
        step: StepDef,
        task_type: TaskType,
        records: dict[str, dict[str, Any]] | None,
    ) -> None:
        self.db = db
        self.task_id = task_id
        self.site = site
        self.step = step
        self.task_type = task_type
        self.records = records or {}

    def recall(self, key: str, item_id: str | None, round: int) -> Any:
        with self.db.session() as session:
            row = session.get(m.SiteState, (self.task_id, self.site.id, round, key, item_id or ""))
            return None if row is None else row.value

    def inbox(self, channel: str, round: int) -> list[Message]:
        with self.db.session() as session:
            return inbox(session, self.task_id, self.site, channel, round)

    def artifact(self, before_round: int) -> Artifact | None:
        with self.db.session() as session:
            return latest_artifact(session, self.task_id, before_round)

    def items(self) -> list[Item]:
        return [to_item(self.task_type, self.records[item_id], labels=self.step.labels) for item_id in self.site.items if item_id in self.records]


def resolve_receiver(manifest: Manifest, channel: str, to: str | None, sites: dict[str, SiteView]) -> tuple[str | None, str | None]:
    """消息的接收方：发给服务端的写站点 server；指定了站点的写站点 id；否则发给角色里的每一方。"""
    target = manifest.channels[channel].to
    if target == SERVER:
        return SERVER, None
    if to is not None:
        site = sites.get(to)
        if site is None or site.role != target:
            raise ValueError(f"通道 {channel} 只能发给角色 {target}，{to} 不是")
        return to, None
    return None, target


@dataclass
class Graded:
    item_id: str
    labeled: bool
    correct: bool


def store_result(
    session: Session,
    *,
    unit: m.WorkUnit,
    manifest: Manifest,
    site: SiteView,
    sites: dict[str, SiteView],
    result: UnitResult,
    graded: list[Graded],
    plugin_version: str,
    keep_private: bool,
    run_dir: Path | None,
    expected: str,
    attempt: int | None = None,
) -> bool:
    """在一个事务里保存工作单元的全部结果，并把单元标为完成。

    先用一条条件更新把单元从 expected 状态（平台执行的是 running，客户端的是 claimed）改为完成；
    平台执行的单元还要是同一次尝试（attempt）。条件不满足说明别的执行已经保存过，或者这次执行已经过期
    （例如暂停后续跑，同一个单元又被领走了），这时什么都不保存，返回 False。
    """
    conditions = [m.WorkUnit.id == unit.id, m.WorkUnit.status == expected]
    if attempt is not None:
        conditions.append(m.WorkUnit.attempts == attempt)
    owned = session.execute(
        update(m.WorkUnit).where(*conditions).values(status="done", error=None, finished_at=m.now(), lease_until=None),
        execution_options={"synchronize_session": False},
    )
    if not owned.rowcount:  # type: ignore[attr-defined]
        return False
    session.refresh(unit)
    task_id, round, step = unit.task_id, unit.round, unit.step
    if keep_private:
        for key, item_id, value in result.kept:
            session.merge(m.SiteState(task_id=task_id, site_id=site.id, round=round, key=key, item_id=item_id or "", value=value))
    written: list[dict[str, Any]] = []
    for outgoing in result.sent:
        receiver_site, receiver_role = resolve_receiver(manifest, outgoing.channel, outgoing.to, sites)
        body = json.dumps(outgoing.payload, ensure_ascii=False, sort_keys=True)
        message = m.Message(
            task_id=task_id,
            round=round,
            step=step,
            channel=outgoing.channel,
            sender_site=site.id,
            sender_role=site.role,
            receiver_site=receiver_site,
            receiver_role=receiver_role,
            item_id=outgoing.item_id,
            payload=outgoing.payload,
            size=len(body.encode()),
            sha256=hashlib.sha256(body.encode()).hexdigest(),
        )
        session.add(message)
        written.append({"channel": outgoing.channel, "sender": site.id, "item_id": outgoing.item_id, "payload": outgoing.payload})
    for grade in graded:
        session.add(m.Report(task_id=task_id, round=round, step=step, site_id=site.id, unit_key=unit.unit_key, name="labeled", value=int(grade.labeled)))
        session.add(m.Report(task_id=task_id, round=round, step=step, site_id=site.id, unit_key=unit.unit_key, name="correct", value=int(grade.correct)))
    for name, value in result.reports.items():
        session.add(m.Report(task_id=task_id, round=round, step=step, site_id=site.id, unit_key=unit.unit_key, name=name, value=value))
    if result.has_published:
        if manifest.artifact is None:
            raise ValueError("清单没有声明产出")
        version = (session.scalar(select(func.max(m.Artifact.version)).where(m.Artifact.task_id == task_id)) or 0) + 1
        session.add(
            m.Artifact(task_id=task_id, version=version, round=round, kind=manifest.artifact.kind, content=result.published, plugin_version=plugin_version)
        )
        if run_dir is not None:
            path = run_dir / "artifacts" / f"v{version}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(result.published, ensure_ascii=False, indent=2), encoding="utf-8")
    if run_dir is not None and written:
        path = run_dir / "messages" / f"r{round}" / f"{step}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            for row in written:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    return True


def add_event(session: Session, task_id: str, kind: str, message: str, data: dict[str, Any] | None = None, run_dir: Path | None = None) -> None:
    session.add(m.Event(task_id=task_id, kind=kind, message=message, data=data))
    if run_dir is not None:
        run_dir.mkdir(parents=True, exist_ok=True)
        with (run_dir / "events.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"time": m.now().isoformat(), "kind": kind, "message": message, "data": data}, ensure_ascii=False) + "\n")
