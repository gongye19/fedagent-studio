from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from typing import Literal

from sqlalchemy import update

from .. import models as m
from ..errors import ServiceError
from ..resources import new_id, not_found
from ..schemas import TaskConfigIn
from ..schemas.checks import CheckResult, TaskCheckOut
from ..task_services.preparation import validate
from .connectivity import agent_connection, model_connection
from .fingerprint import fingerprint
from .progress import Progress, parallel

EXPIRY = timedelta(minutes=15)


def out(row: m.TaskCheck) -> TaskCheckOut:
    return TaskCheckOut.model_validate(
        {"id": row.id, "status": row.status, "results": row.results, "created_at": row.created_at, "finished_at": row.finished_at}
    )


def get(session, check_id: str) -> m.TaskCheck:
    row = session.get(m.TaskCheck, check_id)
    if row is None:
        raise not_found("配置测试")
    return row


def create(platform, session, body: TaskConfigIn) -> m.TaskCheck:
    issues, _ = validate(platform, session, body)
    if issues:
        raise ServiceError(422, {"issues": [issue.model_dump() for issue in issues]})
    row = m.TaskCheck(id=new_id("check"), fingerprint=fingerprint(platform, session, body))
    session.add(row)
    session.flush()
    return row


def require_check(platform, session, body: TaskConfigIn) -> None:
    # 兼容已有内置工作流 API；新界面与外部 Agent 必须先主动测试。
    if body.check_id is None and body.execution == "builtin":
        return
    row = session.get(m.TaskCheck, body.check_id) if body.check_id else None
    if row is None or row.status != "passed" or m.now() - m.aware(row.created_at) > EXPIRY or row.fingerprint != fingerprint(platform, session, body):
        raise ServiceError(422, {"issues": [{"field": "check", "message": "请先检查当前资源连接；配置或资源变更后需要重新检查"}]})


def interrupt_checks(platform) -> None:
    with platform.db.session() as session:
        session.execute(
            update(m.TaskCheck)
            .where(m.TaskCheck.status.in_(("queued", "running")))
            .values(
                status="failed",
                finished_at=m.now(),
                results=[{"field": "check", "resource": "配置测试", "status": "failed", "message": "服务重启中断了测试，请重新测试"}],
            )
        )


def run(platform, check_id: str, body: TaskConfigIn) -> None:
    progress = Progress(platform, check_id)
    results = progress.results

    def result(field: str, resource: str, status: Literal["passed", "failed", "skipped"], message: str) -> None:
        progress.put(CheckResult(field=field, resource=resource, status=status, message=message))

    try:
        with platform.db.session() as session:
            get(session, check_id).status = "running"
            issues, prepared = validate(platform, session, body)
        if issues or prepared is None:
            for issue in issues:
                result(issue.field, "任务配置", "failed", issue.message)
            return
        algorithm = prepared.algorithm
        for site in prepared.sites:
            result("participants", site.dataset.name, "passed", "资源已就绪")
        refs = {site.model_ref for site in prepared.sites if body.execution == "builtin" and site.participant.hosting == "platform"}
        if any(step.at == "server" and step.model for step in algorithm.manifest.steps):
            refs.add(body.server_model)
        resolved = {endpoint.id: endpoint.name for endpoint, _ in (platform.gateway.resolve(ref) for ref in sorted(refs))}
        jobs: list[Callable[[], bool]] = [lambda endpoint_id=endpoint_id, name=name: progress.attempt(
                    "models", name, lambda _update: model_connection(platform, endpoint_id))
                for endpoint_id, name in resolved.items()]
        if body.execution == "agent":
            with platform.db.session() as session:
                agents = {site.agent_id: session.get(m.AgentEndpoint, site.agent_id).name
                          for site in prepared.sites if site.agent_id}
            jobs.extend(lambda agent_id=agent_id, name=name: progress.attempt(
                            "models", name, lambda _update: agent_connection(platform, agent_id, algorithm))
                        for agent_id, name in agents.items())
        if not parallel(jobs):
            return
        with platform.db.session() as session:
            if get(session, check_id).fingerprint != fingerprint(platform, session, body):
                result("check", "配置版本", "failed", "测试期间资源发生变化，请重新测试")
    except Exception:
        # 不把任意远程异常正文和凭据写回页面。
        result("check", "配置测试", "failed", "测试意外中断，请检查服务日志后重试")
    finally:
        for index, entry in enumerate(list(results)):
            if entry.status == "running":
                progress.put(entry.model_copy(update={"status": "failed", "message": "检查中断，请重试"}), index)
        with platform.db.session() as session:
            row = get(session, check_id)
            row.status = "failed" if not results or any(entry.status == "failed" for entry in results) else "passed"
            row.results = [entry.model_dump() for entry in results]
            row.finished_at = m.now()
