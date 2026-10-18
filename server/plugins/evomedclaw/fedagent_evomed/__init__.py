"""EvoMedClaw 横向文本病例适配：诊断私有、独立评测、过程卡聚合和回用。"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

from fedagent_sdk import (
    Algorithm,
    ApplyRequest,
    ApplyResult,
    Artifact,
    Estimate,
    Issue,
    Model,
    OutputEntry,
    StepContext,
    StepFailed,
    TaskSpec,
    UnitResult,
    load_manifest,
    step,
)

from .bridge import diagnose
from .contracts import ClinicalDelta, DiagnosticTrajectory, validate_output
from .medical import DiagnosisExactGrader, MedicalDiagnosis
from .vendor.federated.aggregate import aggregate_site_deltas
from .vendor.federated.sanitize import build_federated_site_delta
from .vendor.federated.types import FederatedSiteDelta
from .vendor.learning.card_compiler import compile_card_bank
from .vendor.learning.legacy_bank_export import build_legacy_bank_payload
from .vendor.learning.retrieve_trace import generate_retrieval_traces
from .vendor.learning.skill_attribution import summarize_skill_attribution
from .vendor.learning.trajectory_canonicalizer import canonicalize_artifacts
from .vendor.learning.types import RawScenarioArtifacts

CARD_LABELS = {"test_card": "检查经验", "route_card": "科室路由", "clue_card": "会诊线索", "synthesis_card": "诊断综合", "error_card": "失败经验"}


class EvoMedClaw(Algorithm):
    manifest = load_manifest(Path(__file__).with_name("manifest.yaml"))
    min_samples_per_site = 2

    def validate_participant_result(self, ctx: StepContext, result: UnitResult) -> None:
        validate_output(ctx, result)

    def agent_output_contract(self) -> dict[str, Any]:
        return {
            "diagnose": {"keptKey": "diagnostic_trajectory", "valueSchema": DiagnosticTrajectory.model_json_schema(),
                         "prediction": "eval 病例必须返回与 predicted_diagnosis 一致的预测；learn 病例不评测"},
            "learn": {"channel": "clinical-cards", "payloadSchema": ClinicalDelta.model_json_schema(),
                      "privacy": "不得上传原始病例、诊断对话、病例编号或自由文本推理；只上传规范内经验字段"},
        }

    def validate(self, spec: TaskSpec) -> list[Issue]:
        return ([Issue("participants", "医疗试跑每方至少取 2 条病例，保留经验生成与独立评测各一条")]
                if any(site.items < 2 for site in spec.sites) else [])

    def model_settings(self) -> dict[str, Any]:
        return {"max_tokens": 4096, "temperature": 0}

    def estimate(self, spec: TaskSpec) -> Estimate:
        result = super().estimate(spec)
        calls = int(spec.params.get("maxTurns", 12)) * 3 + 3
        result.participant_calls *= calls
        result.calls_are_upper_bound = True
        result.participant_tokens = result.participant_calls * 1800
        return result

    @step("diagnose")
    def diagnose_case(self, ctx: StepContext) -> None:
        artifact = ctx.artifact()
        memory = artifact.content.get("memory") if artifact is not None else None
        case = MedicalDiagnosis().strip_labels(dict(ctx.item.fields))
        result, _ = diagnose(case, memory, ctx.model, turns=int(ctx.params.get("maxTurns", 12)))
        prediction = str(result["predicted_diagnosis"]).strip()
        if not prediction or "[maximum inferences reached]" in prediction:
            raise StepFailed("本方诊断未形成有效结果，请重试或调整问诊上限")
        ctx.keep("diagnostic_trajectory", result)
        # 评测病例绝不进入后续经验提炼。
        if case.get("split") == "eval":
            ctx.predict(prediction)
        ctx.log(f"病例完成：{result['num_turns']} 回合，{result['num_tests']} 项检查，{result['num_consultations']} 次会诊")

    @step("learn")
    def learn(self, ctx: StepContext) -> None:
        trajectories = []
        grader = DiagnosisExactGrader()
        for item in ctx.items():
            if item.get("split") != "learn":
                continue
            result = ctx.recall("diagnostic_trajectory", item_id=item.id)
            if not isinstance(result, dict):
                raise StepFailed("经验生成病例的诊断轨迹缺失", pause=True)
            scenario_id = int(hashlib.sha256(item.id.encode()).hexdigest()[:12], 16)
            outcome = {"scenario_id": scenario_id, "answer": re.sub(r"^DIAGNOSIS READY:\s*", "", result["predicted_diagnosis"], flags=re.I),
                       "is_correct": grader.grade(result["predicted_diagnosis"], item.fields)}
            artifacts = RawScenarioArtifacts(Path("private-site"), outcome, result["dialogue_history"], result["consultation_history"])
            trajectories.append(canonicalize_artifacts(artifacts))
        if not trajectories:
            raise StepFailed("所选病例缺少经验生成分组", pause=True)
        bank = compile_card_bank(trajectories)
        traces = generate_retrieval_traces(trajectories, bank, top_k=3)
        attribution = summarize_skill_attribution(traces, bank)
        delta = build_federated_site_delta(site_id=ctx.site.id, card_bank=bank, attribution_report=attribution).to_dict()
        delta["metadata"] = {"round": ctx.round, "plugin_version": self.version}
        ctx.keep("local_card_bank", bank.to_dict())
        ctx.send("clinical-cards", delta)

    @step("aggregate")
    def aggregate(self, ctx: StepContext) -> None:
        deltas = []
        seen: set[str] = set()
        for message in ctx.inbox("clinical-cards"):
            data = message.payload
            if data.get("site_id") != message.sender or data.get("metadata") != {"round": ctx.round, "plugin_version": self.version}:
                raise StepFailed("经验更新的参与方、轮次或版本不匹配", pause=True)
            if message.sender in seen:
                raise StepFailed("同一参与方重复提交经验更新", pause=True)
            seen.add(message.sender)
            deltas.append(FederatedSiteDelta.from_dict(data))
        bank = aggregate_site_deltas(deltas)
        memory = build_legacy_bank_payload(bank)
        for entry in memory["entries"]:
            entry.pop("heldout_success_rate", None)
        cards = bank.to_dict()["cards"]
        for card in cards:
            for field in ("heldout_lift", "verifier_score", "false_trigger_rate", "source_cases"):
                card.pop(field, None)
        ctx.publish({"cards": cards, "memory": memory, "metadata": {"source_sites": len(seen), "round": ctx.round}})

    def apply(self, artifact: Artifact | None, request: ApplyRequest, model: Model) -> ApplyResult:
        if not isinstance(request.input, dict):
            raise ValueError("医疗应用需要结构化病例")
        result, usage = diagnose(MedicalDiagnosis().strip_labels(request.input), artifact.content.get("memory") if artifact else None, model)
        output = re.sub(r"^DIAGNOSIS READY:\s*", "", str(result["predicted_diagnosis"]), flags=re.I)
        return ApplyResult(output, usage,
                           {key: result[key] for key in ("num_turns", "num_tests", "num_consultations")})

    def describe(self, artifact: Artifact) -> list[OutputEntry]:
        return [OutputEntry(card["entry_id"], card.get("target_action") or card.get("target_diagnosis_shift") or card["minimal_rationale"],
                            CARD_LABELS.get(card["memory_type"], "过程经验")) for card in artifact.content.get("cards", [])]

    def fake_reply(self, step_id: str | None, prompt: str, seed: str) -> str | None:
        # 仅由开发／测试的假模型执行，生产接口不使用此分支。
        if "local clinic doctor" in prompt or "single most likely diagnosis" in prompt:
            return "DIAGNOSIS READY: migraine"
        if "patient" in prompt.lower():
            return "I have a recurrent unilateral headache with light sensitivity."
        return "Working Differential: migraine\nRecommendations: review headache pattern."
