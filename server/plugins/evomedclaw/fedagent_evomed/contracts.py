"""医疗 Agent 的业务输出规范，平台和用户侧可共同复用；不调用模型。"""
from typing import Any

from fedagent_sdk import StepContext, UnitResult
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, ValidationError


class DialogueEvent(BaseModel):
    speaker: str = Field(min_length=1)
    text: str = Field(min_length=1)


class DiagnosticTrajectory(BaseModel):
    predicted_diagnosis: str = Field(min_length=1)
    dialogue_history: list[DialogueEvent] = Field(min_length=1)
    consultation_history: list[dict[str, Any]]
    num_turns: int = Field(ge=1, strict=True)
    num_tests: int = Field(ge=0, strict=True)
    num_consultations: int = Field(ge=0, strict=True)


class ClinicalCard(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    card_signature: str = Field(min_length=1)
    memory_type: str = Field(pattern=r"^(test|route|clue|synthesis|error)_card$")
    stage: str = Field(min_length=1)
    owner_role: str = Field(min_length=1)
    department: str
    positive_triggers: list[StrictStr] = []
    negative_triggers: list[StrictStr] = []
    target_action: str | None = None
    target_diagnosis_shift: str | None = None
    support_count: StrictInt = Field(default=0, ge=0)
    helpful_hits: StrictInt = Field(default=0, ge=0)
    harmful_hits: StrictInt = Field(default=0, ge=0)
    missed_opportunities: StrictInt = Field(default=0, ge=0)
    neutral_hits: StrictInt = Field(default=0, ge=0)


class ClinicalDelta(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    site_id: str
    cards: list[ClinicalCard]
    metadata: dict[str, Any]


def validate_output(ctx: StepContext, result: UnitResult) -> None:
    try:
        allowed_reports = {"diagnose": {"experience"}, "learn": {"localCards", "exportedCards"}, "load_memory": {"memoryVersion"}}
        if set(result.reports) - allowed_reports.get(ctx.step.id, set()):
            raise ValueError("服务返回了契约未声明的报告字段")
        if ctx.step.id == "diagnose":
            expected = ctx.item.get("split") == "eval"
            if result.kept:
                raise ValueError("完整诊断轨迹必须保留在接入方服务，不得回传中心")
            if expected:
                if (len(result.predictions) != 1 or result.predictions[0][0] != ctx.item.id
                        or not isinstance(result.predictions[0][1], str) or not result.predictions[0][1].strip()):
                    raise ValueError("评测必须返回当前病例的有效诊断预测")
                report = result.reports.get("experience", {})
                if not isinstance(report, dict) or set(report) != {"version", "retrieved"}:
                    raise ValueError("经验回用报告结构无效")
                artifact = ctx.artifact()
                if report.get("version") != (artifact.version if artifact else None) or not isinstance(report.get("retrieved"), list):
                    raise ValueError("评测缺少正确的经验版本及命中记录")
                keys = {entry["entry_id"] for entry in (artifact.content.get("memory", {}).get("entries", []) if artifact else [])}
                if any(not isinstance(key, str) or key not in keys for key in report["retrieved"]):
                    raise ValueError("经验命中记录不属于指定版本")
            elif result.predictions:
                raise ValueError("经验生成病例不能提交评测预测")
        elif ctx.step.id == "load_memory":
            from .site import receipt
            artifact = ctx.artifact()
            saved = [value for key, item_id, value in result.kept if key == "memory_receipt" and item_id is None]
            if len(result.kept) != 1 or artifact is None or saved != [receipt(artifact)] or result.reports.get("memoryVersion") != artifact.version:
                raise ValueError("服务未确认加载指定版本的共享记忆")
        elif ctx.step.id == "learn":
            if result.kept:
                raise ValueError("本站轨迹及卡库不得回传中心")
            updates = [message for message in result.sent if message.channel == "clinical-cards"]
            if len(updates) != 1:
                raise ValueError("医疗 Agent 必须提交一份 clinical-cards 经验更新")
            delta = ClinicalDelta.model_validate(updates[0].payload)
            if delta.site_id != ctx.site.id or delta.metadata != {"round": ctx.round, "plugin_version": ctx.manifest.version}:
                raise ValueError("医疗经验的来源、轮次或算法版本不匹配")
    except ValidationError as error:
        detail = error.errors(include_url=False, include_input=False)[0]
        raise ValueError(f"医疗 Agent 输出不符合规范：{'.'.join(map(str, detail['loc']))}（{detail['type']}）") from error
