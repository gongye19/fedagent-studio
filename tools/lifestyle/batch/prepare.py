"""只读验证既有冻结资料，冻结首批选择与执行代码；不创建模型。"""

from __future__ import annotations

import hashlib
import importlib.metadata
import shutil
import sys
import tempfile
import urllib.request
from collections import Counter
from pathlib import Path

from fedagent_records.fot import RecordFoT

from ..common import digest, jsonl, load, rows, save
from .healthbench import grader_template

PACKAGE = Path(__file__).parent
ROOT = PACKAGE.parents[2]


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def frozen(directory):
    manifest = load(directory / "manifest.json")
    if manifest.get("manifestDigest") != digest({k: v for k, v in manifest.items() if k != "manifestDigest"}):
        raise ValueError("frozen-manifest-corrupted")
    if {p.name for p in directory.iterdir()} != set(manifest["outputs"]) | {"manifest.json"}:
        raise ValueError("frozen-output-set-changed")
    for name, expected in manifest["outputs"].items():
        if Path(name).name != name or sha(directory / name) != expected:
            raise ValueError("frozen-output-corrupted: " + name)
    for name, expected in manifest.get("code", manifest.get("codeAndPolicy", {})).items():
        if sha(PACKAGE.parent / name) != expected:
            raise ValueError("frozen-source-code-changed: " + name)
    return manifest


def implementation():
    paths = [p for p in PACKAGE.iterdir() if p.is_file() and p.suffix in {".py", ".json", ".txt", ".html", ".css", ".js"}] + list(PACKAGE.parent.glob("*.py"))
    for folder in ("server/fedagent", "server/sdk/fedagent_sdk"):
        paths.extend((ROOT / folder).rglob("*.py"))
    paths.append(ROOT / "server/uv.lock")
    return {
        "files": {str(p.relative_to(ROOT)): sha(p) for p in sorted(paths)},
        "plugin": RecordFoT().code_hash(),
        "python": sys.version,
        "dependencies": {
            n: importlib.metadata.version(n)
            for n in (
                "fedagent",
                "fedagent-sdk",
                "httpx",
                "pydantic",
                "sqlalchemy",
                "fastapi",
                "matplotlib",
                "numpy",
                "pillow",
                "fonttools",
                "contourpy",
                "cycler",
                "kiwisolver",
                "packaging",
                "pyparsing",
                "python-dateutil",
            )
        },
    }


def prepare(directory, knowledge, corpus, model_ref):
    km, cm = frozen(knowledge / "prepared"), frozen(corpus / "prepared")
    for item in rows(PACKAGE.parent / "knowledge/sources.jsonl") + km["registry"]["policies"]:
        raw = knowledge / "raw" / item["file"]
        if raw.stat().st_size != item["bytes"] or sha(raw) != item["sha256"]:
            raise ValueError("source-snapshot-corrupted")
    # 旧实验保护边界文件同样必须存在并保持原摘要。
    for name, expected in km["legacyInputs"].items():
        path = corpus / "prepared" / name.removeprefix("corpus/") if name.startswith("corpus/") else corpus.parent.parent / "prepared.json"
        if sha(path) != expected:
            raise ValueError("legacy-boundary-changed")
    seed = load(knowledge / "prepared/call-estimates.json")
    by_id = {u["id"]: u for u in rows(knowledge / "prepared/knowledge-units.jsonl")}
    selected = [by_id[key] for key in seed["selectedUnitIds"]]
    if (
        len(selected) != 30
        or len({u["documentId"] for u in selected}) != 30
        or Counter(u["providerGroup"] for u in selected) != {"NIH": 10, "CDC": 10, "NHS": 10}
    ):
        raise ValueError("first-thirty-selection-changed")
    batch = load(corpus / "prepared/call-estimates.json")["proposals"]["first-recommendation-batch"]
    selected_ids = batch["selectedEvaluationIds"]
    inputs = {r["id"]: r for r in rows(corpus / "prepared/evaluation-inputs.jsonl")}
    references = {r["id"]: r for r in rows(corpus / "prepared/evaluation-references.jsonl")}
    cases, rubrics = [inputs[k] for k in selected_ids], [references[k] for k in selected_ids]
    if len(cases) != 24 or sum(len(r["rubrics"]) for r in rubrics) != 341:
        raise ValueError("first-evaluation-selection-changed")
    training = []
    for index, unit in enumerate(selected):
        training.append(
            {
                "id": f"{unit['providerGroup']}-{index + 1:02d}",
                "site": unit["providerGroup"],
                "knowledge": unit,
                "input": {
                    "profile": f"未提供个人健康资料；这是公开资料的合成建议场景，不代表任何患者。资料人群：{unit['population']}；地区：{unit['region']}。",
                    "question": (
                        f"围绕公开资料“{unit['sourceTitle']}”中的“{unit['heading']}”，解释有关的饮食或运动建议、具体方法与适用限制。哪些个人情况需要先确认？"
                    ),
                },
            }
        )
    planned = {
        "protocol": "lifestyle-first/1",
        "modelRef": model_ref,
        "callLimit": 850,
        "evaluationReservation": 730,
        "operationalContextCap": 131072,
        "providerContextWindowVerified": False,
        "knowledgeManifest": km["manifestDigest"],
        "corpusManifest": cm["manifestDigest"],
        "implementation": implementation(),
        "training": training,
        "evaluationIds": selected_ids,
        "budget": {"normalGeneration": 92, "normalEvaluation": 730, "probe": 1},
    }
    planned["fingerprint"] = digest(planned)
    target = directory / "inputs"
    if target.exists():
        frozen(target)
        if load(target / "prepared.json") != planned:
            raise ValueError("experiment-input-or-code-changed; use a new directory")
        return planned
    upstream = load(PACKAGE / "upstream.json")
    with tempfile.TemporaryDirectory(dir=directory, prefix=".inputs-") as temporary:
        out = Path(temporary)
        save(out / "prepared.json", planned)
        jsonl(out / "evaluation-inputs.jsonl", cases)
        jsonl(out / "evaluation-references.jsonl", rubrics)
        for filename, url, expected in (
            ("grader-source.py", upstream["url"], upstream["sha256"]),
            ("LICENSE.simple-evals", upstream["licenseUrl"], upstream["licenseSha256"]),
        ):
            with urllib.request.urlopen(url, timeout=30) as response:
                raw = response.read(100000)
            if hashlib.sha256(raw).hexdigest() != expected:
                raise ValueError("upstream-grader-or-license-changed")
            (out / filename).write_bytes(raw)
        template = grader_template((out / "grader-source.py").read_text())
        if digest(template) != upstream["templateDigest"]:
            raise ValueError("upstream-template-changed")
        manifest = {"schema": "lifestyle-experiment-input/1", "fingerprint": planned["fingerprint"], "outputs": {p.name: sha(p) for p in sorted(out.iterdir())}}
        manifest["manifestDigest"] = digest(manifest)
        save(out / "manifest.json", manifest)
        shutil.move(str(out), str(target))
    return planned
