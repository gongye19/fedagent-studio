from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from fedagent_sdk import SERVER, Algorithm, Artifact, Manifest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models as m
from ..platform import Platform
from ..registry import stage_descriptions
from ..schemas import CursorOut, GroupOut, MemberOut, MessageOut, OutputItem, OutputVersionOut, RoundOut, TaskOut
from ..schemas.registry import StageOut
from ..units import load_sites


def _artifact_items(algorithm: Algorithm | None, row: m.Artifact) -> list[OutputItem]:
    artifact = Artifact(version=row.version, round=row.round, kind=row.kind, content=row.content)
    if algorithm is None:
        return [OutputItem(key=str(key), text=str(value)) for key, value in (row.content or {}).items()] if isinstance(row.content, dict) else []
    return [OutputItem(key=entry.key, text=entry.text, category=entry.category) for entry in algorithm.describe(artifact)]


def task_out(platform: Platform, session: Session, task: m.Task) -> TaskOut:
    algorithm = platform.registry.algorithms.get(task.algorithm)
    snapshot = task.audit.get("manifest")
    manifest = (Manifest.model_validate(snapshot) if snapshot else algorithm.manifest_for_version(task.plugin_version) if algorithm else None)
    plan = task.audit.get("plan") or {str(r): [s.id for s in manifest.steps] if manifest else []
                                     for r in range(1, int(task.config.get("rounds", 1)) + 1)}
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
            agent_name=(task.audit.get("agents", {}).get((site.model_ref or "").removeprefix("agent:"), {}).get("name")
                        if site.executor == "agent" else None),
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
    if manifest is not None and manifest.evaluation is not None and complete(1, manifest.evaluation.step):
        # 本地客户端的试跑标注数在创建时只能估计；第 1 轮判分后改用实际汇总。
        labeled: dict[str, int] = defaultdict(int)
        for site_id, value in reports[(1, manifest.evaluation.step, "labeled")]:
            labeled[site_id] += int(value or 0)
        for member in members:
            member.answered = labeled[member.participant_id]
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
        stage = task.cursor_step or plan.get(str(task.cursor_round), [manifest.steps[0].id])[0]
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
        stages=[StageOut.model_validate(s) for s in stage_descriptions(manifest)] if manifest else [],
        plan=plan,
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
        cost=None if config.get("execution") == "agent" else cost,
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
