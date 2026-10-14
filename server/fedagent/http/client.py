from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy import select

from .. import clients
from .. import models as m
from ..schemas import ClaimIn, ClientHelloIn, ClientHelloOut, ClientUnitOut, CompleteIn, FailIn, UnitInputsOut
from .dependencies import PlatformDep, SessionDep

router = APIRouter(prefix="/v1/client", tags=["client"])


def client_auth(session: SessionDep, authorization: Annotated[str | None, Header()] = None) -> tuple[m.ClientToken, m.Participant]:
    return clients.authenticate(session, (authorization or "").removeprefix("Bearer ").strip())


ClientDep = Annotated[tuple[m.ClientToken, m.Participant], Depends(client_auth)]


AttemptDep = Annotated[int, Header(alias="X-Fedagent-Attempt", ge=1)]


@router.post("/hello", response_model=ClientHelloOut)
def client_hello(body: ClientHelloIn, auth: ClientDep, session: SessionDep) -> ClientHelloOut:
    _, participant = auth
    updated = clients.hello(session, participant, body)
    types = {
        dataset.id: dataset.task_type
        for dataset in session.scalars(select(m.Dataset).where(m.Dataset.participant_id == participant.id, m.Dataset.source == "local"))
    }
    versions = {
        dataset.id: dataset.schema_version
        for dataset in session.scalars(select(m.Dataset).where(m.Dataset.participant_id == participant.id, m.Dataset.source == "local"))
    }
    return ClientHelloOut(participant_id=participant.id, participant=participant.name, datasets=updated, task_types=types, schema_versions=versions)


@router.post("/units/claim", response_model=list[ClientUnitOut])
def client_claim(body: ClaimIn, auth: ClientDep, platform: PlatformDep, session: SessionDep) -> list[ClientUnitOut]:
    token, participant = auth
    return clients.claim(platform, session, token, participant, body.limit)


@router.get("/units/{unit_id}/inputs", response_model=UnitInputsOut)
def client_inputs(unit_id: int, attempt: AttemptDep, auth: ClientDep, platform: PlatformDep, session: SessionDep) -> UnitInputsOut:
    return clients.inputs(platform, session, auth[0], auth[1], unit_id, attempt)


@router.post("/units/{unit_id}/heartbeat", status_code=204)
def client_heartbeat(unit_id: int, attempt: AttemptDep, auth: ClientDep, platform: PlatformDep, session: SessionDep) -> Response:
    clients.heartbeat(platform, session, auth[0], auth[1], unit_id, attempt)
    return Response(status_code=204)


@router.post("/units/{unit_id}/complete", status_code=204)
def client_complete(unit_id: int, body: CompleteIn, attempt: AttemptDep, auth: ClientDep, platform: PlatformDep, session: SessionDep) -> Response:
    clients.complete(platform, session, auth[0], auth[1], unit_id, attempt, body)
    return Response(status_code=204)


@router.post("/units/{unit_id}/fail", status_code=204)
def client_fail(unit_id: int, body: FailIn, attempt: AttemptDep, auth: ClientDep, platform: PlatformDep, session: SessionDep) -> Response:
    clients.fail(platform, session, auth[0], auth[1], unit_id, attempt, body)
    return Response(status_code=204)
