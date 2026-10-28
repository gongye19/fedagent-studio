from __future__ import annotations

import json

from fedagent_sdk import SERVER
from sqlalchemy import delete as sql_delete
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as m
from ..errors import ServiceError
from ..gateway import FAKE_ENDPOINT, parse_ref
from ..platform import Platform
from ..resources import new_id, not_found
from ..schemas import TaskConfigIn
from ..units import add_event
from .preparation import validate


def _default_name(platform: Platform, task_type: str) -> str:
    label = platform.registry.task_type(task_type).label
    return f"{label}任务"


def create(platform: Platform, session: Session, body: TaskConfigIn) -> m.Task:
    issues, prepared = validate(platform, session, body)
    if issues or prepared is None:
        raise ServiceError(422, {"message": "任务配置有问题", "issues": [issue.model_dump() for issue in issues]})
    from ..checks.service import require_check

    require_check(platform, session, body)
    algorithm = prepared.algorithm
    task_id = new_id("task")
    name = body.name.strip() or _default_name(platform, body.task_type)
    config = body.model_dump(by_alias=True)
    config["name"] = name
    config["params"] = algorithm.manifest.params_of(body.params)
    config["grader"] = body.grader or platform.registry.task_type(body.task_type).graders[0]
    refs = [site.model_ref for site in prepared.sites] if body.execution == "builtin" else []
    if any(step.at == SERVER and step.model for step in algorithm.manifest.steps):
        refs.append(body.server_model)
    fake = any(parse_ref(ref)[0] == FAKE_ENDPOINT for ref in refs)
    agent_ids = ({site.agent_id for site in prepared.sites}
                 if body.execution == "agent" else set())
    audit = {
        "agents": {agent_id: {"name": row.name, "revision": row.revision}
                   for agent_id in agent_ids if agent_id and (row := session.get(m.AgentEndpoint, agent_id))},
        "pluginVersion": algorithm.version,
        "manifest": algorithm.manifest.model_dump(mode="json", by_alias=True),
        "plan": {str(r): algorithm.plan(r, body.rounds) for r in range(1, body.rounds + 1)},
        "pluginHash": algorithm.code_hash(),
        "promptHashes": algorithm.prompt_hashes(),
        "datasets": {site.dataset.id: site.dataset.content_hash for site in prepared.sites},
        "datasetSchemas": {site.dataset.id: site.dataset.schema_version for site in prepared.sites},
        "datasetSources": {site.dataset.id: site.dataset.source_hash for site in prepared.sites},
        "resourceSpaces": {site.dataset.id: site.dataset.resource_space for site in prepared.sites},
        "createdAt": m.now().isoformat(),
        "configCheck": ({"id": check.id, "results": check.results, "finishedAt": check.finished_at.isoformat() if check.finished_at else None}
                        if body.check_id and (check := session.get(m.TaskCheck, body.check_id)) else None),
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
                executor="client" if site.participant.hosting == "local" else "agent" if body.execution == "agent" else "platform",
                participant_id=site.participant.id,
                participant_name=site.participant.name,
                dataset_id=site.dataset.id,
                dataset_name=site.dataset.name,
                dataset_hash=site.dataset.content_hash,
                items=site.items,
                labeled=site.labeled,
                model_ref=f"agent:{site.agent_id}" if body.execution == "agent" else site.model_ref,
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
            raise ServiceError(409, "只有运行中或排队中的任务可以暂停")
    elif action == "resume":
        if task.status != "paused":
            raise ServiceError(409, "只有已暂停的任务可以继续")
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
            raise ServiceError(409, "任务已经结束")
    else:
        raise ServiceError(400, "未知操作")
    return task


def get_task(session: Session, task_id: str) -> m.Task:
    task = session.get(m.Task, task_id)
    if task is None:
        raise not_found("任务")
    return task


def delete_task(session: Session, task_id: str) -> None:
    """只删除终态任务；关联结果由外键清理，应用和费用账本独立保留。"""
    from ..runner import leftover_process

    task = get_task(session, task_id)
    if task.status not in ("completed", "canceled"):
        raise ServiceError(409, "请先取消任务，等任务结束后再删除")
    if session.scalars(select(m.AgentRun).where(m.AgentRun.task_id == task_id,
                        m.AgentRun.status.in_(("queued", "running", "canceling")))).first():
        raise ServiceError(409, "部分 Agent 尚未确认停止，请在 Agent 接口检查能力以同步停止状态")
    if leftover_process(task.pid, task_id):
        raise ServiceError(409, "任务进程正在退出，请稍后再删除")
    # 事件为独立日志表，没有任务外键，需在同一事务里显式清理。
    session.execute(sql_delete(m.Event).where(m.Event.task_id == task_id))
    result = session.execute(sql_delete(m.Task).where(m.Task.id == task_id, m.Task.status.in_(("completed", "canceled"))))
    if result.rowcount != 1:  # type: ignore[attr-defined]
        raise ServiceError(409, "任务状态已变化，请刷新后再试")


def remove_run_directory(platform: Platform, task_id: str) -> None:
    """事务提交后的清理；清理失败不把已成功的删除伪装成失败。"""
    import logging
    import shutil

    root = platform.settings.runs_dir.resolve()
    path = root / task_id
    if path.parent != root or path.is_symlink():
        logging.getLogger(__name__).warning("skipped unsafe task directory: %s", task_id)
        return
    try:
        if path.exists():
            shutil.rmtree(path)
    except OSError:
        logging.getLogger(__name__).exception("could not remove deleted task directory: %s", task_id)
