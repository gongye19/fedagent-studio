from ..agents.resources import out as agent_out
from ..resource_services.datasets import dataset_out
from ..resource_services.endpoints import endpoint_out
from ..resource_services.sharing import set_shared
from ..schemas.agents import AgentOut
from ..schemas.resources import DatasetOut, EndpointOut
from ..schemas.sharing import SharingIn
from .dependencies import SessionDep, admin_router

router = admin_router()


@router.patch("/resources/{kind}/{resource_id}/sharing", response_model=DatasetOut | EndpointOut | AgentOut, tags=["resources"])
def share_resource(kind: str, resource_id: str, body: SharingIn, session: SessionDep):
    row = set_shared(session, kind, resource_id, body.shared)
    return {"data": dataset_out, "llm": endpoint_out, "agent": agent_out}[kind](row)
