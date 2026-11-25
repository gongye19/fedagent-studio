"""冻结新小试；原数值预测试验及全部旧资料受哈希保护。"""

from pathlib import Path

from ..common import digest, jsonl, load, rows, save
from ..full.federation.prepare import ROOT
from ..sensor_trial.prepare import SOURCE_POLICY, file_hash, selected
from ..sensor_trial.prepare import implementation as reused_implementation
from . import protocol


def implementation():
    value = reused_implementation()
    paths = list(Path(__file__).parent.glob("*.py"))
    paths += [ROOT / "tools/lifestyle/sensor_trial" / name for name in ("transport.py", "retrieval.py")]
    paths += [ROOT / "tools/lifestyle/diet_transport.py"]
    value["files"].update({str(p.relative_to(ROOT)): digest(p.read_bytes().hex()) for p in paths})
    return value


def protected_files(root, exclude):
    return {
        str(p.relative_to(root)): file_hash(p)
        for p in sorted(root.rglob("*"))
        if p.is_file() and not p.is_relative_to(exclude) and p.name != ".lock"
    }


def prepare(directory, source, identity):
    if (directory / "inputs/plan.json").exists():
        return validate(directory)
    if (directory / "inputs").exists() or (directory / "meter").exists():
        raise ValueError("partial-or-paid-job-cannot-reprepare")
    source = source.resolve()
    learning, evaluation, references = selected(source)
    if identity.get("kind") != "openai" or not identity.get("endpoint") or not identity.get("model"):
        raise ValueError("real-model-identity-required")
    target = directory / "inputs.partial"
    target.mkdir(parents=True, exist_ok=False)
    jsonl(target / "learning.jsonl", [case for site in "ABC" for case in learning[site]])
    jsonl(target / "evaluation.jsonl", evaluation)
    save(
        target / "people.json",
        {
            "learning": sorted({r["participant_id"] for v in learning.values() for r in v}),
            "evaluation": sorted({r["participant_id"] for r in references}),
        },
    )
    save(target / "criteria.json", protocol.CRITERIA)
    save(target / "guidance.json", protocol.GUIDANCE)
    (target / "ATTRIBUTION.txt").write_bytes((source / "ATTRIBUTION.txt").read_bytes())
    protected = protected_files(ROOT / "data/lifestyle-prep", directory)
    tag = digest({"protocol": "cg-diet-advice/1", "source": SOURCE_POLICY, "learning": learning, "identity": identity})[:10]
    plan = {
        "protocol": "cg-diet-advice/1",
        "source": str(source),
        "sourcePolicy": SOURCE_POLICY,
        "identity": identity,
        "modelRef": identity["endpoint"] + ":" + identity["model"],
        "authorization": "2026-11-25用户要求调整后再跑一轮；独立六学六测饮食推荐小试，不部署。",
        "normalCalls": {"adviceRecords": 6, "nativeFoT": 15, "answers": 12, "blindJudging": 3, "total": 36},
        "globalCallCap": 40,
        "protectedDigest": digest(protected),
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
                        "name": f"CGMacros饮食建议 {site} · {tag}",
                        "sourceName": f"CGMacros模拟站点 {site} · {tag}",
                        "description": "公开餐食观测与官方依据上的模型模拟饮食建议；非真实医院、非干预有效性标签；仅本机小试。",
                    }
                    for site in "ABC"
                },
            }
        ],
        "learningIds": sorted(r["id"] for v in learning.values() for r in v),
        "evaluationIds": [r["id"] for r in evaluation],
        "blindMaps": {
            r["id"]: ({"X": "baseline", "Y": "shared"} if i % 2 else {"X": "shared", "Y": "baseline"}) for i, r in enumerate(evaluation)
        },
        "implementation": implementation(),
        "files": {p.name: file_hash(p) for p in sorted(target.iterdir())},
    }
    plan["fingerprint"] = digest(plan)
    save(target / "plan.json", plan)
    target.rename(directory / "inputs")
    # 保护集不含当前新目录；旧实验结果和账本均不可覆盖。
    save(directory / "verification/protected-before.json", protected)
    return validate(directory)


def validate(directory):
    plan = load(directory / "inputs/plan.json")
    validate_frozen(directory, plan)
    current = implementation()
    if plan["implementation"] != current or (directory / "recovery.json").exists():
        from .recovery import receipt

        approved = receipt(directory, plan, current)
        return {**plan, "globalCallCap": approved["callCap"], "recovery": approved}
    return plan


def validate_frozen(directory, plan):
    target = directory / "inputs"
    if digest({k: v for k, v in plan.items() if k != "fingerprint"}) != plan["fingerprint"]:
        raise ValueError("plan-changed")
    if plan["protocol"] != "cg-diet-advice/1" or plan["globalCallCap"] != 40:
        raise ValueError("policy-changed")
    actual = {
        p.name: file_hash(p) for p in target.iterdir() if p.name != "plan.json" and p.name not in {f"batch-01-{s}.jsonl" for s in "ABC"}
    }
    if (
        actual != plan["files"]
        or load(target / "criteria.json") != protocol.CRITERIA
        or load(target / "guidance.json") != protocol.GUIDANCE
    ):
        raise ValueError("frozen-input-changed")
    learning, evaluation, _ = selected(Path(plan["source"]))
    if rows(target / "learning.jsonl") != [c for site in "ABC" for c in learning[site]] or rows(target / "evaluation.jsonl") != evaluation:
        raise ValueError("source-selection-changed")
    protected = load(directory / "verification/protected-before.json")
    root = ROOT / "data/lifestyle-prep"
    if digest(protected) != plan["protectedDigest"] or any(
        not (root / p).is_file() or file_hash(root / p) != expected for p, expected in protected.items()
    ):
        raise ValueError("previous-experiment-file-changed")
