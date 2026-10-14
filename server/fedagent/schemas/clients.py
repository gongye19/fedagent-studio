from __future__ import annotations

from typing import Any

from pydantic import Field

from .base import Model, Time


class ClientTokenOut(Model):
    id: str
    token: str | None
    """只在签发时返回一次。"""
    created_at: Time


class ClientDataset(Model):
    dataset_id: str
    count: int = Field(ge=0)
    answered: int = Field(ge=0)
    item_ids: list[str]


class ClientHelloIn(Model):
    client_version: str
    plugins: dict[str, str] = Field(default={})
    datasets: list[ClientDataset] = Field(default=[])


class ClientHelloOut(Model):
    participant_id: str
    participant: str
    datasets: list[str]
    task_types: dict[str, str] = Field(default={})
    schema_versions: dict[str, str] = Field(default={})


class ClientUnitOut(Model):
    id: int
    attempt: int
    item_ids: list[str]
    task_id: str
    round: int
    rounds: int
    step: str
    site_id: str
    role: str
    unit_key: str
    dataset_id: str | None
    algorithm: str
    plugin_version: str
    task_type: str
    grader: str
    params: dict[str, Any]
    lease_until: Time


class ClaimIn(Model):
    limit: int = Field(default=4, ge=1, le=64)


class ClientMessage(Model):
    id: str
    channel: str
    round: int
    step: str
    sender: str
    sender_role: str
    payload: Any
    item_id: str | None


class ClientArtifact(Model):
    version: int
    round: int
    kind: str
    content: Any


class UnitInputsOut(Model):
    inbox: dict[str, list[ClientMessage]]
    artifact: ClientArtifact | None


class SentIn(Model):
    channel: str
    payload: Any
    item_id: str | None = None
    to: str | None = None


class GradedIn(Model):
    item_id: str
    labeled: bool
    correct: bool


class CompleteIn(Model):
    sent: list[SentIn] = Field(default=[])
    reports: dict[str, Any] = Field(default={})
    graded: list[GradedIn] = Field(default=[])


class FailIn(Model):
    error: str = Field(max_length=4000)
    pause: bool = False
