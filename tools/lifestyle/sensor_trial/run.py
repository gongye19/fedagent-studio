"""单账本、有限派发；真实引擎完全结束后才串行生成两组预测。"""

from functools import partial

from fastapi.testclient import TestClient
from fedagent import models as m
from fedagent.api import create_app
from fedagent.resource_services.endpoint_checks import check_endpoint

from ..batch.calls import obtain
from ..common import digest, load, rows, save
from ..full.federation.budget import GuardedModel, ledger
from ..full.federation.engine import DrainingEngine
from ..full.federation.resources import ensure_resources, publish
from ..full.federation.stats import batch_usage
from ..runner import local_platform
from .adapter import SETTINGS, messages, prediction
from .prepare import validate
from .recovery import activate, receipt, related_calls
from .retrieval import retrieve


class TrialModel(GuardedModel):
    def chat(self, prompt, **settings):
        # guard也可能在进入CachedModel前拒绝；不能继承上次派发标志。
        self.model.last.dispatched = False
        return super().chat(prompt, **settings)

    def was_dispatched(self):
        return self.model.was_dispatched()

    def reject_last(self):
        return self.model.reject_last()


def checked_ledger(directory, plan):
    values = ledger(directory / "meter", plan["identity"])
    recovery = receipt(directory, plan, values=values)
    if len(values) + (recovery["relatedDiagnosticCalls"] if recovery else 0) > plan["globalCallCap"]:
        raise ValueError("whole-job-budget-exceeded")
    acknowledged = recovery["acknowledgedUnknownCostOrdinals"] if recovery else []
    if any(r["status"] == "error" and "usage" not in r and r["ordinal"] not in acknowledged for r in values):
        raise ValueError("unknown-cost-transport-failure-blocks-job")
    return values


def federate(directory, plan, guard):
    folder, batch = directory / "batch-01", plan["batches"][0]
    path = folder / "state.json"
    state = load(path) if path.exists() else {"fingerprint": plan["fingerprint"], "status": "prepared", "sites": {}}
    if state["fingerprint"] != plan["fingerprint"]:
        raise ValueError("terminal-or-changed-algorithm-job")
    records = {site: rows(directory / f"inputs/batch-01-{site}.jsonl") for site in "ABC"}
    platform = local_platform(directory, guard)
    if state.get("terminal"):
        activate(directory, plan, platform, state)
    with TestClient(create_app(platform)) as client:
        if not state.get("probePassed"):
            if not check_endpoint(platform, "default", verify_platform=True).ok:
                raise ValueError("model-probe-failed")
            state["probePassed"] = True
            save(path, state)
        task_id = ensure_resources(directory, plan, batch, records, platform, client, state)
        with platform.db.session() as session:
            task = session.get(m.Task, task_id)
            if task.status == "canceled" or (task.status == "paused" and state["status"] != "resume-ready"):
                raise ValueError("algorithm-paused-or-canceled: " + str(task.error))
            if task.status != "completed":
                task.status, task.command, task.error = "running", None, None
        state["status"] = "running"
        save(path, state)
        result = DrainingEngine(platform, task_id, folder, guard).run()
        if result != "completed":
            state.update(status="failed", terminal=True, error="algorithm-" + str(result), rootError=guard.root_error)
            save(path, state)
            raise ValueError("algorithm-not-completed; preserve-job-and-ledger")
        usage = batch_usage(platform, batch, records, state, require_complete=True)
        publish(directory, plan, batch, platform, client, state)
        state.update(status="complete", sourceUsage=usage, federationAttempts=len(checked_ledger(directory, plan)))
        state.pop("error", None)
        state.pop("rootError", None)
        save(path, state)
    return state


def evaluate(directory, plan, guard, library):
    cases = rows(directory / "inputs/evaluation.jsonl")
    schedule = [(case, arm) for i, case in enumerate(cases) for arm in (("baseline", "shared") if i % 2 == 0 else ("shared", "baseline"))]
    # 已完成单元不会再派发，不占尚未开始的正常回答预留。
    remaining = sum(
        not (directory / f"answers/{case['id']}-{arm}.json").exists() or "value" not in load(directory / f"answers/{case['id']}-{arm}.json")
        for case, arm in schedule
    )
    for case, arm in schedule:
        selected, audit = retrieve(case["input"], library)
        unit = directory / f"answers/{case['id']}-{arm}.json"
        complete = unit.exists() and "value" in load(unit)
        if not complete:
            if len(checked_ledger(directory, plan)) + remaining + related_calls(directory, plan) > plan["globalCallCap"]:
                raise ValueError("insufficient-budget-for-remaining-answers")
            guard.model.reserved = remaining - 1
        request = messages(case["input"], selected if arm == "shared" else {})
        obtain(unit, plan["identity"], guard, request, SETTINGS, prediction)
        receipt = {
            "case": case["id"],
            "arm": arm,
            "requestHash": digest({"ref": plan["modelRef"], "identity": plan["identity"], "messages": request, "settings": SETTINGS}),
            "retrieval": audit if arm == "shared" else None,
        }
        receipt_path = directory / f"answers/{case['id']}-{arm}-receipt.json"
        if receipt_path.exists() and load(receipt_path) != receipt:
            raise ValueError("answer-receipt-changed")
        save(receipt_path, receipt)
        remaining -= not complete
        print(f"answer {case['id']} {arm}: complete", flush=True)


def run(directory, *, link=None):
    plan = validate(directory)
    checked_ledger(directory, plan)
    from .verify import verify, verify_federation

    if (directory / "COMPLETE.json").exists():
        return verify(directory)
    factory = {}
    if link is not None:
        from .transport import ConnectedModel

        factory["factory"] = partial(ConnectedModel, link=link)
    guard = TrialModel(directory / "meter", plan, plan["globalCallCap"] - related_calls(directory, plan), **factory)
    try:
        guard.model.reserved = 12
        state_path = directory / "batch-01/state.json"
        if not state_path.exists() or load(state_path)["status"] != "complete":
            federate(directory, plan, guard)
        library, _ = verify_federation(directory, plan)
        evaluate(directory, plan, guard, library)
        result = verify(directory, completing=True)
        save(directory / "COMPLETE.json", {"fingerprint": plan["fingerprint"], "reportDigest": digest(result)})
        return result
    finally:
        guard.stopped.set()
