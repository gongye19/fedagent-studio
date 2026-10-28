from __future__ import annotations

from typing import Literal

from pydantic import Field

from .base import Model


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
    requires_model: bool = False


class InputFieldOut(Model):
    key: str
    label: str
    kind: Literal["text", "textarea", "json"]
    required: bool = True
    help: str = ""


class TaskTypeOut(Model):
    id: str
    label: str
    metric: str
    grader: str | None
    graders: list[GraderOut]
    format: str
    unlabeled_note: str
    placeholder: str
    schema_version: str = "1.0"
    structured_input: bool = False
    input_label: str = "问题"
    answer_label: str = "标准答案"
    input_fields: list[InputFieldOut] = Field(default=[])


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


class ResourceRequirementsOut(Model):
    agent_required: bool = False
    data_required: bool
    min_sources: int
    min_samples: int
    participant_model: bool
    server_model: bool
    server_model_label: str = "汇总模型"
    execution_label: str
    execution_modes: list[Literal["platform", "local", "agent"]]


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
    min_samples: int = 1
    min_rounds: int
    max_rounds: int
    default_rounds: int
    source: SourceOut
    requirements: ResourceRequirementsOut


class RegistryOut(Model):
    scenarios: list[ScenarioOut]
    task_types: list[TaskTypeOut]
    algorithms: list[AlgorithmOut]


class MetaOut(Model):
    version: str
    auth_required: bool
    client_packages: list[str] = Field(default=[])
    """/client/ 下能下载的安装包文件名（客户端、SDK 和插件）；没有构建时为空。"""
