"""参与方本地客户端的协议（通用，不认具体算法）。

令牌：平台签发、按参与方授权、可以吊销，只存哈希。客户端领取本方的工作单元（带租约，执行中心跳），
取这一步需要的输入（发给本方的消息、当前产出），在本地执行插件的代码，只提交消息、上报值和判分汇总；
私有的中间结果留在本地。提交的内容按清单再检查一次：只能发这一步声明的通道。
"""

from __future__ import annotations

import hashlib
import json
import secrets
from datetime import timedelta

from fedagent_sdk import OutgoingMessage, UnitResult
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from . import models as m
from .errors import ServiceError
from .platform import Platform
from .resources import new_id, not_found
from .schemas import ClientArtifact, ClientHelloIn, ClientMessage, ClientUnitOut, CompleteIn, FailIn, UnitInputsOut
from .units import Graded, inbox, latest_artifact, load_sites, resolve_receiver, store_result

MAX_MESSAGE_BYTES = 1_000_000


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token(session: Session, participant_id: str) -> tuple[m.ClientToken, str]:
    participant = session.get(m.Participant, participant_id)
    if participant is None:
        raise not_found("参与方")
    if participant.hosting != "local":
        raise ServiceError(409, "平台托管的参与方不需要客户端令牌")
    raw = "fat_" + secrets.token_urlsafe(32)
    token = m.ClientToken(id=new_id("ct"), participant_id=participant.id, token_hash=_hash(raw))
    session.add(token)
    session.flush()
    return token, raw


def authenticate(session: Session, raw: str | None) -> tuple[m.ClientToken, m.Participant]:
    if not raw:
        raise ServiceError(401, "缺少客户端令牌")
    token = session.scalars(select(m.ClientToken).where(m.ClientToken.token_hash == _hash(raw))).first()
    if token is None or token.revoked_at is not None:
        raise ServiceError(401, "客户端令牌无效或已吊销")
    participant = session.get(m.Participant, token.participant_id)
    if participant is None:
        raise ServiceError(401, "参与方不存在")
    token.last_used_at = m.now()
    participant.last_seen_at = m.now()
    return token, participant


def hello(session: Session, participant: m.Participant, body: ClientHelloIn) -> list[str]:
    """客户端连上：上报本地数据集的描述（样本数、带标注数、样本 id），不上传样本内容。"""
    updated = []
    participant.client_plugins = dict(body.plugins)
    for item in body.datasets:
        dataset = session.get(m.Dataset, item.dataset_id)
        if dataset is None or dataset.participant_id != participant.id or dataset.source != "local":
            raise ServiceError(422, f"数据集 {item.dataset_id} 不是这个参与方登记的本地数据集")
        ids = [str(value) for value in item.item_ids]
        if len(ids) != item.count or len(set(ids)) != len(ids) or any(not value.strip() for value in ids):
            raise ServiceError(422, f"数据集 {item.dataset_id} 的样本 id 数量不对或有重复")
        if item.answered > item.count:
            raise ServiceError(422, "带标注的样本数不能大于总样本数")
        dataset.count = item.count
        dataset.answered = min(item.answered, item.count)
        dataset.item_ids = ids
        updated.append(dataset.id)
    return updated


def _unit_out(platform: Platform, session: Session, unit: m.WorkUnit) -> ClientUnitOut:
    task = session.get(m.Task, unit.task_id)
    assert task is not None
    site = next(site for site in load_sites(session, task.id) if site.id == unit.site_id)
    config = task.config
    return ClientUnitOut(
        id=unit.id,
        attempt=unit.attempts,
        item_ids=[str(item) for item in site.items],
        task_id=task.id,
        round=unit.round,
        rounds=int(config["rounds"]),
        step=unit.step,
        site_id=site.id,
        role=site.role,
        unit_key=unit.unit_key,
        dataset_id=site.dataset_id,
        algorithm=task.algorithm,
        plugin_version=task.plugin_version,
        task_type=task.task_type,
        grader=str(config.get("grader") or platform.registry.task_type(task.task_type).graders[0]),
        params=dict(config.get("params") or {}),
        lease_until=unit.lease_until or m.now(),
    )


def claim(platform: Platform, session: Session, token: m.ClientToken, participant: m.Participant, limit: int) -> list[ClientUnitOut]:
    units = session.scalars(
        select(m.WorkUnit)
        .join(m.Task, m.Task.id == m.WorkUnit.task_id)
        .where(
            m.Task.status == "running",
            m.Task.command.is_(None),
            m.WorkUnit.executor == "client",
            m.WorkUnit.site_id == participant.id,
            m.WorkUnit.status == "pending",
        )
        .order_by(m.WorkUnit.id)
        .limit(limit)
    ).all()
    lease = m.now() + timedelta(seconds=platform.settings.client_lease_seconds)
    claimed = []
    for unit in units:
        owned = session.execute(
            update(m.WorkUnit).where(m.WorkUnit.id == unit.id, m.WorkUnit.status == "pending")
            .values(status="claimed", claimed_by=token.id, lease_until=lease, attempts=m.WorkUnit.attempts + 1, started_at=m.now()),
            execution_options={"synchronize_session": False},
        )
        if owned.rowcount:  # type: ignore[attr-defined]
            session.refresh(unit)
            claimed.append(unit)
    return [_unit_out(platform, session, unit) for unit in claimed]


def _claimed(
    session: Session, token: m.ClientToken, participant: m.Participant, unit_id: int, attempt: int, *, allow_done: bool = False,
) -> m.WorkUnit:
    unit = session.get(m.WorkUnit, unit_id)
    if unit is None or unit.site_id != participant.id or unit.executor != "client":
        raise not_found("工作单元")
    if unit.claimed_by != token.id or unit.attempts != attempt:
        raise ServiceError(409, "这次领取已过期，或者属于其他客户端")
    if allow_done and unit.status == "done":
        return unit  # 网络超时后重复提交同一次完成结果，确认成功但不重复保存。
    task = session.get(m.Task, unit.task_id)
    if unit.status != "claimed" or unit.lease_until is None or m.aware(unit.lease_until) <= m.now():
        raise ServiceError(409, "这个工作单元没有被领取，或者租约已经过期")
    if task is None or task.status != "running" or task.command is not None:
        raise ServiceError(409, "任务已暂停、取消，或者正在停止")
    return unit


def inputs(platform: Platform, session: Session, token: m.ClientToken, participant: m.Participant, unit_id: int, attempt: int) -> UnitInputsOut:
    unit = _claimed(session, token, participant, unit_id, attempt)
    task = session.get(m.Task, unit.task_id)
    assert task is not None
    manifest = platform.registry.algorithm(task.algorithm).manifest
    step = manifest.step(unit.step)
    assert step is not None
    site = next(site for site in load_sites(session, task.id) if site.id == unit.site_id)
    boxes = {channel: [ClientMessage(**message.__dict__) for message in inbox(session, task.id, site, channel, unit.round)] for channel in step.reads}
    artifact = None
    if manifest.artifact is not None and site.role in manifest.artifact.to:
        latest = latest_artifact(session, task.id, unit.round)
        if latest is not None:
            artifact = ClientArtifact(version=latest.version, round=latest.round, kind=latest.kind, content=latest.content)
    return UnitInputsOut(inbox=boxes, artifact=artifact)


def heartbeat(platform: Platform, session: Session, token: m.ClientToken, participant: m.Participant, unit_id: int, attempt: int) -> None:
    unit = _claimed(session, token, participant, unit_id, attempt)
    unit.lease_until = m.now() + timedelta(seconds=platform.settings.client_lease_seconds)


def complete(platform: Platform, session: Session, token: m.ClientToken, participant: m.Participant, unit_id: int, attempt: int, body: CompleteIn) -> None:
    unit = _claimed(session, token, participant, unit_id, attempt, allow_done=True)
    if unit.status == "done":
        return
    task = session.get(m.Task, unit.task_id)
    assert task is not None
    algorithm = platform.registry.algorithm(task.algorithm)
    manifest = algorithm.manifest
    step = manifest.step(unit.step)
    assert step is not None
    sites = {site.id: site for site in load_sites(session, task.id)}
    for sent in body.sent:
        if sent.channel not in step.sends:
            raise ServiceError(422, f"这一步没有声明发送通道 {sent.channel}")
        try:
            payload = json.dumps(sent.payload, ensure_ascii=False, allow_nan=False)
            resolve_receiver(manifest, sent.channel, sent.to, sites)
        except ValueError as error:
            raise ServiceError(422, str(error)) from error
        if len(payload.encode()) > MAX_MESSAGE_BYTES:
            raise ServiceError(413, "单条消息超过 1 MB")
        if step.per == "item" and sent.item_id not in (None, unit.unit_key):
            raise ServiceError(422, "消息对应的样本和工作单元不一致")
    if any(name in body.reports for name in ("labeled", "correct")):
        raise ServiceError(422, "判分汇总只能通过 graded 提交")
    grade_ids = [grade.item_id for grade in body.graded]
    if len(grade_ids) != len(set(grade_ids)) or any(grade.correct and not grade.labeled for grade in body.graded):
        raise ServiceError(422, "每条样本只能提交一次有效的判分结果")
    evaluation = manifest.evaluation
    if body.graded and (evaluation is None or evaluation.step != step.id):
        raise ServiceError(422, "这一步不是评估用的步骤")
    site = session.get(m.TaskSite, (task.id, unit.site_id))
    assert site is not None
    allowed = {unit.unit_key} if step.per == "item" else set(site.items)
    if any(grade.item_id not in allowed for grade in body.graded):
        raise ServiceError(422, "判分结果对应的样本和工作单元不一致")
    result = UnitResult(
        sent=[
            OutgoingMessage(channel=sent.channel, payload=sent.payload, item_id=sent.item_id or (unit.unit_key if step.per == "item" else None), to=sent.to)
            for sent in body.sent
        ],
        reports=dict(body.reports),
    )
    # 同一个单元重复提交（例如客户端超时后重试）时只保存第一次，后面的什么都不做
    store_result(
        session,
        unit=unit,
        manifest=manifest,
        site=sites[unit.site_id],
        sites=sites,
        result=result,
        graded=[Graded(grade.item_id, grade.labeled, grade.correct) for grade in body.graded],
        plugin_version=algorithm.version,
        keep_private=False,
        run_dir=platform.settings.runs_dir / task.id,
        expected="claimed",
        attempt=attempt,
    )


def fail(platform: Platform, session: Session, token: m.ClientToken, participant: m.Participant, unit_id: int, attempt: int, body: FailIn) -> None:
    unit = _claimed(session, token, participant, unit_id, attempt)
    task = session.get(m.Task, unit.task_id)
    assert task is not None
    step = platform.registry.algorithm(task.algorithm).manifest.step(unit.step)
    retries = step.retries if step else 0
    unit.error = body.error
    unit.claimed_by = None
    unit.lease_until = None
    unit.status = "failed" if body.pause or unit.attempts > retries else "pending"
