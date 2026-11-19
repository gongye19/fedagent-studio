"""顺序跑五个真实平台任务；失败保留检查点，完成批次只读核验。"""

from datetime import UTC, datetime

from fastapi.testclient import TestClient
from fedagent import models as m
from fedagent.api import create_app
from fedagent.resource_services.endpoint_checks import check_endpoint

from ...common import load, save
from ...runner import local_platform
from .budget import GuardedModel, InspectionUnavailable, SwitchingModel, allocate, ledger
from .engine import DrainingEngine, resume_failed
from .prepare import records_for
from .resources import ensure_resources, publish
from .stats import batch_usage, summarize


class VerificationUnavailable(ValueError):
    """已完成事实保留，复验失败阻止后续批次，修复后可重新核验。"""


def run_batch(directory, plan, index, platform, client, switching, *, resume=False, model_factory=GuardedModel):
    batch = plan["batches"][index]
    folder = directory / batch["id"]
    path = folder / "state.json"
    state = load(path) if path.exists() else {"fingerprint": plan["fingerprint"], "status": "prepared", "sites": {}}
    if state["fingerprint"] != plan["fingerprint"]:
        raise ValueError("batch-state-input-changed")
    if state.get("terminal"):
        raise ValueError("terminal-batch-not-resumable")
    if state["status"] == "interrupted" and not resume:
        raise ValueError("explicit-resume-after-connection-check-required")
    records = records_for(directory, batch)
    was_complete = state["status"] == "complete"
    guard = None
    try:
        if state["status"] != "complete":
            limit = allocate(directory, plan, index)
            guard = model_factory(folder, plan, limit)
            switching.active = guard
            if state["status"] == "interrupted":
                if not state.get("rootError", {}).get("recoverable"):
                    raise ValueError("non-connection-failure-not-resumable")
                if state.get("taskId"):
                    resume_failed(platform, state["taskId"], folder)
            if not state.get("probePassed"):
                if not check_endpoint(platform, "default", verify_platform=True).ok:
                    raise ValueError("platform-probe-failed")
                state["probePassed"] = True
                save(path, state)
        task_id = ensure_resources(directory, plan, batch, records, platform, client, state)
        with platform.db.session() as session:
            task = session.get(m.Task, task_id)
            if state["status"] == "complete" and task.status != "completed":
                raise ValueError("completed-task-status-changed")
            if task.status == "canceled" or (task.status == "paused" and not resume):
                raise ValueError("paused-or-canceled-task-not-silently-resumed")
            if task.status != "completed":
                task.status, task.command, task.error = "running", None, None
        if guard is not None:
            state["status"] = "running"
            save(path, state)
            result = DrainingEngine(platform, task_id, folder, guard).run()
            if result != "completed":
                with platform.db.session() as session:
                    detail = session.get(m.Task, task_id).error
                raise ValueError("algorithm-" + result + ": " + str(detail))
        batch_usage(platform, batch, records, state, require_complete=True)
        publish(directory, plan, batch, platform, client, state)
        state.update(status="complete", terminal=False)
        state.pop("error", None)
        state.pop("rootError", None)
        state.pop("inspectionError", None)
        state.pop("verificationError", None)
    except InspectionUnavailable as error:
        state["inspectionError"] = str(error)
        raise
    except Exception as error:
        if was_complete:
            state["verificationError"] = type(error).__name__ + ": " + str(error)
            raise VerificationUnavailable(state["verificationError"]) from error
        root = guard.root_error if guard else None
        recoverable = bool(root and root.get("recoverable"))
        state.update(
            status="interrupted" if recoverable else "failed", terminal=not recoverable, error=type(error).__name__ + ": " + str(error), rootError=root
        )
    finally:
        if guard is not None:
            guard.stopped.set()
        switching.active = None
        state["updatedAt"] = datetime.now(UTC).isoformat()
        save(path, state)
        if not state.get("verificationError"):
            batch_usage(platform, batch, records, state)
    return state


def run(directory, plan, *, resume=False):
    existing = [ledger(directory / b["id"], plan["identity"]) for b in plan["batches"]]
    if plan["generationAttempts"] + sum(map(len, existing)) > plan["globalCallCap"]:
        raise ValueError("whole-job-call-cap-exceeded")
    switching = SwitchingModel(plan["identity"])
    platform = local_platform(directory, switching)
    verification_error = False
    try:
        with TestClient(create_app(platform)) as client:
            for index, batch in enumerate(plan["batches"]):
                state = run_batch(directory, plan, index, platform, client, switching, resume=resume)
                summarize(directory, plan, platform)
                print(batch["id"] + ": " + state["status"], flush=True)
                if state["status"] != "complete":
                    break
    except VerificationUnavailable as error:
        verification_error = True
        path = directory / "source-usage.json"
        previous = load(path) if path.exists() else {}
        save(path, {**previous, "status": "verification-required", "countsVerified": False, "verificationError": str(error)})
        raise
    finally:
        if not verification_error:
            result = summarize(directory, plan, platform)
    return result
