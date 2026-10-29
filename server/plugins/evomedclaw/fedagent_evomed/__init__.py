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
from .contracts import validate_output
from .medical import MedicalDiagnosis
from .vendor.federated.types import FederatedSiteDelta

CARD_LABELS = {"test_card": "检查经验", "route_card": "科室路由", "clue_card": "会诊线索", "synthesis_card": "诊断综合", "error_card": "失败经验"}


class EvoMedClaw(Algorithm):
    manifest = load_manifest(Path(__file__).with_name("manifest.yaml"))
    min_samples_per_site = 2

    def validate_participant_result(self, ctx: StepContext, result: UnitResult) -> None:
        validate_output(ctx, result)

    def agent_output_contract(self):
        from .contracts import output_contract
        return output_contract()

    def validate(self, spec: TaskSpec) -> list[Issue]:
        return ([Issue("participants", "医疗试跑每方至少取 2 条病例，保留经验生成与独立评测各一条")]
                if any(site.items < 2 for site in spec.sites) else [])

    def model_settings(self) -> dict[str, Any]:
        return {"max_tokens": 4096, "temperature": 0}

    def estimate(self, spec: TaskSpec) -> Estimate:
        # 生成一次学习病例，三组各评测同一批独立病例。按正常路径上限计。
        evaluations = sum(site.sample_counts.get("独立评测", site.items) for site in spec.sites)
        learning = sum(site.sample_counts.get("经验生成", site.items) for site in spec.sites)
        calls = int(spec.params.get("maxTurns", 12)) * 2 + 32
        diagnoses = learning + 3 * evaluations
        return Estimate(participant_calls=diagnoses * calls + learning,
                        participant_tokens=(diagnoses * calls + learning) * 1800,
                        seconds=diagnoses * 100 // max(1, min(spec.workers, len(spec.sites))),
                        exchanged=learning, calls_are_upper_bound=True)

    def manifest_for_version(self, version):
        if version in ("1.1.0", "1.2.0"):
            return load_manifest(Path(__file__).with_name("v1.2-manifest.yaml")).model_copy(update={"version": version})
        if version == "1.0.0":
            return load_manifest(Path(__file__).with_name("legacy-manifest.yaml"))
        return super().manifest_for_version(version)

    def plan(self, round, rounds):
        # 内部编号只用于调度；用户看到的是三组固定对照，不进行多轮学习。
        return {1: ["diagnose"], 2: ["learn", "load_local_memory", "diagnose", "aggregate"],
                3: ["load_memory", "diagnose"]}[round]

    @step("load_memory")
    def load_memory(self, ctx):
        from .site import load_memory
        load_memory(ctx)

    @step("load_local_memory")
    def load_local_memory(self, ctx):
        from .site import load_local_memory
        load_local_memory(ctx)

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
        from .memory import shared_content
        content = shared_content([delta.to_dict() for delta in deltas])
        ctx.publish({**content, "metadata": {"source_sites": len(seen), "round": ctx.round}})

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

    def describe_message(self, channel, payload):
        cards = payload.get("cards", []) if isinstance(payload, dict) else []
        return OutputEntry(f"经验更新 · {len(cards)} 张卡", "本次上传的精简经验卡", "经验更新")

    def describe_message_items(self, channel, payload):
        cards = payload.get("cards", []) if isinstance(payload, dict) else []
        from .exchange import card_entries
        return card_entries(cards, CARD_LABELS)

    def fake_reply(self, step_id: str | None, prompt: str, seed: str) -> str | None:
        # 仅由开发／测试的假模型执行，生产接口不使用此分支。
        if "CLINICAL EQUIVALENCE" in prompt:
            return "[0.0]"
        if "local clinic doctor" in prompt or "single most likely diagnosis" in prompt:
            return "DIAGNOSIS READY: migraine"
        if "patient" in prompt.lower():
            return "I have a recurrent unilateral headache with light sensitivity."
        return "Working Differential: migraine\nRecommendations: review headache pattern."
