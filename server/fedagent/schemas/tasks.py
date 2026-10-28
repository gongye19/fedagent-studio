from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from .base import Model, Time
from .registry import StageOut


class TaskParticipantIn(Model):
    participant_id: str
    dataset_id: str


class TaskConfigIn(Model):
    name: str = Field(default="", max_length=120)
    scenario: str
    task_type: str
    algorithm: str
    participants: list[TaskParticipantIn]
    client_model: str = "default"
    client_overrides: dict[str, str] = Field(default={})
    server_model: str = "default"
    execution: Literal["builtin", "agent"] = "builtin"
    agent_id: str | None = None
    agent_overrides: dict[str, str] = Field(default_factory=dict)
    check_id: str | None = None
    rounds: int
    mode: Literal["trial", "full"] = "trial"
    trial_cap: int = 5
    params: dict[str, Any] = Field(default={})
    seed: int = 0
    workers: int = Field(default=8, ge=1, le=64)
    grader: str | None = None
    budget: float | None = Field(default=None, ge=0)


class IssueOut(Model):
    field: str
    message: str


class EstimateOut(Model):
    problems: int
    remote_execution: bool = False
    participant_calls: int
    calls_are_upper_bound: bool = False
    server_calls: int
    participant_tokens: int
    server_tokens: int
    seconds: int
    cost: float | None


class ValidateOut(Model):
    issues: list[IssueOut]
    estimate: EstimateOut | None


class MemberOut(Model):
    participant_id: str
    participant: str
    dataset_id: str
    dataset: str
    hosting: Literal["platform", "local"]
    problems: int
    answered: int
    model: str
    agent_name: str | None = None


class CursorOut(Model):
    round: int
    stage: str
    done: dict[str, int]
    ticks: int = 0


class OutputItem(Model):
    key: str
    text: str
    category: str | None = None


class OutputVersionOut(Model):
    built_after_round: int
    items: list[OutputItem]
    upload_count: int


class GroupOut(Model):
    name: str
    uploads: dict[str, int]


class RoundOut(Model):
    round: int
    correct: dict[str, int] | None = None
    uploads: dict[str, int] | None = None
    groups: list[GroupOut] | None = None
    tokens: int | None = None
    output: OutputVersionOut | None = None


class TaskOut(Model):
    id: str
    name: str
    created_at: Time
    started_at: Time | None
    finished_at: Time | None
    config: dict[str, Any]
    members: list[MemberOut]
    status: Literal["queued", "running", "paused", "completed", "canceled"]
    error: str | None
    cursor: CursorOut | None
    rounds: list[RoundOut]
    fake: bool
    cost: float | None
    stages: list[StageOut] = Field(default_factory=list)
    plan: dict[str, list[str]] = Field(default_factory=dict)


class MessageOut(Model):
    id: int
    round: int
    step: str
    channel: str
    sender: str
    item_id: str | None
    key: str
    text: str
    size: int
    category: str | None = None
    entries: list[OutputItem] = Field(default_factory=list)
    created_at: Time | None = None
    receiver: str | None = None


class EventOut(Model):
    id: int
    kind: str
    message: str
    created_at: Time
