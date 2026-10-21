from fastapi import Response
from sqlalchemy import select

from .. import models as m
from ..agents import resources
from ..agents.gateway import AgentError, AgentGateway
from ..errors import ServiceError
from ..schemas.agents import AgentIn, AgentOut
from .dependencies import PlatformDep, SessionDep, admin_router

router = admin_router()


@router.get("/agents", response_model=list[AgentOut], tags=["agents"])
def list_agents(session: SessionDep) -> list[AgentOut]:
    return [resources.out(row) for row in session.scalars(select(m.AgentEndpoint).order_by(m.AgentEndpoint.created_at))]


@router.post("/agents", response_model=AgentOut, status_code=201, tags=["agents"])
def create_agent(body: AgentIn, platform: PlatformDep, session: SessionDep) -> AgentOut:
    return resources.out(resources.save(platform, session, body))


@router.put("/agents/{agent_id}", response_model=AgentOut, tags=["agents"])
def update_agent(agent_id: str, body: AgentIn, platform: PlatformDep, session: SessionDep) -> AgentOut:
    return resources.out(resources.save(platform, session, body, agent_id))


@router.delete("/agents/{agent_id}", status_code=204, tags=["agents"])
def delete_agent(agent_id: str, session: SessionDep) -> Response:
    if resources.get(session, agent_id).resource_space == "public":
        raise ServiceError(409, "只能删除当前工作区自己的 Agent 接口")
    resources.ensure_unused(session, agent_id)
    session.delete(resources.get(session, agent_id))
    return Response(status_code=204)


@router.post("/agents/{agent_id}/check", response_model=AgentOut, tags=["agents"])
def check_agent(agent_id: str, platform: PlatformDep, session: SessionDep) -> AgentOut:
    resources.get(session, agent_id)
    try:
        gateway = AgentGateway(platform)
        capability = gateway.capabilities(agent_id)
        gateway.reconcile(agent_id)
    except AgentError as error:
        raise ServiceError(502, str(error)) from error
    row = resources.get(session, agent_id)
    row.capabilities = capability.model_dump(mode="json")
    return resources.out(row)


@router.get("/agent-protocol", tags=["agents"])
def download_protocol(platform: PlatformDep) -> dict:
    from ..agents.protocol import document

    return document(platform.registry)
