"""用户明确续跑后的单次恢复：保留原计划、失败单元、历史账本与成功缓存。"""

import shutil
from collections import Counter
from datetime import UTC, datetime

from ..common import digest, load, save
from ..diet_transport import is_overload
from ..full.federation.budget import ledger

ALLOWED = {
    "tools/lifestyle/diet_transport.py",
    *("tools/lifestyle/diet_trial/" + name for name in ("prepare.py", "recovery.py", "run.py", "units.py", "__main__.py", "verify.py")),
}


def diagnostic_counts(directory):
    result = Counter()
    for path in (directory / "verification/upstream").glob("upstream-*.json"):
        if is_overload(load(path)):
            result[path.name.split("-")[1]] += 1
    return dict(result)


def receipt(directory, plan, current):
    from .prepare import file_hash

    if not (directory / "recovery.json").exists():
        raise ValueError("implementation-changed-explicit-recovery-required")
    value = load(directory / "recovery.json")
    if (
        value.get("digest") != digest({k: v for k, v in value.items() if k != "digest"})
        or value["originalPlan"] != plan["fingerprint"]
        or value["implementation"] != current
        or value["callCap"] != 60
    ):
        raise ValueError("recovery-receipt-or-code-changed")
    values = ledger(directory / "meter", plan["identity"])
    if values[: len(value["ledgerPrefix"])] != value["ledgerPrefix"]:
        raise ValueError("historical-dispatch-changed")
    if load(directory / "STOP.json") != value["originalStop"]:
        raise ValueError("historical-stop-changed")
    for name, expected in value["protectedJobFiles"].items():
        if file_hash(directory / name) != expected:
            raise ValueError("original-success-or-failed-unit-changed")
    return value


def prepare_recovery(directory):
    from .prepare import ROOT, file_hash, implementation, validate_frozen

    plan = load(directory / "inputs/plan.json")
    validate_frozen(directory, plan)
    current = implementation()
    if (directory / "recovery.json").exists():
        return receipt(directory, plan, current)
    before = plan["implementation"]
    changed = {p for p in before["files"] | current["files"] if before["files"].get(p) != current["files"].get(p)}
    if changed - ALLOWED or any(before[k] != current[k] for k in before if k != "files"):
        raise ValueError("recovery-cannot-change-algorithm-prompts-or-unrelated-code")
    values = ledger(directory / "meter", plan["identity"])
    proof = load(directory / "verification/recovery-before.json")
    if (
        file_hash(directory / "inputs/plan.json") != proof["planSha256"]
        or values[: len(proof["ledgerPrefix"])] != proof["ledgerPrefix"]
        or any(r["status"] == "error" and not r.get("completedUpstreamError") for r in values)
    ):
        raise ValueError("recovery-requires-confirmed-upstream-errors-and-original-prefix")
    completed = []
    pending = []
    for path in (directory / "generation").glob("*.json"):
        (completed if "value" in load(path) else pending).append(path)
    if len(completed) != 5 or len(pending) != 1 or load(directory / "STOP.json")["type"] != "UnitExhausted":
        raise ValueError("recovery-only-for-five-complete-one-upstream-failed-advice")
    failed = load(pending[0])
    if failed["failures"] != ["UpstreamReplyError", "UpstreamReplyError"]:
        raise ValueError("business-format-failure-cannot-be-reset")
    hashes = {r["requestHash"] for r in values if r["status"] == "error"}
    counts = diagnostic_counts(directory)
    diagnosed = hashes & counts.keys()
    if len(diagnosed) != 1:
        raise ValueError("one-matching-overload-diagnostic-required")
    key = next(iter(diagnosed))
    # 单元指纹不含ref，必须用完整请求缓存哈希而不是猜测最后一个请求。
    from ..common import rows
    from .protocol import ANSWER_SETTINGS, training_messages

    case = next(c for c in rows(directory / "inputs/learning.jsonl") if c["id"] == pending[0].stem)
    if key != digest(
        {"ref": plan["modelRef"], "identity": plan["identity"], "messages": training_messages(case), "settings": ANSWER_SETTINGS}
    ):
        raise ValueError("overload-diagnostic-not-the-failed-case")
    protected = {"inputs/plan.json": file_hash(directory / "inputs/plan.json")}
    for folder in ("generation", "meter/calls", "verification/upstream"):
        protected.update({str(p.relative_to(directory)): file_hash(p) for p in (directory / folder).glob("*.json")})
    for folder, field in (("generation", "generationFiles"), ("meter/calls", "cacheFiles")):
        if any(file_hash(directory / folder / name) != sha for name, sha in proof[field].items()):
            raise ValueError("pre-diagnostic-result-changed")
    if len(values) + 31 > 60:
        raise ValueError("insufficient-recovery-budget")
    backup = ROOT / ".backups" / ("diet-recovery-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ"))
    shutil.copytree(directory, backup)
    value = {
        "originalPlan": plan["fingerprint"],
        "implementation": current,
        "changedFiles": sorted(changed),
        "authorization": "用户明确要求继续修复；保留原样本模型和成功输出，含历史总60次，不部署或扩大样本。",
        "at": datetime.now(UTC).isoformat(),
        "callCap": 60,
        "ledgerPrefix": values,
        "originalStop": load(directory / "STOP.json"),
        "acknowledgedOrdinals": [r["ordinal"] for r in values if r["requestHash"] == key and r["status"] == "error"],
        "failedUnit": str(pending[0].relative_to(directory)),
        "priorDiagnostics": counts,
        "protectedJobFiles": protected,
        "backup": str(backup),
    }
    value["digest"] = digest(value)
    save(directory / "recovery.json", value)
    return receipt(directory, plan, current)
