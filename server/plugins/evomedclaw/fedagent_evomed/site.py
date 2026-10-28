"""接入方可复用的本站执行器；完整轨迹只由服务本地保存。"""
import hashlib
import re
from pathlib import Path

from fedagent_sdk import StepFailed

from .bridge import diagnose
from .grading import DiagnosisClinicalGrader
from .medical import MedicalDiagnosis


def receipt(artifact):
    import json

    return {"version": artifact.version, "round": artifact.round,
            "sha256": hashlib.sha256(json.dumps(artifact.content, sort_keys=True, ensure_ascii=False).encode()).hexdigest()}


def load_memory(ctx):
    artifact = ctx.artifact()
    if artifact is None or artifact.kind != "clinical-memory" or not isinstance(artifact.content.get("memory", {}).get("entries"), list):
        raise StepFailed("缺少有效的共享记忆，不能继续评测", pause=True)
    ctx.keep("memory_receipt", receipt(artifact))
    ctx.report("memoryVersion", artifact.version)


def diagnose_case(ctx):
    if ctx.item.get("split") != "eval":
        return
    artifact = ctx.artifact()
    if ctx.round > 1 and (artifact is None or ctx.recall("memory_receipt", item_id="") != receipt(artifact)):
        raise StepFailed("共享记忆尚未确认加载或版本不一致", pause=True)
    case = MedicalDiagnosis().strip_labels(dict(ctx.item.fields))
    result, _ = diagnose(case, artifact.content.get("memory") if artifact else None, ctx.model,
                         turns=int(ctx.params.get("maxTurns", 12)))
    ctx.keep("diagnostic_trajectory", result)
    ctx.predict(result["predicted_diagnosis"])
    hits = sorted({key for event in result["dialogue_history"] for key in event.get("memory_entry_ids", [])})
    ctx.report("experience", {"version": artifact.version if artifact else None, "retrieved": hits})
    ctx.log(f"评测完成：{result['num_turns']} 回合，{len(hits)} 条经验命中")


def learn(ctx, version):
    from .vendor.federated.sanitize import build_federated_site_delta
    from .vendor.learning.card_compiler import compile_card_bank
    from .vendor.learning.retrieve_trace import generate_retrieval_traces
    from .vendor.learning.skill_attribution import summarize_skill_attribution
    from .vendor.learning.trajectory_canonicalizer import canonicalize_artifacts
    from .vendor.learning.types import RawScenarioArtifacts

    artifact = ctx.artifact()
    memory = artifact.content.get("memory") if artifact else None
    trajectories = []
    for item in ctx.items():
        if item.get("split") != "learn":
            continue
        case = MedicalDiagnosis().strip_labels(dict(item.fields))
        result, _ = diagnose(case, memory, ctx.model, turns=int(ctx.params.get("maxTurns", 12)))
        result["is_correct"] = DiagnosisClinicalGrader().evaluate(result["predicted_diagnosis"], item.fields, ctx.model)
        ctx.keep("diagnostic_trajectory", result, item_id=item.id)
        outcome = {"scenario_id": int(hashlib.sha256(item.id.encode()).hexdigest()[:12], 16),
                   "answer": re.sub(r"^DIAGNOSIS READY:\s*", "", result["predicted_diagnosis"], flags=re.I),
                   "is_correct": result["is_correct"]}
        raw = RawScenarioArtifacts(Path("private-site"), outcome, result["dialogue_history"], result["consultation_history"])
        trajectories.append(canonicalize_artifacts(raw))
    if not trajectories:
        raise StepFailed("缺少经验生成病例", pause=True)
    bank = compile_card_bank(trajectories)
    attribution = summarize_skill_attribution(generate_retrieval_traces(trajectories, bank, top_k=3), bank)
    delta = build_federated_site_delta(site_id=ctx.site.id, card_bank=bank, attribution_report=attribution).to_dict()
    delta["metadata"] = {"round": ctx.round, "plugin_version": version}
    ctx.keep("local_card_bank", bank.to_dict())
    ctx.report("localCards", len(bank.cards))
    ctx.report("exportedCards", len(delta["cards"]))
    ctx.send("clinical-cards", delta)
