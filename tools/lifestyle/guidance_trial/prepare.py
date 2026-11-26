"""冻结345条四来源知识、24道未用于此前作答的题及代码，不调用收费模型。"""

import hashlib
import shutil
from collections import Counter
from pathlib import Path

from ..batch.prepare import frozen
from ..common import digest, jsonl, load, rows, save
from ..full.comparison.prepare import FILES, OLD, upstream
from ..full.generation.prepare import MODEL_REF, ROOT, SOURCE, source_rows
from .protocol import VERSION

COUNTS = {"CDC": 61, "NHLBI": 8, "NHS": 191, "NIDDK": 85}
DEFAULT = ROOT / "data/lifestyle-prep/guidance-trial/run-20261126"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def implementation():
    files = [*Path(__file__).parent.glob("*.py")]
    files += [
        ROOT / ("tools/lifestyle/" + p)
        for p in (
            "common.py",
            "model.py",
            "diet_transport.py",
            "sensor_trial/transport.py",
            "batch/calls.py",
            "batch/healthbench.py",
            "batch/evaluate.py",
            "full/federation/budget.py",
            "full/generation/prepare.py",
            "dedup/core.py",
            "batch/prepare.py",
            "full/comparison/prepare.py",
        )
    ]
    files += [
        ROOT / "server/plugins/fot/fedagent_fot" / p
        for p in ("prompts.py", "parsing.py", "profile_repair.py")
    ]
    files += [ROOT / "server/uv.lock"]
    return {str(p.relative_to(ROOT)): sha(p) for p in sorted(files)}


def prepare(directory, identity):
    if directory.exists():
        raise ValueError("new-experiment-directory-required")
    original, source_fingerprint = source_rows(SOURCE)
    selected = [r for r in original if r["source"] in COUNTS]
    if Counter(r["source"] for r in selected) != COUNTS or any(
        r["layer"] != "guidance" for r in selected
    ):
        raise ValueError("four-source-counts-changed")
    # Sorted source-interleaving is fixed before seeing outputs.
    pools = {
        s: sorted([r for r in selected if r["source"] == s], key=lambda r: r["id"])
        for s in COUNTS
    }
    records = []
    while any(pools.values()):
        for name in COUNTS:
            if pools[name]:
                row = pools[name].pop(0)
                records.append({"id": row["id"], **row["original"]})
    upstream()  # Validate original grader text/license and old question manifest.
    corpus = ROOT / "data/lifestyle-prep/corpus/final-20261118/prepared"
    frozen(corpus)
    old = {c["id"] for c in rows(OLD / "evaluation-inputs.jsonl")}
    old |= {
        c["id"]
        for c in rows(
            ROOT / "data/lifestyle-prep/case-eval/run-20261125/inputs/cases.jsonl"
        )
    }
    cases = sorted(
        [
            c
            for c in rows(corpus / "evaluation-inputs.jsonl")
            if c["source"] == "HealthBench" and c["id"] not in old
        ],
        key=lambda c: c["id"],
    )[:24]
    refs = {r["id"]: r for r in rows(corpus / "evaluation-references.jsonl")}
    references = [refs[c["id"]] for c in cases]
    if len(cases) != 24:
        raise ValueError("not-enough-unused-evaluation-cases")
    batches = [records[i : i + 12] for i in range(0, len(records), 12)]
    normal = (
        2 * len(records)
        + 2 * len(batches)
        + 2 * len(cases)
        + 2 * sum(len(r["rubrics"]) for r in references)
    )
    plan = {
        "protocol": VERSION,
        "modelRef": MODEL_REF,
        "identity": identity,
        "counts": COUNTS,
        "sourceFingerprint": source_fingerprint,
        "sourceDigest": digest(records),
        "evaluationIds": [c["id"] for c in cases],
        "excludedOldEvaluationIds": sorted(old),
        "evaluationDigest": digest({"cases": cases, "references": references}),
        "batchIds": [f"batch-{i + 1:02d}" for i in range(len(batches))],
        "batchSize": 12,
        "normalCalls": normal,
        "globalCallCap": 1800,
        "evaluationCap": 850,
        "batchCap": 100,
        "contextCap": 131072,
        "implementation": implementation(),
        "adaptation": "领域反思/提取；FoT原归类及局部修正；自动数量引用合并、正文不改写；固定词项选择至多8张卡",
    }
    plan["namespaces"] = ["meter-" + n for n in plan["batchIds"]] + ["meter-evaluation"]
    plan["fingerprint"] = digest(plan)
    directory.mkdir(parents=True)
    jsonl(directory / "inputs/sources.jsonl", records)
    jsonl(directory / "inputs/evaluation-inputs.jsonl", cases)
    jsonl(directory / "inputs/evaluation-references.jsonl", references)
    for name in FILES[2:]:
        shutil.copyfile(OLD / name, directory / "inputs" / name)
    plan["graderFiles"] = {name: sha(directory / "inputs" / name) for name in FILES[2:]}
    plan.pop("fingerprint")
    plan["fingerprint"] = digest(plan)
    save(directory / "plan.json", plan)
    return plan


def validate(directory):
    plan = load(directory / "plan.json")
    if (
        digest({k: v for k, v in plan.items() if k != "fingerprint"})
        != plan["fingerprint"]
        or implementation() != plan["implementation"]
    ):
        raise ValueError("plan-or-implementation-changed")
    if digest(rows(directory / "inputs/sources.jsonl")) != plan["sourceDigest"]:
        raise ValueError("sources-changed")
    if (
        digest(
            {
                "cases": rows(directory / "inputs/evaluation-inputs.jsonl"),
                "references": rows(directory / "inputs/evaluation-references.jsonl"),
            }
        )
        != plan["evaluationDigest"]
    ):
        raise ValueError("evaluation-changed")
    if any(
        sha(directory / "inputs" / name) != expected
        for name, expected in plan["graderFiles"].items()
    ):
        raise ValueError("grader-or-license-changed")
    return plan
