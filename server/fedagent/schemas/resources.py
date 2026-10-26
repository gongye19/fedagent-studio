from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from .base import Model, Time
from .sharing import ResourceInfo


class ParticipantIn(Model):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    org: str = Field(default="", max_length=40)
    intro: str = Field(default="", max_length=120)
    hosting: Literal["platform", "local"]


class ParticipantPatch(Model):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)] | None = None
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
    last_seen_at: Time | None
    client_plugins: dict[str, str] = Field(default={})


class PreviewFieldOut(Model):
    label: str
    text: str


class SampleOut(Model):
    question: str = ""
    answer: str | None = None
    fields: list[PreviewFieldOut] = Field(default=[])


class DatasetOut(ResourceInfo):
    id: str
    name: str
    participant_id: str
    description: str
    origin: str | None
    scenario: str
    task_type: str
    schema_version: str = "1.0"
    source_hash: str | None = None
    count: int
    answered: int
    source: Literal["builtin", "upload", "local"]
    resource_space: Literal["workspace", "public"]
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


class DataResourceOut(Model):
    dataset: DatasetOut
    source: ParticipantOut


class EndpointIn(Model):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    base_url: str = Field(default="", max_length=400)
    models: list[str] = Field(default=[])
    concurrency: int = Field(default=8, ge=1, le=256)
    price: float | None = Field(default=None, ge=0)
    api_key: str | None = Field(default=None, max_length=400)
    """只能写入，不会读出；不传表示不修改，传空字符串表示清除。"""
    timeout: float = Field(default=600.0, ge=5, le=3600)
    max_retries: int = Field(default=8, ge=0, le=20)


class EndpointOut(ResourceInfo):
    id: str
    resource_space: Literal["workspace", "public"]
    name: str
    kind: Literal["openai", "fake"]
    base_url: str
    models: list[str]
    concurrency: int
    price: float | None
    has_key: bool
    builtin: bool
    configured: bool
    verified: bool = False
    timeout: float
    max_retries: int


class ModelCheckOut(Model):
    model: str
    ok: bool
    latency_ms: int | None
    message: str


class EndpointTestOut(Model):
    ok: bool
    model: str | None
    latency_ms: int | None
    message: str
    available: list[str] | None = None
    """接口提供的模型（GET /models）；读不到时为空，原因在 models_error。"""
    models_error: str | None = None
    checks: list[ModelCheckOut] = Field(default=[])
    """每个登记的模型按算法实际用的生成参数各试一次的结果。"""


class EndpointModelsOut(Model):
    models: list[str]


class ModelListIn(Model):
    base_url: str = Field(min_length=1, max_length=400)
    api_key: str | None = Field(default=None, max_length=400)
    """不填时用 endpoint_id 这个接口已经保存的密钥。"""
    endpoint_id: str | None = None
