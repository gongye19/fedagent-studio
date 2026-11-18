"""只读原档→离线初筛/分离/去重→冻结候选、评测与调用预算。"""

from __future__ import annotations

import hashlib
import importlib.metadata
import shutil
import tempfile
from collections import Counter
from pathlib import Path

from ..common import digest, jsonl, load, save
from . import adapters
from .budget import estimate
from .fetch import CATALOG, verify
from .screen import UNKNOWN_PROFILE
from .split import partition

PACKAGE = Path(__file__).parent


def hash_file(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def snapshot():
    paths = sorted(PACKAGE.glob("*.py")) + sorted(PACKAGE.glob("*.json")) + [PACKAGE.parent / "common.py"]
    return {str(p.relative_to(PACKAGE.parent)): hash_file(p) for p in paths}


def eval_input(row):
    value = {k: row[k] for k in ("id", "source", "purpose", "question")}
    value["contentReview"] = "topical-reviewed-not-clinical" if row["purpose"] == "recommendation-eval" else "rule-screened-unreviewed"
    if "messages" in row:
        value["messages"] = row["messages"]
    if "options" in row["reference"]:
        value["options"] = row["reference"]["options"]
    return value


def candidate(row):
    # Knowledge is a generation reference, never an invented user medical history.
    profile = UNKNOWN_PROFILE
    if row["source"] == "MedQuAD":
        question = f"关于「{row['focus']}」，围绕来源问题「{row['question']}」，说明与饮食或运动相关的建议、适用限制和需先确认的信息。"
    else:
        profile = "以下是公开医学考试的假设情境，不是提问者的个人病史。仅使用题目给定条件，不附加或推断个人情况。"
        options = "\n".join(f"{chr(65 + i)}. {value}" for i, value in enumerate(row["reference"]["options"]))
        question = (
            f"阅读以下完整题目，说明其对饮食或运动建议的启示、适用条件与限制；不要将正确选项泛化为所有人的建议。\n题目：{row['question']}\n选项：\n{options}"
        )
    if len(question) > 3000:
        raise ValueError("生成目标问题超过应用合同长度，需先复核")
    return {
        **row,
        "generationInput": {"profile": profile, "question": question},
        "reviewStatus": "topical-rule-screened; clinical-validity-not-reviewed",
        "uploadableProcessRecord": False,
    }


def audit_samples(rows, policy):
    by_id = {r["id"]: r for r in rows}
    if not set(policy.get("samples", {})) <= set(by_id):
        raise ValueError("审核编号在原始候选中不存在")
    return [{**by_id[key], "topicalAudit": result, "auditStage": "raw-candidate-before-cleaning"} for key, result in sorted(policy.get("samples", {}).items())]


def build(directory: Path):
    sources, destination = directory / "sources", directory / "prepared"
    catalog = load(CATALOG)
    versions = {name: importlib.metadata.version(name) for name in ("duckdb", "httpx")}
    if any(versions[k] != catalog[k] for k in versions):
        raise ValueError("准备工具版本不匹配；使用文档中的固定 uv 命令")
    for source in catalog["files"]:
        verify(sources / source["file"], source)
    code = snapshot()
    fingerprint = digest({"codeAndPolicy": code, "sources": catalog, "versions": versions})
    if destination.exists():
        manifest = load(destination / "manifest.json")
        if digest({k: v for k, v in manifest.items() if k != "manifestDigest"}) != manifest.get("manifestDigest"):
            raise ValueError("冻结清单被修改")
        if manifest["fingerprint"] != fingerprint:
            raise ValueError("语料已冻结但代码/规则/来源改变，请换新的 --directory")
        if {p.name for p in destination.iterdir()} != set(manifest["outputs"]) | {"manifest.json"}:
            raise ValueError("冻结目录的文件集合改变")
        for name, expected in manifest["outputs"].items():
            if hash_file(destination / name) != expected:
                raise ValueError("冻结产物被修改：" + name)
        return manifest
    stats = {}
    policy = load(PACKAGE / "review-policy.json")
    raw = list(adapters.medquad(sources, stats)) + list(adapters.mcqa(sources, stats))
    raw += list(adapters.mmlu(sources, stats)) + list(adapters.healthbench(sources, policy, stats))
    if len({r["id"] for r in raw}) != len(raw):
        raise ValueError("来源编号不唯一")
    training, evaluation, reserved, review, removed, comparisons = partition(raw, policy)
    training = [candidate(r) for r in training]
    questions = [r["generationInput"]["question"] for r in training]
    if len(set(questions)) != len(questions):
        raise ValueError("生成问题重复，不能为同一问题重复付费")
    budgets = estimate(training, evaluation, load(PACKAGE / "calibration.json"))
    inventory = {
        "sources": stats,
        "beforeSplitByTier": dict(sorted(Counter((r["source"] + "/" + r["tier"]) for r in raw).items())),
        "generationCandidates": dict(sorted(Counter(r["source"] for r in training).items())),
        "simulatedProviders": dict(sorted(Counter(r["site"] for r in training).items())),
        "evaluation": dict(sorted(Counter(r["source"] for r in evaluation).items())),
        "reviewPool": dict(sorted(Counter(r["source"] for r in review).items())),
        "reserved": dict(sorted(Counter(r["purpose"] for r in reserved).items())),
        "removed": dict(sorted(Counter(r["reason"] for r in removed).items())),
        "similarityComparisons": comparisons,
        "healthbenchRubrics": sum(len(r["reference"]["rubrics"]) for r in evaluation if r["source"] == "HealthBench"),
        "healthbenchMaxContextChars": max(
            (sum(len(m["content"]) for m in r["messages"]) for r in evaluation if "messages" in r),
            default=0,
        ),
        "fixedSampleTopicalAudit": {
            source: {
                "sampleSize": len(ids),
                "topicallyRelevant": sum(policy["samples"][key]["relevant"] for key in ids),
                "review": "Codex topical assessment only, not clinical/expert accuracy",
            }
            for source, ids in policy.get("sampleCohort", {}).items()
        },
    }
    with tempfile.TemporaryDirectory(dir=directory, prefix=".build-") as temporary:
        output = Path(temporary)
        jsonl(output / "generation-candidates.jsonl", training)
        jsonl(output / "evaluation-inputs.jsonl", [eval_input(r) for r in evaluation])
        jsonl(
            output / "evaluation-references.jsonl",
            [{"id": r["id"], **r["reference"]} for r in evaluation],
        )
        jsonl(output / "reserved.jsonl", reserved)
        jsonl(output / "review-pool.jsonl", review)
        jsonl(output / "removed-audit.jsonl", removed)
        jsonl(output / "topical-audit-samples.jsonl", audit_samples(raw, policy))
        save(output / "inventory.json", inventory)
        save(output / "call-estimates.json", budgets)
        files = {p.name: hash_file(p) for p in sorted(output.iterdir())}
        manifest = {
            "schema": "lifestyle-corpus/1",
            "fingerprint": fingerprint,
            "sourceFiles": catalog,
            "codeAndPolicy": code,
            "toolVersions": versions,
            "outputs": files,
            "inventory": inventory,
        }
        manifest["manifestDigest"] = digest(manifest)
        save(output / "manifest.json", manifest)
        shutil.move(str(output), str(destination))
    return manifest
