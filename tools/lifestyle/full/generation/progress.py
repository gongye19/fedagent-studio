"""离线校验检查点与已派发账本，区分生成、失败、未派发和待确认。"""

from collections import Counter

from ...common import digest, load, save
from .templates import validate_record


def unit_identity(case, identity):
    return {"case": digest(case), "model": identity}


def request_hash(case, plan, identity):
    return digest(
        {
            "ref": plan["modelRef"],
            "identity": identity,
            "messages": case["messages"],
            "settings": plan["settings"],
        }
    )


def usage(directory, plan, cases, *, write=False):
    if sum(plan["counts"].values()) != len(cases) or len({c["id"] for c in cases}) != len(cases):
        raise ValueError("planned-count-or-id-changed")
    identity = load(directory / "model.json") if (directory / "model.json").exists() else None
    ledger = load(directory / "attempts.json") if (directory / "attempts.json").exists() else []
    hashes = {request_hash(case, plan, identity): case["id"] for case in cases} if identity else {}
    if len(ledger) > plan["callLimit"] or any(
        row.get("ordinal") != i + 1 or row.get("status") not in ("started", "ok", "error") or row.get("requestHash") not in hashes
        for i, row in enumerate(ledger)
    ):
        raise ValueError("generation-ledger-corrupted")
    if {p.stem for p in (directory / "units").glob("*.json")} - {c["id"] for c in cases}:
        raise ValueError("unknown-unit-checkpoint")
    dispatched = {row["requestHash"] for row in ledger}
    unresolved = {row["requestHash"] for row in ledger if row["status"] == "started"}
    sources = {name: Counter(planned=count) for name, count in plan["counts"].items()}
    layers = {name: Counter() for name in {c["layer"] for c in cases}}
    states = {}
    for case in cases:
        path = directory / "units" / (case["id"] + ".json")
        unit = load(path) if path.exists() else None
        if unit is not None:
            expected = digest(
                {
                    "identity": unit_identity(case, identity),
                    "messages": case["messages"],
                    "settings": plan["settings"],
                }
            )
            if identity is None or unit.get("fingerprint") != expected or not isinstance(unit.get("failures"), list) or len(unit["failures"]) > 2:
                raise ValueError("unit-checkpoint-changed")
        if unit is not None and "value" in unit:
            if digest(unit["value"]) != unit.get("valueDigest") or len(unit["failures"]) >= 2:
                raise ValueError("unit-checkpoint-corrupted")
            validate_record(unit["value"], case)
            state = "generated"
        elif unit is not None and len(unit["failures"]) >= 2:
            state = "terminalFailed"
        else:
            key = request_hash(case, plan, identity) if identity else None
            state = "unresolvedDispatches" if key in unresolved else "pendingAfterDispatch" if key in dispatched else "pendingNotDispatched"
        states[case["id"]] = state
        sources[case["source"]][state] += 1
        layers[case["layer"]]["planned"] += 1
        layers[case["layer"]][state] += 1
    keys = (
        "planned",
        "generated",
        "terminalFailed",
        "pendingNotDispatched",
        "pendingAfterDispatch",
        "unresolvedDispatches",
    )
    total = {key: sum(s.get(key, 0) for s in sources.values()) for key in keys}
    result = {
        "phase": "process-generation",
        "counts": total,
        "sources": {name: {key: s.get(key, 0) for key in keys} for name, s in sorted(sources.items())},
        "layers": {name: {key: s.get(key, 0) for key in keys} for name, s in sorted(layers.items())},
        "remoteAttempts": len(ledger),
        "possiblyBilledFailedDispatches": sum(row["status"] == "error" and "usage" not in row for row in ledger),
        "callLimit": plan["callLimit"],
        "callStatuses": dict(Counter(row["status"] for row in ledger)),
        "usage": {k: sum(row.get("usage", {}).get(k, 0) for row in ledger) for k in ("prompt_tokens", "completion_tokens")},
        "uploaded": 0,
        "extracted": 0,
        "finalExperiences": None,
        "priorCacheImported": 0,
        "state": load(directory / "run.json") if (directory / "run.json").exists() else {"status": "prepared"},
    }
    if write:
        save(directory / "generation-usage.json", result)
    return result, states
