"""医疗 Agent 的业务输出规范，平台和用户侧可共同复用；不调用模型。"""
import re
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
        if ctx.step.id == "diagnose":
            saved = [value for key, item_id, value in result.kept if key == "diagnostic_trajectory" and item_id == ctx.item.id]
            if len(saved) != 1:
                raise ValueError("医疗 Agent 必须返回当前病例的完整 diagnostic_trajectory，不能只返回诊断答案")
            trajectory = DiagnosticTrajectory.model_validate(saved[0])
            if not re.fullmatch(r"DIAGNOSIS READY\s*:\s*\S.*", trajectory.predicted_diagnosis, re.I | re.S):
                raise ValueError("医疗诊断必须形成 DIAGNOSIS READY: 开头的最终诊断")
            if not any(e.speaker == "LocalDoctor" and e.text.strip() == trajectory.predicted_diagnosis.strip()
                       for e in trajectory.dialogue_history):
                raise ValueError("医疗诊断轨迹缺少与最终诊断一致的医生过程记录")
            if ctx.item.get("split") == "eval" and result.predictions != [(ctx.item.id, trajectory.predicted_diagnosis)]:
                raise ValueError("独立评测预测必须与诊断轨迹的最终诊断一致")
        elif ctx.step.id == "learn":
            updates = [message for message in result.sent if message.channel == "clinical-cards"]
            if len(updates) != 1:
                raise ValueError("医疗 Agent 必须提交一份 clinical-cards 经验更新")
            delta = ClinicalDelta.model_validate(updates[0].payload)
            if delta.site_id != ctx.site.id or delta.metadata != {"round": ctx.round, "plugin_version": ctx.manifest.version}:
                raise ValueError("医疗经验的来源、轮次或算法版本不匹配")
    except ValidationError as error:
        detail = error.errors(include_url=False, include_input=False)[0]
        raise ValueError(f"医疗 Agent 输出不符合规范：{'.'.join(map(str, detail['loc']))}（{detail['type']}）") from error
