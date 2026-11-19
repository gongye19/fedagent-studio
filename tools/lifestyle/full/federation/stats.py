"""从实际上传数据、已完成工作单元和trace计算用量，写入任务审计。"""

from collections import Counter

from fedagent import models as m
from sqlalchemy import select

from ...common import digest, load, save

KEYS = ("planned", "generated", "uploaded", "processedItems", "reflectedItems", "extractedUnits", "traceProducingItems", "zeroTraceItems", "traceCount")


def batch_usage(platform, batch, records, state, *, require_complete=False):
    result = {source: dict.fromkeys(KEYS, 0) for source in batch["sources"]}
    with platform.db.session() as session:
        for source, values in records.items():
            expected = {r["id"] for r in values}
            info = result[source]
            info.update(planned=len(values), generated=len(values))
            resource = state.get("sites", {}).get(source)
            if not resource:
                continue
            dataset = session.get(m.Dataset, resource["datasetId"])
            if dataset is None or dataset.count != len(expected) or digest(platform.files.load(dataset.content_path)) != digest(values):
                raise ValueError("source-usage-upload-mismatch")
            info["uploaded"] = dataset.count
            if not state.get("taskId"):
                continue
            units = list(session.scalars(select(m.WorkUnit).where(m.WorkUnit.task_id == state["taskId"], m.WorkUnit.site_id == resource["participantId"])))
            completed = {step: {u.unit_key for u in units if u.step == step and u.status == "done"} for step in ("prepare", "reflect", "extract")}
            if any(ids - expected for ids in completed.values()):
                raise ValueError("unknown-processed-item")
            traces = list(
                session.scalars(
                    select(m.Message).where(
                        m.Message.task_id == state["taskId"], m.Message.sender_site == resource["participantId"], m.Message.channel == "trace"
                    )
                )
            )
            coverage = Counter(t.item_id for t in traces)
            if set(coverage) - expected or any(n > 3 for n in coverage.values()):
                raise ValueError("trace-item-coverage-invalid")
            if require_complete and (any(ids != expected for ids in completed.values()) or set(coverage) - completed["extract"]):
                raise ValueError("incomplete-source-extraction")
            info.update(
                processedItems=len(completed["prepare"]),
                reflectedItems=len(completed["reflect"]),
                extractedUnits=len(completed["extract"]),
                traceProducingItems=len(coverage),
                zeroTraceItems=len(completed["extract"] - set(coverage)),
                traceCount=sum(coverage.values()),
            )
        if state.get("taskId"):
            task = session.get(m.Task, state["taskId"])
            task.audit = {**task.audit, "lifestyleSourceUsage": result}
    return result


def summarize(directory, plan, platform):
    from .prepare import records_for

    sources = {source: dict.fromkeys(KEYS, 0) for source in plan["counts"]}
    batches = []
    for batch in plan["batches"]:
        path = directory / batch["id"] / "state.json"
        state = load(path) if path.exists() else {"status": "not-started", "sites": {}}
        counts = batch_usage(platform, batch, records_for(directory, batch), state)
        for source, values in counts.items():
            for key in KEYS:
                sources[source][key] += values[key]
        batches.append(
            {
                "batch": batch["id"],
                "status": state["status"],
                "taskId": state.get("taskId"),
                "appId": state.get("appId"),
                "finalEntries": state.get("finalEntries"),
                "sources": counts,
                "error": state.get("verificationError") or state.get("error") or state.get("inspectionError"),
            }
        )
    complete = all(b["status"] == "complete" and not b["error"] for b in batches)
    attempts = []
    for batch in plan["batches"]:
        path = directory / batch["id"] / "attempts.json"
        attempts.extend(load(path) if path.exists() else [])
    result = {
        "status": "complete" if complete else "incomplete",
        "countsVerified": True,
        "sources": sources,
        "batches": batches,
        "generationAttempts": plan["generationAttempts"],
        "federationAttempts": len(attempts),
        "totalAttempts": plan["generationAttempts"] + len(attempts),
        "callCap": plan["globalCallCap"],
        "possiblyBilledFailedDispatches": sum(r["status"] == "error" and "usage" not in r for r in attempts),
        "usage": {k: sum(r.get("usage", {}).get(k, 0) for r in attempts) for k in ("prompt_tokens", "completion_tokens")},
        "finalEntriesByBatch": {b["batch"]: b["finalEntries"] for b in batches},
        "combinedLibrary": False,
        "deployed": False,
        "evaluationRun": False,
    }
    if complete and (
        sum(s["extractedUnits"] for s in sources.values()) != sum(plan["counts"].values()) or {s: v["uploaded"] for s, v in sources.items()} != plan["counts"]
    ):
        raise ValueError("global-source-coverage-not444")
    save(directory / "source-usage.json", result)
    return result
