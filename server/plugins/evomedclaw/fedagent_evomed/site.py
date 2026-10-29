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
    if (ctx.round != 3 or artifact is None or artifact.round != 2 or artifact.version != 1
            or artifact.kind != "clinical-memory" or not isinstance(artifact.content.get("memory", {}).get("entries"), list)):
        raise StepFailed("缺少有效的共享记忆，不能继续评测", pause=True)
    ctx.keep("memory_receipt", receipt(artifact))
    ctx.report("memoryVersion", artifact.version)
    ctx.progress("load-memory", "加载联邦经验", "completed", summary=f"已确认版本 {artifact.version}")


def diagnose_case(ctx):
    if ctx.item.get("split") != "eval":
        return
    from .memory import content_receipt, evaluation_memory, scope
    memory = evaluation_memory(ctx)
    artifact = ctx.artifact()
    case = MedicalDiagnosis().strip_labels(dict(ctx.item.fields))
    result, _ = diagnose(case, memory, ctx.model,
                         turns=int(ctx.params.get("maxTurns", 12)), progress=ctx.progress, item_id=ctx.item.id)
    ctx.keep("diagnostic_trajectory", result)
    ctx.predict(result["predicted_diagnosis"])
    hits = sorted({key for event in result["dialogue_history"] for key in event.get("memory_entry_ids", [])})
    ctx.report("experience", {"scope": scope(ctx.round), "version": artifact.version if artifact else None,
                              "sha256": content_receipt(memory)["sha256"] if memory is not None else None, "retrieved": hits})
    ctx.log(f"评测完成：{result['num_turns']} 回合，{len(hits)} 条经验命中")


def learn(ctx, version):
    from .vendor.federated.sanitize import build_federated_site_delta
    from .vendor.learning.card_compiler import compile_card_bank
    from .vendor.learning.retrieve_trace import generate_retrieval_traces
    from .vendor.learning.skill_attribution import summarize_skill_attribution
    from .vendor.learning.trajectory_canonicalizer import canonicalize_artifacts
    from .vendor.learning.types import RawScenarioArtifacts

    if ctx.round != 2 or ctx.artifact() is not None:
        raise StepFailed("本地经验只能独立生成一次", pause=True)
    memory = None
    trajectories = []
    for item in ctx.items():
        if item.get("split") != "learn":
            continue
        case = MedicalDiagnosis().strip_labels(dict(item.fields))
        result, _ = diagnose(case, memory, ctx.model, turns=int(ctx.params.get("maxTurns", 12)), progress=ctx.progress, item_id=item.id)
        result["is_correct"] = DiagnosisClinicalGrader().evaluate(result["predicted_diagnosis"], item.fields, ctx.model)
        ctx.keep("diagnostic_trajectory", result, item_id=item.id)
        outcome = {"scenario_id": int(hashlib.sha256(item.id.encode()).hexdigest()[:12], 16),
                   "answer": re.sub(r"^DIAGNOSIS READY:\s*", "", result["predicted_diagnosis"], flags=re.I),
                   "is_correct": result["is_correct"]}
        raw = RawScenarioArtifacts(Path("private-site"), outcome, result["dialogue_history"], result["consultation_history"])
        trajectories.append(canonicalize_artifacts(raw))
    if not trajectories:
        raise StepFailed("缺少经验生成病例", pause=True)
    ctx.progress("compile-cards", "生成经验卡", "running")
    bank = compile_card_bank(trajectories)
    attribution = summarize_skill_attribution(generate_retrieval_traces(trajectories, bank, top_k=3), bank)
    delta = build_federated_site_delta(site_id=ctx.site.id, card_bank=bank, attribution_report=attribution).to_dict()
    delta["metadata"] = {"round": ctx.round, "plugin_version": version}
    from .memory import shared_content
    ctx.keep("local_card_bank", bank.to_dict())
    ctx.keep("local_memory", shared_content([delta])["memory"])
    ctx.report("localCards", len(bank.cards))
    ctx.report("exportedCards", len(delta["cards"]))
    ctx.send("clinical-cards", delta)
    ctx.progress("compile-cards", "生成经验卡", "completed", summary=f"生成 {len(bank.cards)} 张，上传 {len(delta['cards'])} 张")


def load_local_memory(ctx):
    from .memory import content_receipt
    memory = ctx.recall("local_memory", item_id="")
    if ctx.round != 2 or not isinstance(memory, dict) or not isinstance(memory.get("entries"), list):
        raise StepFailed("缺少本方已生成的经验", pause=True)
    ctx.keep("local_memory_receipt", content_receipt(memory))
