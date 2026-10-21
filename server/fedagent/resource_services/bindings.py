"""病例与 Agent 成组接入；公用绑定由平台维护，任务执行时冻结实际接口。"""

from sqlalchemy import select

from .. import models as m
from ..agents.protocol import Capabilities
from ..agents.resources import compatible
from ..errors import ServiceError
from .common import not_found, require_unused


def bind_agent(platform, session, dataset_id: str, agent_id: str | None, *, managed: bool = False) -> m.Dataset:
    data = session.get(m.Dataset, dataset_id)
    if data is None:
        raise not_found("数据")
    if data.resource_space != "workspace" and not managed:
        raise ServiceError(409, "公用协作组由平台维护，不能替换其 Agent")
    require_unused(session, m.TaskSite.dataset_id, data.id, "数据与 Agent 绑定")
    if data.source == "local":
        raise ServiceError(422, "Agent 接入需要已上传的数据")
    if agent_id:
        agent = session.get(m.AgentEndpoint, agent_id)
        if agent is None:
            raise not_found("Agent 接口")
        algorithms = [a for a in platform.registry.algorithms.values() if data.task_type in a.manifest.accepts and a.manifest.agent_supported]
        if not algorithms:
            raise ServiceError(422, "这种任务暂不支持 Agent 接入")
        if agent.capabilities and not any(compatible(Capabilities.model_validate(agent.capabilities), a) for a in algorithms):
            raise ServiceError(422, "Agent 不支持该数据任务所需的算法与完整步骤")
    data.agent_id = agent_id
    session.flush()
    return data


def require_unbound(session, agent_id: str) -> None:
    if session.scalar(select(m.Dataset.id).where(m.Dataset.agent_id == agent_id).limit(1)):
        raise ServiceError(409, "Agent 已与数据组成接入组，请先解除绑定；公用协作组由平台维护")


def selected_agent(body, site) -> str | None:
    return body.agent_overrides.get(site.participant.id) or site.dataset.agent_id or body.agent_id
