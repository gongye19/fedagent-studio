"""用户明确续跑后冻结一次恢复凭据；旧计划、成功缓存和失败费用均不清零。"""

import hashlib
import shutil
import sqlite3
from collections import Counter
from contextlib import closing
from datetime import UTC, datetime

from fedagent import models as m
from sqlalchemy import select

from ..common import digest, load, save
from ..full.federation.budget import ledger

ALLOWED = {
    "tools/lifestyle/model.py",
    "tools/lifestyle/full/federation/budget.py",
    *(
        "tools/lifestyle/sensor_trial/" + name
        for name in (
            "prepare.py",
            "run.py",
            "verify.py",
            "__main__.py",
            "recovery.py",
            "transport.py",
            "adapter.py",
            "evaluation_upgrade.py",
        )
    ),
}


def checksum(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def completed_units(directory, task_id):
    uri = (directory / "platform/fedagent.db").resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as db:
        return [
            list(row)
            for row in db.execute(
                "SELECT id,step,site_id,unit_key,status,attempts FROM work_units WHERE task_id=? AND status='done' ORDER BY id", (task_id,)
            )
        ]


def completed_values(directory, task_id):
    uri = (directory / "platform/fedagent.db").resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as db:
        return [
            list(row)
            for row in db.execute(
                "SELECT site_id,round,key,item_id,value FROM site_state WHERE task_id=? AND key IN ('solution','reflection') ORDER BY site_id,round,key,item_id",
                (task_id,),
            )
        ]


def receipt(directory, plan, *, current=None, values=None, required=False):
    path = directory / "recovery.json"
    if not path.exists():
        if required:
            raise ValueError("trial-implementation-changed; explicit-recovery-required")
        return None
    value = load(path)
    if value.get("digest") != digest({k: v for k, v in value.items() if k != "digest"}) or value["originalPlan"] != plan["fingerprint"]:
        raise ValueError("recovery-receipt-changed")
    if current is not None and current != value["implementation"]:
        raise ValueError("recovery-implementation-changed")
    values = ledger(directory / "meter", plan["identity"]) if values is None else values
    prefix = value["ledgerPrefix"]
    if values[: len(prefix)] != prefix or len(values) < len(prefix):
        raise ValueError("original-paid-ledger-changed")
    extra = value["relatedDiagnosticCalls"]
    if type(extra) is not int or not 0 <= extra <= 3:
        raise ValueError("invalid-related-call-accounting")
    for name, expected in value["successfulCacheFiles"].items():
        if checksum(directory / "meter/calls" / name) != expected:
            raise ValueError("successful-pre-recovery-cache-changed")
    expected = value["completedUnits"]
    actual = {r[0]: r for r in completed_units(directory, value["taskId"])}
    if any(actual.get(r[0]) != r for r in expected):
        raise ValueError("completed-work-unit-recomputed-or-changed")
    if completed_values(directory, value["taskId"]) != value["completedValues"]:
        raise ValueError("completed-reflection-content-changed")
    for proof in value.get("acceptedResponses", {}).values():
        path = (directory / proof["file"]).resolve()
        if not path.is_relative_to((directory / "meter").resolve()) or checksum(path) != proof["sha256"]:
            raise ValueError("accepted-original-abstention-changed")
    return value


def related_calls(directory, plan):
    value = receipt(directory, plan)
    return value["relatedDiagnosticCalls"] if value else 0


def prepare_recovery(directory, *, related=0, server_audit=None):
    from .prepare import ROOT, implementation, validate_frozen

    plan = load(directory / "inputs/plan.json")
    validate_frozen(directory, plan)
    current = implementation()
    previous = receipt(directory, plan) if (directory / "recovery.json").exists() else None
    if previous and server_audit is None:
        return receipt(directory, plan, current=current, required=True)
    if server_audit is not None and (previous is None or previous.get("previousRecovery")):
        raise ValueError("server-confirmed-amendment-requires-first-recovery")
    before = plan["implementation"]
    changed = {p for p in before["files"] | current["files"] if before["files"].get(p) != current["files"].get(p)}
    ordinary = ALLOWED - {"tools/lifestyle/sensor_trial/adapter.py", "tools/lifestyle/sensor_trial/evaluation_upgrade.py"}
    if changed - ordinary or any(before[k] != current[k] for k in before if k != "files"):
        raise ValueError("recovery-cannot-change-algorithm-or-unrelated-code")
    values = ledger(directory / "meter", plan["identity"])
    errors = [r for r in values if r["status"] == "error" and "usage" not in r]
    if (
        not errors
        or (previous is None and (len(errors) > 2 or any(n > 1 for n in Counter(r["requestHash"] for r in errors).values())))
        or type(related) is not int
        or not 0 <= related <= 3
    ):
        raise ValueError("recovery-only-for-first-isolated-transport-errors")
    state = load(directory / "batch-01/state.json")
    if (
        state["status"] != "failed"
        or not state.get("probePassed")
        or (previous is None and not state.get("rootError", {}).get("recoverable"))
    ):
        raise ValueError("not-a-recoverable-transport-pause")
    units = completed_units(directory, state["taskId"])
    counts = Counter(r[1] for r in units)
    if counts["prepare"] != 6 or counts["reflect"] != 6 or set(counts) - {"prepare", "reflect", "extract"} or counts["extract"] > 5:
        raise ValueError("recovery-requires-all-six-successful-reflections")
    uri = (directory / "platform/fedagent.db").resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as db:
        task = db.execute("SELECT status,cursor_step,plugin_hash FROM tasks WHERE id=?", (state["taskId"],)).fetchone()
        if task != ("paused", "extract", before["plugin"]):
            raise ValueError("recovery-requires-original-extract-pause")
        evidence = load(server_audit) if server_audit is not None else []
        if previous:
            prior = set(previous["acknowledgedUnknownCostOrdinals"])
            new = [r for r in errors if r["ordinal"] not in prior]
            if related != previous["relatedDiagnosticCalls"] or len(new) != 1:
                raise ValueError("amendment-only-for-one-new-confirmed-error")
            hashes = [
                row[0]
                for row in db.execute(
                    "SELECT request_hash FROM calls WHERE task_id=? AND error LIKE ?",
                    (state["taskId"], "%GuardStop:ended:" + new[0]["requestHash"] + "%"),
                )
            ]
            if not any(
                len(row) == 8 and row[2] == "error" and row[3] in hashes and row[5] == "重试 0 次后仍失败（模型接口返回错误）"
                for row in evidence
            ):
                raise ValueError("server-evidence-does-not-match-failed-request")
    if len(values) + related + 20 > plan["globalCallCap"]:
        raise ValueError("insufficient-remaining-call-budget")
    backup = ROOT / ".backups" / ("cg-smoke-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ"))
    shutil.copytree(directory, backup)
    value = {
        "originalPlan": plan["fingerprint"],
        "authorization": "用户明确要求继续未完成的小试；保留全部旧派发及总40上限，不部署",
        "at": datetime.now(UTC).isoformat(),
        "implementation": current,
        "changedFiles": sorted(changed),
        "ledgerPrefix": values,
        "acknowledgedUnknownCostOrdinals": [r["ordinal"] for r in errors],
        "relatedDiagnosticCalls": related,
        "taskId": state["taskId"],
        "originalStateDigest": digest(state),
        "previousRecovery": previous["digest"] if previous else None,
        "serverEvidence": evidence,
        "completedUnits": units,
        "completedValues": completed_values(directory, state["taskId"]),
        "backup": str(backup),
        "successfulCacheFiles": {p.name: checksum(p) for p in (directory / "meter/calls").glob("*.json")},
    }
    value["digest"] = digest(value)
    save(directory / "recovery.json", value)
    return receipt(directory, plan, current=current, required=True)


def activate(directory, plan, platform, state):
    value = receipt(directory, plan, required=True)
    if digest(state) != value["originalStateDigest"] or state["taskId"] != value["taskId"]:
        raise ValueError("recovery-only-acknowledges-the-original-failure")
    approved = {r["requestHash"] for r in value["ledgerPrefix"] if r["ordinal"] in value["acknowledgedUnknownCostOrdinals"]}
    with platform.db.session() as session:
        task = session.get(m.Task, state["taskId"])
        if task.status != "paused" or task.cursor_step != "extract":
            raise ValueError("original-paused-task-changed")
        failed = list(session.scalars(select(m.WorkUnit).where(m.WorkUnit.task_id == task.id, m.WorkUnit.status == "failed")))
        for unit in failed:
            if unit.step != "extract" or not any("GuardStop:ended:" + key in (unit.error or "") for key in approved):
                raise ValueError("business-failure-cannot-be-reset-by-transport-recovery")
        for unit in failed:
            unit.status = "pending"
    state.update(status="resume-ready", terminal=False, recoveryReceipt=value["digest"])
    save(directory / "batch-01/state.json", state)
