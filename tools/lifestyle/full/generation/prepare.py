"""冻结全部444条请求并全量预检；准备不连接模型。"""

from __future__ import annotations

import importlib.metadata
import json
import shutil
import statistics
import sys
import tempfile
from collections import Counter
from pathlib import Path

from fedagent_records.fot import RecordFoT

from ...common import digest, jsonl, load, rows, save
from ...dedup.core import encoded, sha
from .templates import CONTEXT_CAP, SETTINGS, make_case

ROOT = Path(__file__).resolve().parents[4]
PACKAGE = Path(__file__).parent
SOURCE = ROOT / "data/lifestyle-prep/dedup/final2-20261119"
SOURCE_MANIFEST_SHA = "62cd11d8c7349ac67c257bfa10b675c006bfeb1e8bd98130df2e0d208fb9a141"
COUNTS = {"CDC": 61, "MedMCQA": 14, "MedQuAD": 85, "NHLBI": 8, "NHS": 191, "NIDDK": 85}
MODEL_REF = "default:gpt-5.6-luna"


def source_rows(directory):
    raw = (directory / "manifest.json").read_bytes()
    if sha(raw) != SOURCE_MANIFEST_SHA:
        raise ValueError("not-pinned-dedup-manifest")
    manifest = json.loads(raw)
    if sha(encoded({k: v for k, v in manifest.items() if k != "manifestDigest"})) != manifest["manifestDigest"]:
        raise ValueError("source-manifest-corrupted")
    if {p.name for p in directory.iterdir()} - {"verification"} != set(manifest["outputs"]) | {"manifest.json"}:
        raise ValueError("source-output-set-changed")
    for name, expected in manifest["outputs"].items():
        if Path(name).name != name or sha((directory / name).read_bytes()) != expected:
            raise ValueError("source-output-corrupted")
    values = rows(directory / "records.jsonl")
    if len(values) != 444 or len({r["id"] for r in values}) != 444 or Counter(r["source"] for r in values) != COUNTS:
        raise ValueError("source-count-or-id-changed")
    for row in values:
        if sha(encoded(row["original"])) != row["payloadDigest"]:
            raise ValueError("source-payload-changed")
        if row["source"] == "MedQuAD":
            expected = row["id"].startswith("medquad:") and row["layer"] == "evidence"
        elif row["source"] == "MedMCQA":
            expected = row["id"].startswith("medmcqa:train:") and row["layer"] == "optional-support"
        else:
            expected = row["id"].startswith("guidance:") and row["layer"] == "guidance" and row["source"] == row["original"]["publisher"]
        if not expected:
            raise ValueError("source-layer-binding-invalid")
    return values, manifest["fingerprint"]


def implementation():
    paths = list(PACKAGE.glob("*.py"))
    paths += [
        PACKAGE.parent / "__init__.py",
        PACKAGE.parents[1] / "__init__.py",
        PACKAGE.parents[1] / "batch/__init__.py",
        PACKAGE.parents[1] / "dedup/__init__.py",
    ]
    paths += [
        ROOT / ("tools/lifestyle/" + p)
        for p in (
            "common.py",
            "model.py",
            "dedup/core.py",
            "batch/calls.py",
            "batch/generate.py",
            "corpus/sources.json",
        )
    ]
    paths += [
        ROOT / p
        for p in (
            "server/plugins/records/fedagent_records/records.py",
            "server/plugins/records/fedagent_records/lifestyle.py",
            "server/sdk/fedagent_sdk/jsonutil.py",
            "server/uv.lock",
        )
    ]
    return {
        "files": {str(p.relative_to(ROOT)): sha(p.read_bytes()) for p in sorted(paths)},
        "plugin": RecordFoT().code_hash(),
        "python": sys.version,
        "versions": {p: importlib.metadata.version(p) for p in ("fedagent", "fedagent-sdk", "pydantic")},
    }


def statistics_for(cases):
    result = {}
    for field in ("source", "layer"):
        result[field] = {}
        for key in sorted({r[field] for r in cases}):
            values = [r["requestBytes"] for r in cases if r[field] == key]
            result[field][key] = {
                "count": len(values),
                "totalBytes": sum(values),
                "p50Bytes": statistics.median(values),
                "maxBytes": max(values),
            }
    total = sum(r["requestBytes"] for r in cases)
    maximum = max(r["requestBytes"] for r in cases)
    return {
        "by": result,
        "inputBytes": total,
        "inputTokenPlanningRange": [total // 4, total],
        "hardCallInputBytesBound": 500 * maximum,
        "hardCallInputTokenPlanningRange": [500 * maximum // 4, 500 * maximum],
        "normalCalls": 444,
        "hardCallCap": 500,
        "baseOutputTokenCap": 444 * 2200,
        "hardOutputTokenCap": 500 * 2200,
        "monetaryEstimate": None,
        "priceStatus": "平台未配置单价；token区间仅用于规划，不是账单或供应商计费承诺",
    }


def prepare(directory, source=SOURCE):
    originals, fingerprint = source_rows(source)
    catalog = {r["file"]: r for r in load(ROOT / "tools/lifestyle/corpus/sources.json")["files"]}
    cases, invalid = [], []
    for row in originals:
        try:
            cases.append(make_case(row, fingerprint, catalog, MODEL_REF.split(":", 1)[1]))
        except (ValueError, TypeError, KeyError) as error:
            invalid.append(
                {
                    "id": row["id"],
                    "reason": type(error).__name__ + ": " + str(error)[:240],
                }
            )
    if invalid:
        raise ValueError("generation-preflight-invalid-items: " + json.dumps(invalid, ensure_ascii=False))
    # 来源交错，让首批8条覆盖所有六种来源及三层，而非只验证一种提示。
    groups = {s: sorted((r for r in cases if r["source"] == s), key=lambda r: r["id"]) for s in COUNTS}
    cases = []
    while any(groups.values()):
        for source_name in sorted(groups):
            if groups[source_name]:
                cases.append(groups[source_name].pop(0))
    if len({r["id"] for r in cases}) != 444:
        raise ValueError("safe-id-collision")
    planned = {
        "protocol": "lifestyle-full-generation/1",
        "sourceFingerprint": fingerprint,
        "modelRef": MODEL_REF,
        "callLimit": 500,
        "contextCap": CONTEXT_CAP,
        "settings": SETTINGS,
        "failureCircuit": 10,
        "counts": COUNTS,
        "cost": statistics_for(cases),
        "implementation": implementation(),
    }
    planned["fingerprint"] = digest({"plan": planned, "cases": cases})
    target = directory / "inputs"
    if target.exists():
        manifest = load(target / "manifest.json")
        if {p.name for p in target.iterdir()} != set(manifest["outputs"]) | {"manifest.json"}:
            raise ValueError("frozen-output-set-changed")
        if digest({k: v for k, v in manifest.items() if k != "manifestDigest"}) != manifest["manifestDigest"]:
            raise ValueError("frozen-manifest-corrupted")
        for name, expected in manifest["outputs"].items():
            if Path(name).name != name or sha((target / name).read_bytes()) != expected:
                raise ValueError("frozen-output-corrupted")
        if load(target / "plan.json") != planned or rows(target / "cases.jsonl") != cases:
            raise ValueError("frozen-input-or-code-changed")
        return planned, cases
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=directory, prefix=".inputs-") as name:
        staging = Path(name)
        save(staging / "plan.json", planned)
        jsonl(staging / "cases.jsonl", cases)
        shutil.copyfile(source / "records.jsonl", staging / "source-records.jsonl")
        manifest = {
            "fingerprint": planned["fingerprint"],
            "outputs": {p.name: sha(p.read_bytes()) for p in staging.iterdir()},
        }
        manifest["manifestDigest"] = digest(manifest)
        save(staging / "manifest.json", manifest)
        staging.rename(target)
    return planned, cases
