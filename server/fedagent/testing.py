"""插件契约测试：在小数据和假模型上把一个算法跑完所有轮次，用平台真实的编排，检查数据流声明被遵守。

检查项：
1. 任务跑完（没有因为插件出错暂停）；
2. 每条消息都走声明过的通道，发送方的角色和通道一致；
3. 标注没有越过授权边界：非学习／非判分提示词、所有联邦消息与产出都不能出现标注标记；
4. 声明了产出的算法，每轮都生成一版产出；
5. 中途暂停再继续（续跑）的结果，和一次跑完的结果完全一样（假模型的回答是确定的）。
"""

from __future__ import annotations

import json
import secrets
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fedagent_sdk import SERVER
from sqlalchemy import func, select

from . import models as m
from .engine import TaskEngine
from .gateway import GatewayModel
from .platform import Platform
from .registry import Registry
from .resources import create_dataset, create_participant
from .schemas import ParticipantIn, TaskConfigIn, TaskParticipantIn
from .seed import seed
from .settings import Settings
from .tasks import create


@dataclass
class ContractReport:
    algorithm: str
    checks: dict[str, bool] = field(default_factory=dict)
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return all(self.checks.values())


def _canary_rows(rows: list[dict[str, Any]], label_fields: tuple[str, ...]) -> tuple[list[dict[str, Any]], list[str]]:
    canaries: list[str] = []
    out = []
    for row in rows:
        copy = dict(row)
        for name in label_fields:
            if copy.get(name) not in (None, ""):
                marker = f"LABEL-CANARY-{secrets.token_hex(6)}"
                copy[name] = marker
                canaries.append(marker)
        out.append(copy)
    return out, canaries


class _PromptRecorder:
    """记录未获标注权限的模型提示词；学习与独立判分按契约允许读标注。"""

    def __init__(self) -> None:
        self.prompts: list[str] = []
        self.lock = threading.Lock()
        self._original = GatewayModel._fake

    def __enter__(self) -> _PromptRecorder:
        recorder = self

        def fake(model: GatewayModel, text: str, digest: str) -> str:
            with recorder.lock:
                step = model.plugin.manifest.step(model.step_id) if model.plugin and model.step_id else None
                if model.purpose != "grade" and not (step and step.labels):
                    recorder.prompts.append(text)
            return recorder._original(model, text, digest)

        GatewayModel._fake = fake  # type: ignore[method-assign]
        return self

    def __exit__(self, *exc: object) -> None:
        GatewayModel._fake = self._original  # type: ignore[method-assign]


def _run_task(platform: Platform, task_id: str, *, pause_after_units: int | None = None) -> str:
    with platform.db.session() as session:
        task = session.get(m.Task, task_id)
        assert task is not None
        task.status = "running"
    if pause_after_units is not None:
        stop = threading.Event()

        def watch() -> None:
            while not stop.is_set():
                with platform.db.session() as session:
                    done = session.scalar(select(func.count()).where(m.WorkUnit.task_id == task_id, m.WorkUnit.status == "done")) or 0
                    if done >= pause_after_units:
                        task = session.get(m.Task, task_id)
                        if task is not None and task.status == "running":
                            task.command = "pause"
                        return
                stop.wait(0.01)

        thread = threading.Thread(target=watch, daemon=True)
        thread.start()
        status = TaskEngine(platform, task_id, poll=0.02).run()
        stop.set()
        thread.join()
        if status != "paused":
            return status
        with platform.db.session() as session:
            task = session.get(m.Task, task_id)
            assert task is not None
            task.status = "running"
    return TaskEngine(platform, task_id, poll=0.02).run()


def _fingerprint(platform: Platform, task_id: str) -> dict[str, Any]:
    with platform.db.session() as session:
        artifacts = [row.content for row in session.scalars(select(m.Artifact).where(m.Artifact.task_id == task_id).order_by(m.Artifact.version))]
        messages = sorted(
            json.dumps([row.round, row.step, row.channel, row.sender_site, row.item_id, row.payload], ensure_ascii=False, sort_keys=True)
            for row in session.scalars(select(m.Message).where(m.Message.task_id == task_id))
        )
        reports = sorted(
            json.dumps([row.round, row.step, row.site_id, row.unit_key, row.name, row.value], ensure_ascii=False, sort_keys=True)
            for row in session.scalars(select(m.Report).where(m.Report.task_id == task_id))
        )
    return {"artifacts": artifacts, "messages": messages, "reports": reports}


def run_contract(
    algorithm: str,
    *,
    datasets: dict[str, list[dict[str, Any]]],
    task_type: str | None = None,
    rounds: int | None = None,
    params: dict[str, Any] | None = None,
    workdir: Path | None = None,
) -> ContractReport:
    """datasets：参与方名称 → 样本列表（平台托管）。用测试用假模型跑两遍（一次跑完、一次中途暂停再继续）。"""
    root = workdir or Path(tempfile.mkdtemp(prefix="fedagent-contract-"))
    platform = Platform.create(Settings(data_dir=root, fake_endpoint=True), registry=Registry.discover())
    seed(platform)
    plugin = platform.registry.algorithm(algorithm)
    manifest = plugin.manifest
    # SDK 内部契约验证本方代码；外部接入另用独立 HTTP 流程测试。
    manifest.agent_required = False
    task_type = task_type or manifest.accepts[0]
    tt = platform.registry.task_type(task_type)
    report = ContractReport(algorithm=algorithm)
    canaries: list[str] = []
    chosen: list[TaskParticipantIn] = []
    with platform.db.session() as session:
        for name, rows in datasets.items():
            participant = create_participant(session, ParticipantIn(name=name, hosting="platform"))
            session.flush()
            marked, markers = _canary_rows(rows, tt.label_fields)
            canaries += markers
            raw = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in marked).encode()
            dataset, checked = create_dataset(
                platform, session, participant_id=participant.id, name=f"{name} 数据", description="", scenario=manifest.scenario, task_type=task_type, raw=raw
            )
            if dataset is None:
                raise ValueError(f"测试数据检查不通过：{checked}")
            chosen.append(TaskParticipantIn(participant_id=participant.id, dataset_id=dataset.id))
    config = TaskConfigIn(
        name="契约测试",
        scenario=manifest.scenario,
        task_type=task_type,
        algorithm=algorithm,
        participants=chosen,
        client_model="fake:fake",
        server_model="fake:fake",
        rounds=rounds or manifest.rounds.min,
        mode="full",
        params=params or {},
        workers=4,
    )
    task_ids = []
    for _ in range(2):
        with platform.db.session() as session:
            task_ids.append(create(platform, session, config).id)
    with _PromptRecorder() as recorder:
        first = _run_task(platform, task_ids[0])
        with platform.db.session() as session:
            units = session.scalar(select(func.count()).where(m.WorkUnit.task_id == task_ids[0])) or 0
        second = _run_task(platform, task_ids[1], pause_after_units=max(1, units // 2))
    report.details.update({"statuses": [first, second], "prompts": len(recorder.prompts), "units": units, "workdir": str(root)})
    report.checks["跑完全部轮次"] = first == "completed" and second == "completed"

    with platform.db.session() as session:
        task = session.get(m.Task, task_ids[0])
        report.details["error"] = task.error if task else None
        rows = list(session.scalars(select(m.Message).where(m.Message.task_id == task_ids[0])))
        channels_ok = all(
            row.channel in manifest.channels and manifest.channels[row.channel].from_ == (SERVER if row.sender_site == SERVER else row.sender_role)
            for row in rows
        )
        report.checks["只用了声明的通道"] = channels_ok
        report.details["messages"] = len(rows)
        texts = [json.dumps(row.payload, ensure_ascii=False) for row in rows]
        texts += [json.dumps(row.content, ensure_ascii=False) for row in session.scalars(select(m.Artifact).where(m.Artifact.task_id.in_(task_ids)))]
        texts += recorder.prompts
        report.checks["标注没有离开持有方"] = not any(canary in text for canary in canaries for text in texts)
        if manifest.artifact is not None:
            produced = session.scalar(select(func.count()).where(m.Artifact.task_id == task_ids[0])) or 0
            report.checks["按执行计划生成产出"] = produced == sum(
                any(s.publishes for s in manifest.steps if s.id in plugin.plan(r, config.rounds)) for r in range(1, config.rounds + 1))
            report.details["artifacts"] = produced
    report.checks["中途暂停再继续，结果一致"] = _fingerprint(platform, task_ids[0]) == _fingerprint(platform, task_ids[1])
    return report
