"""在生成全部完成后冻结五批记录、执行代码与调用边界。"""

import fcntl
import importlib.metadata
import sys
import tempfile
from collections import Counter
from pathlib import Path

from fedagent_records.fot import RecordFoT

from ...common import digest, jsonl, load, rows, save
from ..generation.prepare import ROOT
from ..generation.prepare import prepare as generation_prepare
from ..generation.progress import usage

PACKAGE = Path(__file__).parent


def files_at(directory):
    return {
        str(p.relative_to(directory)): digest(p.read_bytes().hex())
        for p in sorted(directory.rglob("*"))
        if p.is_file() and p.name != ".lock" and p.suffix != ".log" and "__pycache__" not in p.parts
    }


def implementation():
    paths = list(PACKAGE.glob("*.py"))
    for folder in ("server/fedagent", "server/sdk/fedagent_sdk"):
        paths += list((ROOT / folder).rglob("*.py"))
    paths += [ROOT / ("tools/lifestyle/" + name) for name in ("common.py", "model.py", "runner.py", "batch/federate.py")]
    paths += [ROOT / "server/uv.lock"]
    return {
        "files": {str(p.relative_to(ROOT)): digest(p.read_bytes().hex()) for p in sorted(paths)},
        "plugin": RecordFoT().code_hash(),
        "python": sys.version,
        "versions": {p: importlib.metadata.version(p) for p in ("fedagent", "fedagent-sdk", "httpx", "sqlalchemy", "pydantic")},
    }


def capacity(record_count):
    factor = record_count * 3 / 90
    result = {
        "maxTraces": record_count * 3,
        "profileOutputTokens": 5587 * factor,
        "profileSeconds": 105.178 * factor,
        "libraryOutputTokens": 1612 * factor,
        "librarySeconds": 35.907 * factor,
    }
    if (
        result["profileOutputTokens"] > 32768 * 0.6
        or result["libraryOutputTokens"] > 16384 * 0.6
        or max(result["profileSeconds"], result["librarySeconds"]) > 600 * 0.7
    ):
        raise ValueError("batch-extrapolation-risk")
    return result


def prepare(directory):
    generation = directory.parent / "generation"
    if not generation.exists():
        raise ValueError("all444-generation-must-complete-first")
    with (generation / ".lock").open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError("generation-lock-held; wait-for-process-exit-before-freezing") from error
        return _prepare_locked(directory, generation)


def _prepare_locked(directory, generation):
    gp, cases = generation_prepare(generation)
    status, states = usage(generation, gp, cases)
    if status["state"]["status"] != "complete" or any(v != "generated" for v in states.values()) or status["counts"]["unresolvedDispatches"]:
        raise ValueError("all444-generation-must-complete-first")
    identity = load(generation / "model.json")
    records = {c["id"]: load(generation / "units" / (c["id"] + ".json"))["value"] for c in cases}
    batches = []
    uploads = {}
    for index in range(5):
        chosen = cases[index::5]
        name = f"batch-{index + 1:02}"
        counts = dict(sorted(Counter(c["source"] for c in chosen).items()))
        if len(chosen) > 90 or set(counts) != set(gp["counts"]):
            raise ValueError("batch-size-or-sources-invalid")
        for source in counts:
            uploads[f"{name}-{source}.jsonl"] = [records[c["id"]] for c in chosen if c["source"] == source]
        batches.append({"id": name, "count": len(chosen), "sources": counts, "ids": [c["id"] for c in chosen], "capacityPlanningOnly": capacity(len(chosen))})
    if len({i for b in batches for i in b["ids"]}) != 444 or sum(b["count"] for b in batches) != 444:
        raise ValueError("partition-must-cover-all444-once")
    plan = {
        "protocol": "lifestyle-full-federation/1",
        "generationFingerprint": gp["fingerprint"],
        "generationFiles": files_at(generation),
        "generationAttempts": status["remoteAttempts"],
        "identity": identity,
        "modelRef": gp["modelRef"],
        "counts": gp["counts"],
        "batches": batches,
        "globalCallCap": 1500,
        "batchCallCap": 250,
        "contextCap": 1050000,
        "params": {"insightTarget": "paper-auto", "maxTracesPerItem": 3, "aggregationRetries": 5},
        "implementation": implementation(),
    }
    plan["fingerprint"] = digest(plan)
    target = directory / "inputs"
    if target.exists():
        manifest = load(target / "manifest.json")
        if manifest["manifestDigest"] != digest({k: v for k, v in manifest.items() if k != "manifestDigest"}):
            raise ValueError("federation-manifest-corrupt")
        actual = {p.name: digest(p.read_bytes().hex()) for p in target.iterdir() if p.name != "manifest.json"}
        if actual != manifest["outputs"] or load(target / "plan.json") != plan:
            raise ValueError("frozen-federation-input-or-code-changed")
        return plan
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=directory, prefix=".inputs-") as temp:
        staging = Path(temp)
        save(staging / "plan.json", plan)
        for name, values in uploads.items():
            jsonl(staging / name, values)
        manifest = {"outputs": {p.name: digest(p.read_bytes().hex()) for p in staging.iterdir()}}
        manifest["manifestDigest"] = digest(manifest)
        save(staging / "manifest.json", manifest)
        staging.rename(target)
    return plan


def records_for(directory, batch):
    values = {source: rows(directory / "inputs" / (batch["id"] + "-" + source + ".jsonl")) for source in batch["sources"]}
    if Counter({s: len(v) for s, v in values.items()}) != batch["sources"] or {r["id"] for v in values.values() for r in v} != set(batch["ids"]):
        raise ValueError("batch-record-count-or-identity-changed")
    return values
