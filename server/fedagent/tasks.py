"""联邦任务：校验、预估、创建（冻结配置）、暂停 / 继续 / 取消，以及给前端的任务详情。

任务详情的字段和前端的 Task 一致（members、cursor、rounds），所以页面不用改：
每一轮的结果按步骤在清单里声明的结果类型取——metric 取判分汇总，uploads 数各方发给服务端的消息，
groups、received 取插件上报的值，output 取这一轮生成的产出版本。
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from fedagent_sdk import SERVER, Algorithm, Artifact, ModelError, SiteSpec, TaskSpec
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import models as m
from .data import select_items
from .gateway import FAKE_ENDPOINT, parse_ref
from .platform import Platform
from .resources import dataset_ready, new_id, not_found, participant_status
from .schemas import (
    CursorOut,
    EstimateOut,
    GroupOut,
    IssueOut,
    MemberOut,
    MessageOut,
    OutputItem,
    OutputVersionOut,
    RoundOut,
    TaskConfigIn,
    TaskOut,
)
from .units import add_event, load_sites

STATUS_LABELS = {"waiting": "还没有连接客户端", "offline": "已离线"}
LOCAL_TZ = ZoneInfo("Asia/Shanghai")


@dataclass
class PreparedSite:
    participant: m.Participant
    dataset: m.Dataset
    items: list[str]
    labeled: int
    model_ref: str


@dataclass
class Prepared:
    algorithm: Algorithm
    sites: list[PreparedSite] = field(default_factory=list)


def _items_of(platform: Platform, dataset: m.Dataset, cap: int | None) -> tuple[list[str], int]:
    task_type = platform.registry.task_type(dataset.task_type)
    if dataset.source == "local":
        ids = [str(item) for item in dataset.item_ids or []]
        chosen = select_items(ids, cap)
        labeled = round(len(chosen) * dataset.answered / max(dataset.count, 1)) if dataset.count else 0
        return chosen, min(labeled, len(chosen))
    rows = platform.files.load(dataset.content_path or "")
    chosen_rows = rows[:cap] if cap else rows
    return [task_type.item_id(row) for row in chosen_rows], sum(1 for row in chosen_rows if task_type.is_labeled(row))


def validate(platform: Platform, session: Session, body: TaskConfigIn) -> tuple[list[IssueOut], Prepared | None]:
    registry = platform.registry
    issues: list[IssueOut] = []

    def issue(field_name: str, message: str) -> None:
        issues.append(IssueOut(field=field_name, message=message))

    scenario = registry.scenario(body.scenario)
    if scenario is None:
        issue("scenario", "场景不存在")
    elif not registry.scenario_available(body.scenario):
        issue("scenario", f"{scenario.short}的算法还在规划中")
    algorithm = registry.algorithms.get(body.algorithm)
    if body.task_type not in registry.task_types:
        issue("taskType", "任务类型没有安装")
    if algorithm is None:
        issue("algorithm", "算法没有安装")
        return issues, None
    manifest = algorithm.manifest
    if manifest.scenario != body.scenario:
        issue("algorithm", "这个算法不属于所选的场景")
    if body.task_type not in manifest.accepts:
        issue("taskType", "这个算法不能处理所选的任务类型")
    if not manifest.rounds.min <= body.rounds <= manifest.rounds.max:
        issue("rounds", f"轮次应在 {manifest.rounds.min}–{manifest.rounds.max} 轮之间")
    for problem in manifest.check_params(body.params):
        issue("params", problem)
    if body.mode == "trial" and body.trial_cap < 1:
        issue("rounds", "试跑每份至少取 1 条样本")
    if body.grader is not None and body.task_type in registry.task_types and body.grader not in registry.task_type(body.task_type).graders:
        issue("taskType", "这种任务类型没有所选的判分方式")

    prepared = Prepared(algorithm=algorithm)
    seen: set[str] = set()
    cap = body.trial_cap if body.mode == "trial" else None
    for choice in body.participants:
        participant = session.get(m.Participant, choice.participant_id)
        dataset = session.get(m.Dataset, choice.dataset_id)
        if participant is None or dataset is None or dataset.participant_id != participant.id:
            issue("participants", "所选的参与方或数据集不存在")
            continue
        if participant.id in seen:
            issue("participants", f"{participant.name} 只能出一份数据集")
            continue
        seen.add(participant.id)
        if dataset.scenario != body.scenario or dataset.task_type != body.task_type:
            issue("participants", f"{dataset.name} 登记的场景或任务类型和任务不一致")
            continue
        if not dataset_ready(dataset):
            issue("participants", f"{dataset.name} 还没有样本（{'客户端连上后上报' if dataset.source == 'local' else '题目文件待导入'}）")
            continue
        status = participant_status(platform, participant)
        if status != "online":
            issue("participants", f"{participant.name} {STATUS_LABELS.get(status, status)}，连上后才能加入任务")
            continue
        items, labeled = _items_of(platform, dataset, cap)
        if not items:
            issue("participants", f"{dataset.name} 没有可用的样本")
            continue
        model_ref = body.client_overrides.get(participant.id) or body.client_model
        prepared.sites.append(PreparedSite(participant, dataset, items, labeled, model_ref))
    if len(prepared.sites) < manifest.min_participants:
        issue("participants", f"至少要选 {manifest.min_participants} 个可以参加的参与方")

    refs = {site.model_ref for site in prepared.sites if site.participant.hosting == "platform"}
    if any(step.at == SERVER and step.model for step in manifest.steps):
        refs.add(body.server_model)
    for ref in sorted(refs):
        try:
            platform.gateway.resolve(ref)
        except ModelError as error:
            issue("models", str(error))
    return issues, prepared


def _spec(body: TaskConfigIn, prepared: Prepared) -> TaskSpec:
    role = next(iter(prepared.algorithm.manifest.roles))
    return TaskSpec(
        scenario=body.scenario,
        task_type=body.task_type,
        rounds=body.rounds,
        params=prepared.algorithm.manifest.params_of(body.params),
        sites=[SiteSpec(site.participant.id, role, len(site.items), site.labeled) for site in prepared.sites],
        workers=body.workers,
    )


def _price(platform: Platform, ref: str) -> float | None:
    try:
        endpoint, _ = platform.gateway.resolve(ref)
    except ModelError:
        return None
    return 0.0 if endpoint.kind == "fake" else endpoint.price


def estimate(platform: Platform, body: TaskConfigIn, prepared: Prepared) -> EstimateOut:
    spec = _spec(body, prepared)
    result = prepared.algorithm.estimate(spec)
    problems = sum(len(site.items) for site in prepared.sites)
    cost: float | None = 0.0
    if problems and result.participant_tokens:
        for site in prepared.sites:
            price = _price(platform, site.model_ref) if site.participant.hosting == "platform" else 0.0
            if price is None:
                cost = None
                break
            cost += result.participant_tokens * len(site.items) / problems * price / 1_000_000
    if cost is not None and result.server_tokens:
        price = _price(platform, body.server_model)
        cost = None if price is None else cost + result.server_tokens * price / 1_000_000
    return EstimateOut(
        problems=problems,
        participant_calls=result.participant_calls,
        server_calls=result.server_calls,
        participant_tokens=result.participant_tokens,
        server_tokens=result.server_tokens,
        seconds=result.seconds,
        cost=cost,
    )


def _default_name(platform: Platform, task_type: str) -> str:
    label = platform.registry.task_type(task_type).label
    return f"{label}任务 {datetime.now(LOCAL_TZ):%m-%d %H:%M}"


def create(platform: Platform, session: Session, body: TaskConfigIn) -> m.Task:
    issues, prepared = validate(platform, session, body)
    if issues or prepared is None:
        raise HTTPException(422, {"message": "任务配置有问题", "issues": [issue.model_dump() for issue in issues]})
    algorithm = prepared.algorithm
    task_id = new_id("task")
    name = body.name.strip() or _default_name(platform, body.task_type)
    config = body.model_dump(by_alias=True)
    config["name"] = name
    config["params"] = algorithm.manifest.params_of(body.params)
    config["grader"] = body.grader or platform.registry.task_type(body.task_type).graders[0]
    refs = [site.model_ref for site in prepared.sites] + [body.server_model]
    fake = any(parse_ref(ref)[0] == FAKE_ENDPOINT for ref in refs)
    audit = {
        "pluginVersion": algorithm.version,
        "pluginHash": algorithm.code_hash(),
        "promptHashes": algorithm.prompt_hashes(),
        "datasets": {site.dataset.id: site.dataset.content_hash for site in prepared.sites},
        "createdAt": m.now().isoformat(),
    }
    task = m.Task(
        id=task_id,
        name=name,
        scenario=body.scenario,
        task_type=body.task_type,
        algorithm=algorithm.id,
        plugin_version=algorithm.version,
        plugin_hash=audit["pluginHash"],
        config=config,
        audit=audit,
        status="queued",
        budget=body.budget,
        fake=fake,
    )
    session.add(task)
    role = next(iter(algorithm.manifest.roles))
    for index, site in enumerate(prepared.sites):
        session.add(
            m.TaskSite(
                task_id=task_id,
                id=site.participant.id,
                ordinal=index,
                kind="participant",
                role=role,
                executor="client" if site.participant.hosting == "local" else "platform",
                participant_id=site.participant.id,
                participant_name=site.participant.name,
                dataset_id=site.dataset.id,
                dataset_name=site.dataset.name,
                dataset_hash=site.dataset.content_hash,
                items=site.items,
                labeled=site.labeled,
                model_ref=site.model_ref,
            )
        )
    session.add(
        m.TaskSite(task_id=task_id, id=SERVER, ordinal=len(prepared.sites), kind="server", role=SERVER, executor="platform", model_ref=body.server_model)
    )
    run_dir = platform.settings.runs_dir / task_id
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "task.json").write_text(json.dumps({"id": task_id, "config": config, "audit": audit}, ensure_ascii=False, indent=2), encoding="utf-8")
    add_event(session, task_id, "create", "任务已创建，排队等待运行", run_dir=run_dir)
    return task


# —— 暂停、继续、取消 ——


def control(session: Session, task_id: str, action: str) -> m.Task:
    task = session.get(m.Task, task_id)
    if task is None:
        raise not_found("任务")
    if action == "pause":
        if task.status == "running":
            task.command = "pause"
        elif task.status == "queued":
            task.status = "paused"
            add_event(session, task.id, "pause", "任务已暂停")
        else:
            raise HTTPException(409, "只有运行中或排队中的任务可以暂停")
    elif action == "resume":
        if task.status != "paused":
            raise HTTPException(409, "只有已暂停的任务可以继续")
        task.status = "queued"
        task.command = None
        task.error = None
        task.restarts = 0
        add_event(session, task.id, "resume", "任务继续，排队等待运行")
    elif action == "cancel":
        if task.status == "running":
            task.command = "cancel"
        elif task.status in ("queued", "paused"):
            task.status = "canceled"
            task.finished_at = m.now()
            add_event(session, task.id, "cancel", "任务已取消")
        else:
            raise HTTPException(409, "任务已经结束")
    else:
        raise HTTPException(400, "未知操作")
    return task


# —— 任务详情 ——


def _artifact_items(algorithm: Algorithm | None, row: m.Artifact) -> list[OutputItem]:
    artifact = Artifact(version=row.version, round=row.round, kind=row.kind, content=row.content)
    if algorithm is None:
        return [OutputItem(key=str(key), text=str(value)) for key, value in (row.content or {}).items()] if isinstance(row.content, dict) else []
    return [OutputItem(key=entry.key, text=entry.text, category=entry.category) for entry in algorithm.describe(artifact)]


def task_out(platform: Platform, session: Session, task: m.Task) -> TaskOut:
    algorithm = platform.registry.algorithms.get(task.algorithm)
    manifest = algorithm.manifest if algorithm else None
    config = dict(task.config)
    sites = load_sites(session, task.id)
    participants = [site for site in sites if site.kind == "participant"]
    members = [
        MemberOut(
            participant_id=site.id,
            participant=site.label,
            dataset_id=site.dataset_id or "",
            dataset=site.dataset_name,
            hosting="local" if site.executor == "client" else "platform",
            problems=len(site.items),
            answered=site.labeled,
            model=site.model_ref or "default",
        )
        for site in participants
    ]

    unit_rows = session.execute(
        select(m.WorkUnit.round, m.WorkUnit.step, m.WorkUnit.site_id, m.WorkUnit.status, func.count())
        .where(m.WorkUnit.task_id == task.id)
        .group_by(m.WorkUnit.round, m.WorkUnit.step, m.WorkUnit.site_id, m.WorkUnit.status)
    ).all()
    totals: dict[tuple[int, str], int] = defaultdict(int)
    done: dict[tuple[int, str], int] = defaultdict(int)
    done_by_site: dict[tuple[int, str, str], int] = defaultdict(int)
    for round, step, site_id, status, count in unit_rows:
        totals[(round, step)] += count
        if status == "done":
            done[(round, step)] += count
            done_by_site[(round, step, site_id)] += count

    def expected(step_id: str) -> int:
        if manifest is None:
            return 0
        step = manifest.step(step_id)
        if step is None:
            return 0
        if step.at == SERVER:
            return 1
        return sum(len(site.items) if step.per == "item" else 1 for site in participants if site.role == step.at)

    def complete(round: int, step_id: str) -> bool:
        need = expected(step_id)
        return need > 0 and done[(round, step_id)] >= need

    reports: dict[tuple[int, str, str], list[tuple[str, Any]]] = defaultdict(list)
    for round, step, site_id, name, value in session.execute(
        select(m.Report.round, m.Report.step, m.Report.site_id, m.Report.name, m.Report.value).where(m.Report.task_id == task.id)
    ).all():
        reports[(round, step, name)].append((site_id, value))
    to_server = {name for name, channel in (manifest.channels.items() if manifest else []) if channel.to == SERVER}
    uploads: dict[int, dict[str, int]] = defaultdict(dict)
    for round, sender, channel, count in session.execute(
        select(m.Message.round, m.Message.sender_site, m.Message.channel, func.count())
        .where(m.Message.task_id == task.id)
        .group_by(m.Message.round, m.Message.sender_site, m.Message.channel)
    ).all():
        if channel in to_server:
            uploads[round][sender] = uploads[round].get(sender, 0) + count
    tokens = dict(
        session.execute(
            select(m.CallRecord.round, func.sum(m.CallRecord.prompt_tokens + m.CallRecord.completion_tokens))
            .where(m.CallRecord.task_id == task.id, m.CallRecord.status.in_(("ok", "discarded")))
            .group_by(m.CallRecord.round)
        ).all()
    )
    artifacts = {row.round: row for row in session.scalars(select(m.Artifact).where(m.Artifact.task_id == task.id).order_by(m.Artifact.version))}

    rounds: list[RoundOut] = []
    last = int(config.get("rounds", 1)) if task.status == "completed" else task.cursor_round
    for round in range(1, last + 1):
        record = RoundOut(round=round)
        received: int | None = None
        for step in manifest.steps if manifest else []:
            if step.result is None or not complete(round, step.id):
                continue
            if step.result == "metric":
                correct = {site.id: 0 for site in participants if site.role == step.at}
                for site_id, value in reports[(round, step.id, "correct")]:
                    correct[site_id] = correct.get(site_id, 0) + int(value or 0)
                record.correct = correct
            elif step.result == "uploads":
                record.uploads = {site.id: uploads[round].get(site.id, 0) for site in participants if site.role == step.at}
            elif step.result == "received":
                received = sum(int(value or 0) for _, value in reports[(round, step.id, "received")])
            elif step.result == "groups":
                values = [value for _, value in reports[(round, step.id, "groups")]]
                if values and isinstance(values[-1], list):
                    record.groups = [
                        GroupOut(name=str(group.get("name", "")), uploads={str(k): int(v) for k, v in (group.get("uploads") or {}).items()})
                        for group in values[-1]
                    ]
            elif step.result == "output" and round in artifacts:
                row = artifacts[round]
                upload_count = received if received is not None else sum((record.uploads or {}).values())
                record.output = OutputVersionOut(built_after_round=round, items=_artifact_items(algorithm, row), upload_count=upload_count)
        if tokens.get(round):
            record.tokens = int(tokens[round])
        if record.model_dump(exclude_none=True, exclude={"round"}):
            rounds.append(record)

    cursor = None
    if task.status != "completed" and manifest is not None:
        stage = task.cursor_step or manifest.steps[0].id
        cursor = CursorOut(
            round=task.cursor_round,
            stage=stage,
            done={site.id: done_by_site[(task.cursor_round, stage, site.id)] for site in participants},
        )
    cost_rows = session.execute(
        select(func.sum(m.CallRecord.cost), func.count(m.CallRecord.id), func.count(m.CallRecord.cost)).where(m.CallRecord.task_id == task.id)
    ).one()
    total_cost, calls, priced = cost_rows
    cost = None if calls and priced < calls else (float(total_cost) if total_cost is not None else (0.0 if calls else None))
    return TaskOut(
        id=task.id,
        name=task.name,
        created_at=task.created_at,
        started_at=task.started_at,
        finished_at=task.finished_at,
        config=config,
        members=members,
        status=task.status,  # type: ignore[arg-type]
        error=task.error,
        cursor=cursor,
        rounds=rounds,
        fake=task.fake,
        cost=cost,
    )


def messages_out(platform: Platform, session: Session, task: m.Task, *, round: int | None, site: str | None, limit: int) -> list[MessageOut]:
    algorithm = platform.registry.algorithms.get(task.algorithm)
    query = select(m.Message).where(m.Message.task_id == task.id)
    if round is not None:
        query = query.where(m.Message.round == round)
    if site is not None:
        query = query.where(m.Message.sender_site == site)
    rows = session.scalars(query.order_by(m.Message.id).limit(limit)).all()
    out = []
    for row in rows:
        entry = algorithm.describe_message(row.channel, row.payload) if algorithm else None
        out.append(
            MessageOut(
                id=row.id,
                round=row.round,
                step=row.step,
                channel=row.channel,
                sender=row.sender_site,
                item_id=row.item_id,
                key=entry.key if entry else "",
                text=entry.text if entry else json.dumps(row.payload, ensure_ascii=False),
                size=row.size,
            )
        )
    return out


def get_task(session: Session, task_id: str) -> m.Task:
    task = session.get(m.Task, task_id)
    if task is None:
        raise not_found("任务")
    return task
