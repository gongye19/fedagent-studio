"""EvoMedClaw 横向文本病例适配：诊断私有、独立评测、过程卡聚合和回用。"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, cast

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
from .contracts import ClinicalDelta, validate_output
from .medical import MedicalDiagnosis
from .vendor.federated.aggregate import aggregate_site_deltas
from .vendor.federated.types import FederatedSiteDelta
from .vendor.learning.legacy_bank_export import build_legacy_bank_payload

CARD_LABELS = {"test_card": "检查经验", "route_card": "科室路由", "clue_card": "会诊线索", "synthesis_card": "诊断综合", "error_card": "失败经验"}


class EvoMedClaw(Algorithm):
    manifest = load_manifest(Path(__file__).with_name("manifest.yaml"))
    min_samples_per_site = 2

    def validate_participant_result(self, ctx: StepContext, result: UnitResult) -> None:
        validate_output(ctx, result)

    def agent_output_contract(self):
        return {
            "diagnose": {"predictions": "仅eval病例返回最终诊断；learn病例跳过，不上传完整轨迹",
                         "reports": "experience: {version: 整数或null, retrieved: 命中卡ID数组}"},
            "learn": {"channel": "clinical-cards", "payloadSchema": ClinicalDelta.model_json_schema(),
                      "privacy": "本站保留轨迹与完整卡库，中心仅接收精简更新"},
            "load_memory": {"keptKey": "memory_receipt", "valueSchema": "{version, round, sha256}",
                            "reports": "memoryVersion必须等于输入经验版本"},
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

    def manifest_for_version(self, version):
        if version == "1.0.0":
            return load_manifest(Path(__file__).with_name("legacy-manifest.yaml"))
        return super().manifest_for_version(version)

    def plan(self, round, rounds):
        # 第1轮为基线；最后一轮只加载与评测，不生成未经评测的最终成果。
        return (["load_memory"] if round > 1 else []) + ["diagnose"] + (["learn", "aggregate"] if round < rounds else [])

    @step("load_memory")
    def load_memory(self, ctx):
        from .site import load_memory
        load_memory(ctx)

    @step("diagnose")
    def diagnose_case(self, ctx):
        from .site import diagnose_case
        diagnose_case(ctx)

    @step("learn")
    def learn(self, ctx):
        from .site import learn
        learn(ctx, self.version)

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
        result, usage = diagnose(MedicalDiagnosis().strip_labels(request.input), artifact.content.get("memory") if artifact else None,
                                 model, turns=cast(int, self.manifest.params_of({})["maxTurns"]))
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
