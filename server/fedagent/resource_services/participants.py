from __future__ import annotations

from datetime import timedelta

from sqlalchemy.orm import Session

from .. import models as m
from ..errors import ServiceError
from ..platform import Platform
from ..schemas import ParticipantIn, ParticipantOut, ParticipantPatch
from .common import new_id, not_found, require_unused


def participant_status(platform: Platform, participant: m.Participant) -> str:
    if participant.hosting == "platform":
        return "online"
    if participant.last_seen_at is None:
        return "waiting"
    seen = m.aware(participant.last_seen_at)
    return "online" if m.now() - seen <= timedelta(seconds=platform.settings.client_offline_seconds) else "offline"


def participant_out(platform: Platform, participant: m.Participant) -> ParticipantOut:
    return ParticipantOut(
        id=participant.id,
        name=participant.name,
        org=participant.org,
        intro=participant.intro,
        hosting=participant.hosting,  # type: ignore[arg-type]
        status=participant_status(platform, participant),  # type: ignore[arg-type]
        builtin=participant.builtin,
        last_seen_at=participant.last_seen_at,
        client_plugins=dict(participant.client_plugins or {}),
    )


def create_participant(session: Session, body: ParticipantIn) -> m.Participant:
    participant = m.Participant(id=new_id("p"), name=body.name.strip(), org=body.org.strip(), intro=body.intro.strip(), hosting=body.hosting)
    session.add(participant)
    session.flush()
    return participant


def update_participant(session: Session, participant_id: str, body: ParticipantPatch) -> m.Participant:
    participant = session.get(m.Participant, participant_id)
    if participant is None:
        raise not_found("参与方")
    for field in ("name", "org", "intro"):
        value = getattr(body, field)
        if value is not None:
            setattr(participant, field, value.strip())
    return participant


def delete_participant(session: Session, participant_id: str) -> None:
    participant = session.get(m.Participant, participant_id)
    if participant is None:
        raise not_found("参与方")
    if participant.builtin:
        raise ServiceError(409, "平台内置参与方不能删除")
    require_unused(session, m.TaskSite.participant_id, participant_id, "参与方")
    session.delete(participant)
