from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as m
from ..errors import ServiceError
from ..resources import new_id, not_found
from ..schemas.agents import AgentIn, AgentOut
from .protocol import Capabilities


def get(session: Session, agent_id: str) -> m.AgentEndpoint:
    row = session.get(m.AgentEndpoint, agent_id)
    if row is None:
        raise not_found("Agent 接口")
    return row


def out(row: m.AgentEndpoint) -> AgentOut:
    return AgentOut(
        id=row.id,
        name=row.name,
        base_url=row.base_url,
        resource_space=row.resource_space,
        has_key=bool(row.api_key_enc),
        capabilities=Capabilities.model_validate(row.capabilities) if row.capabilities else None,
        revision=row.revision,
    )


def ensure_unused(session: Session, agent_id: str) -> None:
    pending = session.scalars(select(m.AgentRun).where(m.AgentRun.agent_id == agent_id, m.AgentRun.status.in_(("queued", "running", "canceling")))).first()
    if pending:
        raise ServiceError(409, "该 Agent 仍有未确认结束的运行，请先恢复连接并确认停止")
    used = session.scalars(select(m.TaskSite).join(m.Task, m.Task.id == m.TaskSite.task_id).where(
        m.Task.status.in_(("queued", "running", "paused")), m.TaskSite.executor == "agent", m.TaskSite.model_ref == f"agent:{agent_id}"
    )).first()
    if used:
        raise ServiceError(409, "接口正被未结束的任务使用，请先完成或取消这些任务")


def save(platform, session: Session, body: AgentIn, agent_id: str | None = None) -> m.AgentEndpoint:
    row = get(session, agent_id) if agent_id else m.AgentEndpoint(id=new_id("agent"), name=body.name, base_url=body.base_url)
    if agent_id:
        ensure_unused(session, agent_id)
        row.revision += 1
        if row.base_url != body.base_url:
            row.api_key_enc = None  # 绝不把旧凭据发给改过地址的服务。
    row.name, row.base_url = body.name, body.base_url
    if body.api_key is not None:
        row.api_key_enc = platform.secrets.encrypt(body.api_key) if body.api_key else None
    row.capabilities = None
    session.add(row)
    session.flush()
    return row


def compatible(capabilities: Capabilities | None, algorithm) -> bool:
    if capabilities is None:
        return False
    capability = capabilities.algorithms.get(algorithm.id)
    steps = {step.id for step in algorithm.manifest.steps if step.at != "server"}
    return bool(capability and capability.version == algorithm.version and steps <= set(capability.steps))
