"""固定既有六学六测清单、原插件和运行代码；准备不触发付费请求。"""

import hashlib
from collections import Counter
from pathlib import Path

from fedagent_records.lifestyle import LifestyleRecords
from fedagent_sdk import Row

from ..common import digest, jsonl, load, rows, save
from ..full.federation.prepare import ROOT
from ..full.federation.prepare import implementation as platform_implementation
from ..sensor_samples.common import verify_input
from .adapter import record

SOURCE_POLICY = {
    "sourceVersion": "e4820d0b02a4f95c755f4e6af607534609e724ca41411f8b2ed92712ef28270b",
    "sourceManifestSha256": "b156b96ef109fb7e102766a47d99ac2614d2bd3ed185e45815113f7e819148ad",
}


def implementation():
    value = platform_implementation()
    paths = list(Path(__file__).parent.glob("*.py"))
    paths += list((ROOT / "tools/lifestyle/sensor_samples").glob("*.py"))
    paths += list((ROOT / "server/plugins/records/fedagent_records").glob("*.py"))
    paths += [ROOT / ("tools/lifestyle/" + name) for name in ("batch/calls.py", "sensors/archives.py", "sensors/common.py")]
    value["files"].update({str(p.relative_to(ROOT)): digest(p.read_bytes().hex()) for p in paths})
    return value


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def selected(source):
    verify_input(source, SOURCE_POLICY)
    proposal = load(source / "budget.json")["proposals"]["cgmacros"]["smoke"]
    if (
        proposal["learningSiteCounts"] != dict.fromkeys("ABC", 2)
        or proposal["evaluationParticipants"] != 6
        or proposal["normalCallsTemplate"] != 27
        or len(proposal["batchAllocation"]) != 1
    ):
        raise ValueError("frozen-smoke-proposal-changed")
    learn_ids, eval_ids = set(proposal["learningIds"]), set(proposal["evaluationIds"])
    learning = {site: [r for r in rows(source / f"learning/cgmacros/site-{site}.jsonl") if r["id"] in learn_ids] for site in "ABC"}
    evaluation = sorted((r for r in rows(source / "evaluation/cgmacros/inputs.jsonl") if r["id"] in eval_ids), key=lambda r: r["id"])
    references = [r for r in rows(source / "references/cgmacros.jsonl") if r["id"] in eval_ids]
    learned = [r for rs in learning.values() for r in rs]
    if (
        len(learned) != 6
        or {r["id"] for r in learned} != learn_ids
        or len(learn_ids) != 6
        or Counter(r["site"] for r in learned) != dict.fromkeys("ABC", 2)
        or len(evaluation) != 6
        or {r["id"] for r in evaluation} != eval_ids
        or len(references) != 6
        or {r["id"] for r in references} != eval_ids
        or len({r["participant_id"] for r in references}) != 6
        or {r["participant_id"] for r in references} & {r["participant_id"] for r in learned}
    ):
        raise ValueError("smoke-selection-or-participant-isolation-invalid")
    if any(set(r) != {"id", "input"} for r in evaluation):
        raise ValueError("evaluation-input-has-reference")
    return learning, evaluation, references


def prepare(directory, source, identity):
    if (directory / "inputs/plan.json").exists():
        return validate(directory)
    if (directory / "inputs").exists() or (directory / "meter").exists():
        raise ValueError("partial-or-paid-job-cannot-reprepare")
    source = source.resolve()
    learning, evaluation, references = selected(source)
    if identity.get("kind") != "openai" or not identity.get("endpoint") or not identity.get("model"):
        raise ValueError("real-openai-model-identity-required")
    records = {}
    for site, cases in learning.items():
        report = LifestyleRecords().check([Row(i + 1, record(case, SOURCE_POLICY["sourceVersion"])) for i, case in enumerate(cases)])
        if report.count != 2 or report.issues:
            raise ValueError("observation-template-contract-invalid")
        records[site] = report.items
    target = directory / "inputs.partial"
    target.mkdir(parents=True, exist_ok=False)
    for site, items in records.items():
        jsonl(target / f"batch-01-{site}.jsonl", items)
    jsonl(target / "evaluation.jsonl", evaluation)
    jsonl(target / "references.jsonl", references)
    (target / "ATTRIBUTION.txt").write_bytes((source / "ATTRIBUTION.txt").read_bytes())
    tag = digest({"source": SOURCE_POLICY, "learning": records})[:10]
    plan = {
        "protocol": "cg-observation-smoke/1",
        "source": str(source),
        "sourcePolicy": SOURCE_POLICY,
        "identity": identity,
        "modelRef": identity["endpoint"] + ":" + identity["model"],
        "authorization": "用户2026-11-24回复可以开始；仅CGMacros 6学/6测，正常27、上限40，不部署",
        "normalCalls": 27,
        "globalCallCap": 40,
        "contextCap": 65536,
        "resourceTag": tag,
        "params": {"insightTarget": "paper-auto", "maxTracesPerItem": 3, "aggregationRetries": 5},
        "batches": [
            {
                "id": "batch-01",
                "count": 6,
                "sources": dict.fromkeys("ABC", 2),
                "labels": {
                    site: {
                        "name": f"CGMacros观测 {site} · {tag}",
                        "sourceName": f"CGMacros模拟站点 {site} · {tag}",
                        "description": "公开餐食和CGM观测的确定性处理记录；非Agent问诊、非推荐效果标签；仅本机小试。",
                    }
                    for site in "ABC"
                },
            }
        ],
        "evaluationIds": [r["id"] for r in evaluation],
        "learningIds": sorted(r["id"] for rs in records.values() for r in rs),
        "implementation": implementation(),
        "files": {p.name: file_hash(p) for p in sorted(target.iterdir())},
    }
    plan["fingerprint"] = digest(plan)
    save(target / "plan.json", plan)
    target.rename(directory / "inputs")
    return validate(directory)


def validate(directory):
    target = directory / "inputs"
    plan = load(target / "plan.json")
    if digest({k: v for k, v in plan.items() if k != "fingerprint"}) != plan["fingerprint"]:
        raise ValueError("trial-plan-changed")
    if (
        plan["protocol"] != "cg-observation-smoke/1"
        or plan["globalCallCap"] != 40
        or plan["normalCalls"] != 27
        or plan["sourcePolicy"] != SOURCE_POLICY
        or plan["implementation"] != implementation()
    ):
        raise ValueError("trial-implementation-or-policy-changed")
    verify_input(Path(plan["source"]), SOURCE_POLICY)
    if {p.name for p in target.iterdir()} != set(plan["files"]) | {"plan.json"}:
        raise ValueError("frozen-file-set-changed")
    for name, expected in plan["files"].items():
        if Path(name).name != name or file_hash(target / name) != expected:
            raise ValueError("frozen-trial-input-changed")
    return plan
