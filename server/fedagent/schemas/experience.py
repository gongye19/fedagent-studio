from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, model_validator

from .base import Model

Arm = Literal["none", "local", "federated"]
Change = Literal["improved", "worsened", "unchanged", "incomplete"]
Status = Literal["queued", "running", "paused", "canceled", "completed"]
Department = Literal[
    "全科", "呼吸内科", "消化内科", "心内科", "神经内科", "内分泌科", "感染科",
    "儿科", "妇产科", "皮肤科", "骨科", "耳鼻喉科", "泌尿科", "急诊科",
]


class ChatMessage(Model):
    role: Literal["user", "assistant"]
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=6000)]


class ChatIn(Model):
    model: str = Field(min_length=1, max_length=160)
    messages: list[ChatMessage] = Field(min_length=1, max_length=39)

    @model_validator(mode="after")
    def check_dialogue(self):
        if len(self.messages) % 2 != 1 or any(
            message.role != ("user" if index % 2 == 0 else "assistant") for index, message in enumerate(self.messages)
        ):
            raise ValueError("问诊对话应按用户、助手交替排列，并以用户提问结束")
        if sum(len(message.content) for message in self.messages) > 60000:
            raise ValueError("本次对话过长，请开启新问诊")
        return self


class ChatOut(Model):
    output: str
    experience_entries: int


class ConsultationIn(ChatIn):
    package_id: str | None = Field(default=None, min_length=1, max_length=64)


class ConsultationTurn(Model):
    output: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=6000)]
    department: Department
    suggestions: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]] = Field(
        max_length=3,
    )


class ConsultationOut(ConsultationTurn):
    experience_entries: int


class EvaluationSource(Model):
    site_id: str = Field(min_length=1, max_length=64)
    dataset_id: str | None = Field(default=None, max_length=64)
    jsonl: str | None = Field(default=None, max_length=1_000_000)
    limit: int = Field(default=5, ge=1, le=50)

    @model_validator(mode="after")
    def check_source(self):
        if bool(self.dataset_id) == bool(self.jsonl and self.jsonl.strip()):
            raise ValueError("每个来源请选择一份病例数据，或上传一个 JSONL 文件")
        return self


class EvaluationIn(Model):
    model: str = Field(min_length=1, max_length=160)
    sources: list[EvaluationSource] = Field(min_length=2, max_length=32)


class EvaluationArm(Model):
    output: str | None = None
    correct: bool | None = None
    error: str | None = None
    experience_keys: list[str] = Field(default_factory=list)


class EvaluationCase(Model):
    site_id: str
    case_id: str
    reference: str
    arms: dict[Arm, EvaluationArm]
    change: Change


class EvaluationScore(Model):
    total: int = 0
    paired: int = 0
    attempted: int = 0
    none: int = 0
    local: int = 0
    federated: int = 0
    improved: int = 0
    worsened: int = 0
    unchanged: int = 0


class EvaluationSite(EvaluationScore):
    id: str
    name: str


class EvaluationOut(Model):
    status: Status
    error: str | None
    model: str
    score: EvaluationScore
    sites: list[EvaluationSite]
    cases: list[EvaluationCase]


CaseUsage = Literal["backtest", "heldout"]


class PackageEvaluationIn(Model):
    package_id: str = Field(min_length=1, max_length=64)
    model: str = Field(min_length=1, max_length=160)
    dataset_ids: list[Annotated[str, StringConstraints(min_length=1, max_length=64)]] = Field(min_length=2, max_length=2)
    limit: int = Field(default=100, ge=1, le=100)


class PackageEvaluationSummary(Model):
    id: str
    package_name: str
    total: int
    usage: Literal["backtest", "heldout", "mixed"]
    status: Status
    created_at: datetime


class PackageEvaluationSite(EvaluationSite):
    usage: CaseUsage


class PackageEvaluationResultArm(Model):
    correct: bool | None
    error: str | None


class PackageEvaluationCase(Model):
    site_id: str
    case_id: str
    arms: dict[Arm, PackageEvaluationResultArm]
    change: Change


class PackageEvaluationOut(PackageEvaluationSummary):
    model: str
    error: str | None
    paired: int
    sites: list[PackageEvaluationSite]
    cases: list[PackageEvaluationCase]
