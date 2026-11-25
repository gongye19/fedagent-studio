"""只读准备：案例／规则／经验／代码均在新调用前冻结，参考答案不进作答输入。"""

from pathlib import Path

from ..common import digest, jsonl, load, rows, save
from ..diet_trial.prepare import file_hash, protected_files
from ..full.federation.prepare import ROOT
from ..full.federation.prepare import implementation as base_implementation
from .audit import audit_library, numeric_features, retrieve
from .specs import CASES, LIBRARY_RUN, OLD_EVAL, SOURCE


def implementation():
    result = base_implementation()
    paths = list(Path(__file__).parent.glob("*.py"))
    paths += [ROOT / "tools/lifestyle" / name for name in ("diet_transport.py", "sensor_trial/transport.py", "diet_trial/prepare.py")]
    result["files"].update({str(p.relative_to(ROOT)): digest(p.read_bytes().hex()) for p in paths})
    return result


def selected():
    source, old = ROOT / SOURCE, ROOT / LIBRARY_RUN
    public = {r["id"]: r for r in rows(source / "evaluation-inputs.jsonl")}
    refs = {r["id"]: r for r in rows(source / "evaluation-references.jsonl")}
    used = {r["id"] for r in rows(ROOT / OLD_EVAL)}
    for path in (ROOT / "data/lifestyle-prep").rglob("*.json"):
        if "answers" in path.parts:
            used.update("healthbench:" + spec["id"] for spec in CASES if spec["id"] in path.name)
    cases, references = [], []
    for spec in CASES:
        key = "healthbench:" + spec["id"]
        if key in used or key not in public or key not in refs:
            raise ValueError("case-not-an-unused-source-evaluation")
        messages = public[key]["messages"]
        text = "\n".join(m["content"] for m in messages if m["role"] == "user")
        for value, quote in spec["facts"].values():
            if type(value) is not bool or not isinstance(quote, str) or quote not in text:
                raise ValueError("matching-fact-not-bound-to-user-input")
        cases.append(
            {
                "id": key,
                "title": spec["title"],
                "messages": messages,
                "features": {k: v[0] for k, v in spec["facts"].items()},
                "inputFactEvidence": {k: v[1] for k, v in spec["facts"].items()},
                "repeat": spec["repeat"],
            }
        )
        originals = {f"r{i}": rule for i, rule in enumerate(refs[key]["rubrics"])}
        excluded = spec.get("excludedRules", {})
        rules = {k: rule["criterion"] for k, rule in originals.items() if k not in excluded}
        rules.update(spec["supplements"])
        for dimension in spec["dimensions"].values():
            if not dimension["pos"] or set(dimension["pos"] + dimension["neg"]) - rules.keys():
                raise ValueError("dimension-map-refers-to-missing-rule")
        if set(spec["critical"]) - rules.keys():
            raise ValueError("critical-map-refers-to-missing-rule")
        references.append(
            {
                "id": key,
                "rules": rules,
                "originalRubrics": originals,
                "supplementRules": spec["supplements"],
                "excludedRules": excluded,
                "dimensions": spec["dimensions"],
                "critical": spec["critical"],
                "expected": spec["expected"],
                "reviewStatus": "原规则由HealthBench提供；补充规则及维度映射由Codex审计，未获独立医学专家审核",
            }
        )
    if len(cases) != 6 or sum(c["repeat"] for c in cases) != 2:
        raise ValueError("six-cases-two-repeats-required")
    library = load(old / "batch-01/library.json")
    state = load(old / "batch-01/state.json")
    report = load(old / "report.json")
    if (
        load(old / "COMPLETE.json")["reportDigest"] != digest(report)
        or report["status"] != "complete"
        or state["libraryDigest"] != digest(library)
        or report["finalEntries"] != 10
    ):
        raise ValueError("original-library-not-completed-and-bound")
    return cases, references, library


def prepare(directory):
    if (directory / "inputs/plan.json").exists():
        return validate(directory)
    if (directory / "inputs").exists() or any(directory.glob("meter-*")):
        raise ValueError("partial-or-paid-job-cannot-reprepare")
    cases, refs, library = selected()
    audit = audit_library(library)
    audit["sourceRun"] = LIBRARY_RUN
    audit["reviewer"] = "Codex内容审计，非医学专家审查"
    retrievals = {c["id"]: retrieve(c["features"], library)[1] for c in cases}
    if not all(v["eligible"] for v in retrievals.values()) or len({digest(v["selected"]) for v in retrievals.values()}) < 3:
        raise ValueError("case-matching-is-empty-or-undifferentiated")
    target = directory / "inputs.partial"
    target.mkdir(parents=True, exist_ok=False)
    jsonl(target / "cases.jsonl", cases)
    jsonl(target / "references.jsonl", refs)
    save(target / "library.json", library)
    save(target / "experience-audit.json", audit)
    save(target / "retrieval.json", retrievals)
    development = rows(ROOT / LIBRARY_RUN / "inputs/evaluation.jsonl")
    save(
        target / "matching-calibration.json",
        [
            {
                "id": c["id"],
                "purpose": "previously-seen development input; not a new evaluation case",
                "features": numeric_features(c["input"]),
                "retrieval": retrieve({"meal_structure": True, **numeric_features(c["input"])}, library)[1],
            }
            for c in development
        ],
    )
    source = ROOT / SOURCE
    bound = [source / name for name in ("evaluation-inputs.jsonl", "evaluation-references.jsonl", "manifest.json")]
    bound += [ROOT / OLD_EVAL]
    bound += [
        ROOT / LIBRARY_RUN / name
        for name in ("inputs/plan.json", "batch-01/library.json", "batch-01/state.json", "report.json", "COMPLETE.json")
    ]
    bound += [ROOT / LIBRARY_RUN / "inputs/evaluation.jsonl"]
    protected = protected_files(ROOT / "data/lifestyle-prep", directory)
    save(directory / "verification/protected-before.json", protected)
    old_plan = load(ROOT / LIBRARY_RUN / "inputs/plan.json")
    plan = {
        "protocol": "case-specific-diet-evaluation/1",
        "identity": old_plan["identity"],
        "modelRef": old_plan["modelRef"],
        "authorization": "用户确认两组对照和案例专属标准后要求开始；不部署、不重跑旧任务。",
        "globalCallCap": 48,
        "contextCap": 65536,
        "normalCalls": {"calibration": 1, "answers": 16, "judging": 8, "total": 25},
        "namespaces": ["primary", "repeat"],
        "caseIds": [c["id"] for c in cases],
        "repeatIds": [c["id"] for c in cases if c["repeat"]],
        "protectedDigest": digest(protected),
        "sourceFiles": {str(p.relative_to(ROOT)): file_hash(p) for p in bound},
        "implementation": implementation(),
        "files": {p.name: file_hash(p) for p in target.iterdir()},
    }
    plan["fingerprint"] = digest(plan)
    save(target / "plan.json", plan)
    target.rename(directory / "inputs")
    return validate(directory)


def validate(directory):
    target = directory / "inputs"
    plan = load(target / "plan.json")
    if (
        digest({k: v for k, v in plan.items() if k != "fingerprint"}) != plan["fingerprint"]
        or plan["implementation"] != implementation()
        or plan["protocol"] != "case-specific-diet-evaluation/1"
        or plan["globalCallCap"] != 48
    ):
        raise ValueError("frozen-code-or-plan-changed")
    actual = {p.name: file_hash(p) for p in target.iterdir() if p.name != "plan.json"}
    if actual != plan["files"] or any(file_hash(ROOT / name) != sha for name, sha in plan["sourceFiles"].items()):
        raise ValueError("frozen-input-or-source-changed")
    protected = load(directory / "verification/protected-before.json")
    if digest(protected) != plan["protectedDigest"] or any(
        file_hash(ROOT / "data/lifestyle-prep" / name) != sha for name, sha in protected.items()
    ):
        raise ValueError("previous-experiment-file-changed")
    return plan
