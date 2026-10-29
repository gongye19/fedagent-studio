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
        allowed_reports = {"diagnose": {"experience"}, "learn": {"learnedCase"}, "compile": {"localCards", "exportedCards"},
                           "load_memory": {"memoryVersion"}, "load_local_memory": set()}
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
                validate_experience(ctx, result.reports.get("experience", {}))
            elif result.predictions:
                raise ValueError("经验生成病例不能提交评测预测")
        elif ctx.step.id == "load_memory":
            from .site import receipt
            artifact = ctx.artifact()
            saved = [value for key, item_id, value in result.kept if key == "memory_receipt" and item_id is None]
            if len(result.kept) != 1 or artifact is None or saved != [receipt(artifact)] or result.reports.get("memoryVersion") != artifact.version:
                raise ValueError("服务未确认加载指定版本的共享记忆")
        elif ctx.step.id == "load_local_memory":
            from .memory import content_receipt
            saved = [value for key, item_id, value in result.kept if key == "local_memory_receipt" and item_id is None]
            if len(result.kept) != 1 or not saved or not valid_receipt(saved[0]):
                raise ValueError("服务未确认本方固定经验版本")
            memory = ctx.recall("local_memory", item_id="")
            if memory is not None and saved[0] != content_receipt(memory):
                raise ValueError("本地经验确认与实际内容不一致")
        elif ctx.step.id == "learn":
            import re
            if result.kept or result.predictions or result.sent:
                raise ValueError("学习病例只能返回完成摘要，轨迹留在本站")
            proof = result.reports.get("learnedCase")
            if ctx.item.get("split") != "learn":
                if proof is not None:
                    raise ValueError("独立评测病例不能生成学习记录")
            elif (not isinstance(proof, dict) or set(proof) != {"id", "sha256"} or proof["id"] != ctx.item.id
                  or not isinstance(proof["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", proof["sha256"])):
                raise ValueError("缺少当前学习病例的有效完成摘要")
        elif ctx.step.id == "compile":
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


def valid_receipt(value):
    import re
    return (isinstance(value, dict) and set(value) == {"sha256", "entries"}
            and isinstance(value["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", value["sha256"])
            and isinstance(value["entries"], list) and all(isinstance(key, str) for key in value["entries"])
            and len(set(value["entries"])) == len(value["entries"]))


def validate_experience(ctx, report):
    from .memory import content_receipt, scope
    if not isinstance(report, dict) or set(report) != {"scope", "version", "sha256", "retrieved"}:
        raise ValueError("经验回用报告结构无效")
    artifact = ctx.artifact()
    if ctx.round < 3 and artifact is not None:
        raise ValueError("本组不允许加载共享经验")
    if report["scope"] != scope(ctx.round) or report["version"] != (artifact.version if artifact else None):
        raise ValueError("评测经验来源或版本不符合当前对照组")
    if ctx.round == 1:
        expected = {"sha256": None, "entries": []}
    elif ctx.round == 2:
        expected = ctx.recall("local_memory_receipt", item_id="")
        if not valid_receipt(expected):
            raise ValueError("本地经验尚未确认")
    else:
        if artifact is None:
            raise ValueError("联邦评测缺少共享经验")
        expected = content_receipt(artifact.content["memory"])
    hits = report["retrieved"]
    if report["sha256"] != expected["sha256"] or not isinstance(hits, list):
        raise ValueError("评测经验摘要与指定版本不一致")
    if any(not isinstance(key, str) or key not in expected["entries"] for key in hits) or len(set(hits)) != len(hits):
        raise ValueError("经验命中记录不属于指定经验版本")


def output_contract():
    return {
        "diagnose": {"predictions": "仅eval病例返回最终诊断；learn病例跳过，禁止回传完整轨迹",
                     "reports": "experience: {scope: none/local/federated, version: 整数或null, sha256: 摘要或null, retrieved: 卡ID数组}"},
        "learn": {"reports": "learnedCase: {id: 当前learn病例ID, sha256: 本站诊疗结果摘要}；eval病例跳过",
                  "privacy": "每个病例独立持久化；完整轨迹留在本站，恢复时跳过已经完成的病例"},
        "compile": {"channel": "clinical-cards", "payloadSchema": ClinicalDelta.model_json_schema(),
                    "privacy": "按原始病例顺序汇总本站轨迹；每方只编译一次经验库并上传精简卡，不再运行诊断或调用模型"},
        "load_local_memory": {"keptKey": "local_memory_receipt", "valueSchema": "{sha256, entries: 本地卡ID数组}",
                              "behavior": "确认本次任务本站生成的固定版本；只返回摘要与卡ID，不返回本地轨迹"},
        "load_memory": {"keptKey": "memory_receipt", "valueSchema": "{version, round, sha256}",
                        "reports": "memoryVersion必须等于输入经验版本"},
    }
