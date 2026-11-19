"""零调用冻结两组评测；经验正文原样保留，全部题目做上下文预检。"""

import importlib.metadata
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

from ...batch.healthbench import answer_messages, grader_template
from ...batch.prepare import frozen, sha
from ...common import digest, load, rows, save
from ..generation.prepare import ROOT
from .source import bundle

OLD = ROOT / "data/lifestyle-prep/experiments/first-20261118/inputs"
OLD_MANIFEST = "07b95c43b6bdb75a2b1a9d0a13cf1b4e767a5890d4986896321938a1972344e4"
FEDERATION = ROOT / "data/lifestyle-prep/full/run-20261119/federation"
DIRECTORY = FEDERATION.parent / "comparison"
PACKAGE = Path(__file__).parent
FILES = ("evaluation-inputs.jsonl", "evaluation-references.jsonl", "grader-source.py", "LICENSE.simple-evals")


def implementation():
    paths = [*PACKAGE.glob("*.py"), ROOT / "server/uv.lock"]
    paths += [
        ROOT / ("tools/lifestyle/" + p)
        for p in (
            "common.py",
            "model.py",
            "batch/evaluate.py",
            "batch/calls.py",
            "batch/healthbench.py",
            "batch/report.py",
            "batch/prepare.py",
            "batch/upstream.json",
            "full/federation/budget.py",
        )
    ]
    return {
        "files": {str(p.relative_to(ROOT)): sha(p) for p in sorted(paths)},
        "python": sys.version,
        "versions": {n: importlib.metadata.version(n) for n in ("fedagent", "fedagent-sdk", "httpx", "matplotlib")},
    }


def upstream():
    manifest = frozen(OLD)
    if manifest["manifestDigest"] != OLD_MANIFEST:
        raise ValueError("not-pinned-T148-evaluation-inputs")
    prepared = load(OLD / "prepared.json")
    cases, refs = rows(OLD / FILES[0]), rows(OLD / FILES[1])
    if (
        [c["id"] for c in cases] != prepared["evaluationIds"]
        or [r["id"] for r in refs] != prepared["evaluationIds"]
        or len(cases) != 24
        or sum(len(r["rubrics"]) for r in refs) != 341
    ):
        raise ValueError("evaluation-24-cases-341-rubrics-changed")
    pinned = load(ROOT / "tools/lifestyle/batch/upstream.json")
    if (
        sha(OLD / FILES[2]) != pinned["sha256"]
        or sha(OLD / FILES[3]) != pinned["licenseSha256"]
        or digest(grader_template((OLD / FILES[2]).read_text())) != pinned["templateDigest"]
    ):
        raise ValueError("grader-or-license-changed")
    return cases


def prepare(directory=DIRECTORY):
    source, libraries, collection, origin = bundle(FEDERATION, time.time())
    cases = upstream()
    bounds = [{"case": c["id"], "inputUtf8Bytes": len(json.dumps(answer_messages(c["messages"], collection), ensure_ascii=False).encode())} for c in cases]
    if any(b["inputUtf8Bytes"] + 1800 + 1024 > 131072 for b in bounds):
        raise ValueError("combined-experience-over-context-cap: " + json.dumps(bounds))
    planned = {
        "protocol": "lifestyle-five-collection-comparison/1",
        "modelRef": source["modelRef"],
        "identity": source["identity"],
        "callLimit": 850,
        "normalCalls": 730,
        "contextCap": 131072,
        "evaluationIds": [c["id"] for c in cases],
        "federationFingerprint": source["fingerprint"],
        "sourceCounts": source["counts"],
        "origins": origin,
        "collectionDigest": digest(collection),
        "implementation": implementation(),
        "evaluationManifest": OLD_MANIFEST,
        "sourceLibraries": {n: digest(v) for n, v in libraries.items()},
        "requestBounds": bounds,
        "inputTokenPlanningRange": [sum(b["inputUtf8Bytes"] for b in bounds) // 4, sum(b["inputUtf8Bytes"] for b in bounds)],
    }
    planned["fingerprint"] = digest(planned)
    target = directory / "inputs"
    if target.exists():
        frozen(target)
        if load(target / "prepared.json") != planned:
            raise ValueError("frozen-comparison-inputs-or-code-changed")
        return planned
    if (directory / "attempts.json").exists() or (directory / "run.json").exists():
        raise ValueError("comparison-inputs-missing-with-existing-progress")
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=directory, prefix=".inputs-") as temp:
        staging = Path(temp)
        for name in FILES:
            shutil.copyfile(OLD / name, staging / name)
        for name, value in libraries.items():
            save(staging / (name + "-library.json"), value)
        save(staging / "collection.json", collection)
        save(staging / "prepared.json", planned)
        manifest = {"outputs": {p.name: sha(p) for p in sorted(staging.iterdir())}}
        manifest["manifestDigest"] = digest(manifest)
        save(staging / "manifest.json", manifest)
        staging.rename(target)
    return planned
