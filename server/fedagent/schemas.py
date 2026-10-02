"""API 的请求和响应结构。字段用 camelCase，和前端的类型一致；前端用 openapi-typescript 从这里生成类型。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, serialize_by_alias=True)


# —— 注册表 ——


class ScenarioOut(Model):
    id: str
    name: str
    short: str
    summary: str
    status: Literal["available", "planned"]


class GraderOut(Model):
    id: str
    label: str
    detail: str


class TaskTypeOut(Model):
    id: str
    label: str
    metric: str
    grader: str | None
    graders: list[GraderOut]
    format: str
    unlabeled_note: str
    placeholder: str


class StageOut(Model):
    id: str
    label: str
    side: Literal["participant", "server"]
    role: str
    per: Literal["item", "site"]
    result: Literal["metric", "uploads", "received", "groups", "output"] | None
    seconds: float
    tokens: int | None
    model: bool


class ParamOptionOut(Model):
    value: str | int | float | None
    label: str


class ParamOut(Model):
    key: str
    label: str
    help: str
    kind: Literal["select", "select-number", "number"]
    options: list[ParamOptionOut]
    min: float | None
    max: float | None
    unit: str | None
    default: str | int | float | None


class RoleOut(Model):
    label: str
    min: int
    max: int | None
    evaluated: bool


class OutputDef(Model):
    name: str
    unit: str


class SourceOut(Model):
    paper: str | None
    paper_url: str | None
    code: str | None
    code_url: str | None


class AlgorithmOut(Model):
    id: str
    version: str
    scenario: str
    name: str
    full_name: str
    summary: str
    exchange: str
    output: OutputDef | None
    stages: list[StageOut]
    accepts: list[str]
    roles: dict[str, RoleOut]
    params: list[ParamOut]
    min_participants: int
    min_rounds: int
    max_rounds: int
    default_rounds: int
    source: SourceOut


class RegistryOut(Model):
    scenarios: list[ScenarioOut]
    task_types: list[TaskTypeOut]
    algorithms: list[AlgorithmOut]


class MetaOut(Model):
    version: str
    auth_required: bool


# —— 参与方、数据集、模型接口 ——


class ParticipantIn(Model):
    name: str = Field(min_length=1, max_length=40)
    org: str = Field(default="", max_length=40)
    intro: str = Field(default="", max_length=120)
    hosting: Literal["platform", "local"]


class ParticipantPatch(Model):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    org: str | None = Field(default=None, max_length=40)
    intro: str | None = Field(default=None, max_length=120)


class ParticipantOut(Model):
    id: str
    name: str
    org: str
    intro: str
    hosting: Literal["platform", "local"]
    status: Literal["online", "offline", "waiting"]
    builtin: bool
    last_seen_at: datetime | None


class SampleOut(Model):
    question: str
    answer: str | None = None


class DatasetOut(Model):
    id: str
    name: str
    participant_id: str
    description: str
    origin: str | None
    scenario: str
    task_type: str
    count: int
    answered: int
    source: Literal["builtin", "upload", "local"]
    sample: SampleOut | None
    ready: bool
    """平台托管的已有样本文件；本地的已由客户端上报样本数。"""


class CheckProblem(Model):
    line: int
    message: str


class DatasetCheckOut(Model):
    ok: bool
    count: int
    answered: int
    problems: list[CheckProblem]
    problem_count: int
    sample: SampleOut | None


class EndpointIn(Model):
    name: str = Field(min_length=1, max_length=40)
    base_url: str = Field(default="", max_length=400)
    models: list[str] = []
    concurrency: int = Field(default=8, ge=1, le=256)
    price: float | None = Field(default=None, ge=0)
    api_key: str | None = Field(default=None, max_length=400)
    """只能写入，不会读出；不传表示不修改，传空字符串表示清除。"""
    timeout: float = Field(default=600.0, ge=5, le=3600)
    max_retries: int = Field(default=8, ge=0, le=20)


class EndpointOut(Model):
    id: str
    name: str
    kind: Literal["openai", "fake"]
    base_url: str
    models: list[str]
    concurrency: int
    price: float | None
    has_key: bool
    builtin: bool
    configured: bool
    timeout: float
    max_retries: int


class EndpointTestOut(Model):
    ok: bool
    model: str | None
    latency_ms: int | None
    message: str


# —— 联邦任务 ——


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
    client_overrides: dict[str, str] = {}
    server_model: str = "default"
    rounds: int
    mode: Literal["trial", "full"] = "trial"
    trial_cap: int = 5
    params: dict[str, Any] = {}
    seed: int = 0
    workers: int = Field(default=8, ge=1, le=64)
    grader: str | None = None
    budget: float | None = Field(default=None, ge=0)


class IssueOut(Model):
    field: str
    message: str


class EstimateOut(Model):
    problems: int
    participant_calls: int
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
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    config: dict[str, Any]
    members: list[MemberOut]
    status: Literal["queued", "running", "paused", "completed", "canceled"]
    error: str | None
    cursor: CursorOut | None
    rounds: list[RoundOut]
    fake: bool
    cost: float | None


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


class EventOut(Model):
    id: int
    kind: str
    message: str
    created_at: datetime


# —— 应用 ——


class AppIn(Model):
    task_id: str
    built_after_round: int
    name: str = Field(min_length=1, max_length=60)


class AppPatch(Model):
    name: str = Field(min_length=1, max_length=60)


class AppOut(Model):
    id: str
    task_id: str
    built_after_round: int
    name: str
    published_at: datetime
    scenario: str
    task_type: str
    algorithm: str
    plugin_version: str
    items: list[OutputItem]


class ApplyIn(Model):
    input: str = Field(min_length=1, max_length=20000)
    answer: str | None = None
    model: str = "default"


class ApplySide(Model):
    output: str
    correct: bool | None
    tokens: int


class ApplyOut(Model):
    without: ApplySide
    with_: ApplySide = Field(alias="with")


# —— 参与方客户端 ——


class ClientTokenOut(Model):
    id: str
    token: str | None
    """只在签发时返回一次。"""
    created_at: datetime


class ClientDataset(Model):
    dataset_id: str
    count: int
    answered: int
    item_ids: list[str]


class ClientHelloIn(Model):
    client_version: str
    plugins: dict[str, str] = {}
    datasets: list[ClientDataset] = []


class ClientHelloOut(Model):
    participant_id: str
    participant: str
    datasets: list[str]


class ClientUnitOut(Model):
    id: int
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
    lease_until: datetime


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
    sent: list[SentIn] = []
    reports: dict[str, Any] = {}
    graded: list[GradedIn] = []


class FailIn(Model):
    error: str = Field(max_length=4000)
    pause: bool = False
