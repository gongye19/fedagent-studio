"""只读准备全部444来源目录和两个人工保真夹具，不派发生成任务。"""

from collections import Counter
from pathlib import Path

from ..common import digest, jsonl, load, rows, save
from ..quality_audit import sha
from .check import check
from .fixtures import EXERCISE_ID, SOURCE_FILE, build_references
from .reference import PROTOCOL, SCHEMAS
from .suite import run_suite


def implementation():
    folder = Path(__file__).parent
    paths = list(folder.glob("*.py")) + [folder.parent / name for name in ("common.py", "quality_audit.py")]
    return {str(p.relative_to(folder.parent)): sha(p) for p in paths}


def prepare(root, out):
    root, out = root.resolve(), out.resolve()
    partial = out.with_suffix(".partial")
    if out.exists() or partial.exists():
        raise ValueError("preparation-output-must-be-new")
    protected = {str(p.relative_to(root)): sha(p) for p in sorted(root.rglob("*")) if p.is_file() and p.name != ".lock"}
    pool, references = build_references(root)
    partial.mkdir(parents=True)
    jsonl(partial / "source-catalog.jsonl", pool)
    save(partial / "protected-before.json", protected)
    contract = {
        "protocol": PROTOCOL,
        "status": "offline-validator-not-active-platform-algorithm",
        "recordKinds": {kind: {"evidenceKind": v[0], "sourceKind": v[1], "requiredFields": sorted(v[2])} for kind, v in SCHEMAS.items()},
        "validationScope": "frozen-source-spans-registered-fields-and-parent-hashes-only",
        "normalization": "only source-span whitespace; field values and source versions require exact canonical JSON",
        "manualReferenceReviewRequired": True,
        "medicalEfficacyValidation": False,
        "newAlgorithmOrModelCalls": False,
        "fullGenerationAuthorized": False,
    }
    save(partial / "contract.json", contract)
    suite, controls = [], {}
    for reference in references:
        save(partial / "references" / (reference["id"] + ".json"), reference)
        result, payloads = run_suite(reference)
        suite.append(result)
        controls[reference["id"]] = payloads
        for stage, cards in payloads.items():
            save(partial / "manual-controls" / reference["id"] / (stage + ".json"), cards)
    full = root / "full/run-20261119/federation"
    record = next(r for r in rows(full / "inputs/batch-01-CDC.jsonl") if r["provenance"]["sourceItemId"] == EXERCISE_ID)
    exercise_traces = [
        r["payload"] for r in rows(full / "platform/runs/task-f1035bb4/messages/r1/extract.jsonl") if r["item_id"] == record["id"]
    ]
    diet = root / "diet-trial/run-20261125"
    diet_traces = [r["payload"] for r in rows(diet / "platform/runs/task-a0491189/messages/r1/extract.jsonl")]
    legacy = []
    for reference, traces, library in (
        (references[0], exercise_traces, load(full / "batch-01/library.json")),
        (references[1], diet_traces, load(diet / "batch-01/library.json")),
    ):
        legacy.append(
            {
                "referenceId": reference["id"],
                "status": "legacy-format-not-structurally-verifiable-not-medical-failure",
                "traceReport": check(reference, traces, stage="trace"),
                "aggregateReport": check(reference, library, stage="aggregate", parents=traces),
                "lineage": "no invented mapping between final insight and individual source trace",
            }
        )
    save(partial / "suite.json", suite)
    save(partial / "legacy-diagnostics.json", legacy)
    summary = {
        "protocol": PROTOCOL,
        "status": "offline-preparation-complete",
        "sourceRecordsPrepared": len(pool),
        "sourceCounts": dict(Counter(r["source"] for r in pool)),
        "manuallyAnnotatedReferences": len(references),
        "positiveStructuralControls": sum(len(r["positive"]) for r in suite),
        "rejectedAdversarialControls": sum(len(r["rejectedVariants"]) + 1 for r in suite),
        "legacyPairsNotRegraded": len(legacy),
        "newModelCalls": 0,
        "newExperiencesGenerated": 0,
        "nativeFoTChanged": False,
        "medicalEffectivenessProven": False,
        "deployed": False,
        "sourcePoolDigest": digest(pool),
        "protectedFiles": len(protected),
    }
    save(partial / "summary.json", summary)
    report = [
        "# 离线来源保真检查验收",
        "",
        "这不是模型经验生成或医学效果实验。",
        "",
        f"已有来源准备：{len(pool)}条；人工参考：{len(references)}条；正向结构控制：{summary['positiveStructuralControls']}；错误变体拦截：{summary['rejectedAdversarialControls']}。",
        "",
        "原版FoT、旧回答及旧评分未改。本轮模型调用0、新经验0。",
        "",
        "|检查项|结果|",
        "|---|---|",
        "|来源目录|444条全量保留，并逐来源计数|",
        "|字段保留|核查已登记的人群、目标、行动、参数、例外及未知信息|",
        "|阶段关联|允许多个中间记录分担字段；聚合只能引用确实含相应字段的父记录|",
        "|旧格式|原纯文本没有新规范字段，标为无法核验，不改医学分数|",
        "|验收限制|人工正向控制不是算法新输出；没有验证疗效或任意自然语言叙述|",
        "",
    ]
    (partial / "report.md").write_text("\n".join(report))
    if any(sha(root / name) != value for name, value in protected.items()):
        raise ValueError("previous-experiment-file-changed")
    save(
        partial / "COMPLETE.json",
        {
            "summaryDigest": digest(summary),
            "files": {str(p.relative_to(partial)): sha(p) for p in partial.rglob("*") if p.is_file()},
            "implementation": implementation(),
            "sourceCatalogPath": SOURCE_FILE,
        },
    )
    partial.rename(out)
    return summary


def verify(root, out):
    receipt = load(out / "COMPLETE.json")
    summary = load(out / "summary.json")
    actual = {
        str(p.relative_to(out)): sha(p)
        for p in out.rglob("*")
        if p.is_file() and str(p.relative_to(out)) not in {"COMPLETE.json", "verification.json"}
    }
    if receipt["summaryDigest"] != digest(summary) or receipt["files"] != actual or receipt["implementation"] != implementation():
        raise ValueError("prepared-artifact-or-code-changed")
    protected = load(out / "protected-before.json")
    if len(protected) != summary["protectedFiles"] or any(sha(root / name) != value for name, value in protected.items()):
        raise ValueError("previous-experiment-file-changed")
    pool, references = build_references(root)
    if rows(out / "source-catalog.jsonl") != pool or digest(pool) != summary["sourcePoolDigest"]:
        raise ValueError("prepared-source-catalog-changed")
    suite = []
    for reference in references:
        if load(out / "references" / (reference["id"] + ".json")) != reference:
            raise ValueError("prepared-reference-changed")
        result, payloads = run_suite(reference)
        suite.append(result)
        for stage, cards in payloads.items():
            if load(out / "manual-controls" / reference["id"] / (stage + ".json")) != cards:
                raise ValueError("manual-control-changed")
    if load(out / "suite.json") != suite:
        raise ValueError("validation-results-changed")
    return summary
