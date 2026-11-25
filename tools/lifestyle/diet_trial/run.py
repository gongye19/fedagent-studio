"""先生成真实模型建议，再走原FoT，最后双组推荐与匿名评分。"""

from functools import partial

from fastapi.testclient import TestClient
from fedagent import models as m
from fedagent.api import create_app
from fedagent.resource_services.endpoint_checks import check_endpoint
from fedagent_records.lifestyle import LifestyleRecords
from fedagent_sdk import Row

from ..common import digest, jsonl, load, rows, save
from ..full.federation.engine import DrainingEngine
from ..full.federation.resources import ensure_resources, publish
from ..full.federation.stats import batch_usage
from ..runner import local_platform
from .evidence import judge_reply
from .prepare import SOURCE_POLICY, validate
from .protocol import (
    ANSWER_SETTINGS,
    JUDGE_SETTINGS,
    answer_messages,
    judge_messages,
    public,
    record,
    retrieval,
    text_reply,
    training_messages,
)
from .units import DietModel, checked_ledger, value


def generated_records(directory, plan, guard=None):
    cases = rows(directory / "inputs/learning.jsonl")
    records = {s: [] for s in "ABC"}
    remaining = sum(
        not (directory / f"generation/{c['id']}.json").exists() or "value" not in load(directory / f"generation/{c['id']}.json")
        for c in cases
    )
    for case in cases:
        relative = f"generation/{case['id']}.json"
        complete = (directory / relative).exists() and "value" in load(directory / relative)
        reply = value(
            directory,
            plan,
            relative,
            training_messages(case),
            ANSWER_SETTINGS,
            text_reply,
            guard=guard,
            reserve=30 + remaining - int(not complete),
        )
        report = LifestyleRecords().check([Row(1, record(case, reply, SOURCE_POLICY["sourceVersion"]))])
        if report.count != 1 or report.issues:
            raise ValueError("generated-advice-contract-invalid")
        records[case["site"]].extend(report.items)
        remaining -= not complete
        if guard:
            print(f"advice record {case['site']} {case['id']}: complete", flush=True)
    return records


def federate(directory, plan, guard, records):
    path = directory / "batch-01/state.json"
    state = load(path) if path.exists() else {"fingerprint": plan["fingerprint"], "status": "prepared", "sites": {}}
    if state["fingerprint"] != plan["fingerprint"] or state.get("terminal"):
        raise ValueError("terminal-or-changed-algorithm-job")
    for site, items in records.items():
        target = directory / f"inputs/batch-01-{site}.jsonl"
        if target.exists() and rows(target) != items:
            raise ValueError("derived-upload-changed")
        if not target.exists():
            jsonl(target, items)
    batch = plan["batches"][0]
    platform = local_platform(directory, guard)
    guard.model.reserved = 15  # 12份回答+3次盲评不能被原算法的重试吃掉。
    with TestClient(create_app(platform)) as client:
        if not state.get("probePassed"):
            if not check_endpoint(platform, "default", verify_platform=True).ok:
                raise ValueError("model-probe-failed")
            state["probePassed"] = True
            save(path, state)
        task_id = ensure_resources(directory, plan, batch, records, platform, client, state)
        with platform.db.session() as session:
            task = session.get(m.Task, task_id)
            if task.status in {"paused", "canceled"}:
                raise ValueError("algorithm-paused-or-canceled")
            if task.status != "completed":
                task.status, task.command, task.error = "running", None, None
        state["status"] = "running"
        save(path, state)
        if DrainingEngine(platform, task_id, directory / "batch-01", guard).run() != "completed":
            state.update(status="failed", terminal=True, rootError=guard.root_error)
            save(path, state)
            raise ValueError("algorithm-not-completed-preserve-checkpoints")
        usage = batch_usage(platform, batch, records, state, require_complete=True)
        publish(directory, plan, batch, platform, client, state)
        state.update(status="complete", sourceUsage=usage, federationAttempts=len(checked_ledger(directory, plan)))
        save(path, state)
    return load(directory / "batch-01/library.json")


def answers(directory, plan, library, guard=None):
    cases = rows(directory / "inputs/evaluation.jsonl")
    schedule = [(case, arm) for i, case in enumerate(cases) for arm in (("baseline", "shared") if i % 2 else ("shared", "baseline"))]
    remaining = sum(
        not (directory / f"answers/{c['id']}-{a}.json").exists() or "value" not in load(directory / f"answers/{c['id']}-{a}.json")
        for c, a in schedule
    )
    replies = {c["id"]: {} for c in cases}
    for case, arm in schedule:
        selected, audit = retrieval(case["input"], library)
        relative = f"answers/{case['id']}-{arm}.json"
        complete = (directory / relative).exists() and "value" in load(directory / relative)
        replies[case["id"]][arm] = value(
            directory,
            plan,
            relative,
            answer_messages(case["input"], selected if arm == "shared" else {}),
            ANSWER_SETTINGS,
            text_reply,
            guard=guard,
            reserve=3 + remaining - int(not complete),
        )
        receipt = {"case": case["id"], "arm": arm, "retrieval": audit if arm == "shared" else None}
        target = directory / f"answers/{case['id']}-{arm}-receipt.json"
        if target.exists() and load(target) != receipt:
            raise ValueError("retrieval-receipt-changed")
        if guard:
            save(target, receipt)
            print(f"recommendation {case['id']} {arm}: complete", flush=True)
        elif not target.exists():
            raise ValueError("missing-retrieval-receipt")
        remaining -= not complete
    return cases, replies


def judging(directory, plan, cases, replies, guard=None):
    result = {}
    for offset in range(0, len(cases), 2):
        blinded = [
            {
                "id": c["id"],
                "input": public(c["input"]),
                "answers": {label: replies[c["id"]][arm] for label, arm in plan["blindMaps"][c["id"]].items()},
            }
            for c in cases[offset : offset + 2]
        ]
        parsed = value(
            directory,
            plan,
            f"judging/batch-{offset // 2 + 1}.json",
            judge_messages(blinded),
            JUDGE_SETTINGS,
            partial(judge_reply, cases=blinded),
            guard=guard,
            reserve=2 - offset // 2,
        )
        for case_id, scores in parsed.items():
            result[case_id] = {plan["blindMaps"][case_id][label]: score for label, score in scores.items()}
        if guard:
            print(f"blind judging {offset // 2 + 1}/3: complete", flush=True)
    return result


def run(directory, *, link=None):
    from .verify import verify

    plan = validate(directory)
    checked_ledger(directory, plan)
    if (directory / "COMPLETE.json").exists():
        return verify(directory)
    if ((directory / "STOP.json").exists() and not plan.get("recovery")) or stop_path(directory, plan).exists():
        raise ValueError("stopped-job-needs-explicit-investigation-no-auto-retry")
    factory = {}
    if link is not None:
        from ..diet_transport import DietCachedModel

        factory["factory"] = partial(DietCachedModel, link=link)
    guard = DietModel(directory / "meter", plan, plan["globalCallCap"], **factory)
    try:
        records = generated_records(directory, plan, guard)
        state = directory / "batch-01/state.json"
        if state.exists() and load(state)["status"] == "complete":
            from .verify import verify_federation

            library = verify_federation(directory, plan, records)[0]
        else:
            library = federate(directory, plan, guard, records)
        cases, replies = answers(directory, plan, library, guard)
        judging(directory, plan, cases, replies, guard)
        result = verify(directory, completing=True)
        save(directory / "COMPLETE.json", {"fingerprint": plan["fingerprint"], "reportDigest": digest(result)})
        return result
    except Exception as error:
        save(stop_path(directory, plan), {"type": type(error).__name__, "message": str(error), "rootError": guard.root_error})
        raise
    finally:
        guard.stopped.set()


def stop_path(directory, plan):
    approved = plan.get("recovery")
    if approved and approved.get("scoringResume"):
        return directory / f"recovery/scoring-{approved['scoringResume']}-STOP.json"
    return directory / (
        "recovery/evidence-STOP.json"
        if approved and approved.get("acceptedResponses")
        else "recovery/STOP.json"
        if approved
        else "STOP.json"
    )
