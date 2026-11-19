"""有限两组真实评测；故障停止派发，保留单元、额度与完成事实。"""

from datetime import UTC, datetime

from ...batch.evaluate import evaluate, summarize
from ...common import digest, load, save
from ..federation.budget import GuardedModel, InspectionUnavailable, ledger
from .checkpoints import verify_complete, verify_existing
from .report import report


class EvaluationModel(GuardedModel):
    def chat(self, prompt, **settings):
        self.model.last.dispatched = False
        return super().chat(prompt, **settings)

    def was_dispatched(self):
        return self.model.was_dispatched()

    def reject_last(self):
        return self.model.reject_last()


def run(directory, plan, *, resume=False, factory=EvaluationModel):
    path = directory / "run.json"
    state = load(path) if path.exists() else {"fingerprint": plan["fingerprint"], "status": "prepared"}
    if state["fingerprint"] != plan["fingerprint"]:
        raise ValueError("comparison-state-identity-changed")
    if state.get("terminal"):
        raise ValueError("comparison-terminal-no-retry")
    try:
        attempts = ledger(directory, plan["identity"])
        if len(attempts) >= plan["callLimit"] and state["status"] != "complete":
            raise ValueError("comparison-ledger-budget-exhausted")
        verify_existing(directory, plan)
    except Exception as error:
        message = type(error).__name__ + ": " + str(error)
        if state["status"] == "complete":
            state["verificationError"] = message
        else:
            state.update(status="failed", terminal=True, error=message)
        save(path, state)
        raise
    if state["status"] == "complete":
        try:
            verify_complete(directory, plan)
        except Exception as error:
            state["verificationError"] = type(error).__name__ + ": " + str(error)
            save(path, state)
            raise
        state.pop("verificationError", None)
        save(path, state)
        return report(directory, plan, state)
    if state["status"] == "running":
        raise ValueError("comparison-unclean-exit-needs-attention")
    if state["status"] == "interrupted" and not resume:
        raise ValueError("explicit-connection-checked-resume-required")
    if state["status"] == "interrupted" and not state.get("rootError", {}).get("recoverable"):
        raise ValueError("comparison-not-recoverable")
    model = None
    try:
        model = factory(directory, plan, plan["callLimit"])
        if state["status"] == "interrupted":
            history = load(directory / "resumes.json") if (directory / "resumes.json").exists() else []
            save(directory / "resumes.json", [*history, {"ledgerDigest": digest(attempts), "at": datetime.now(UTC).isoformat()}])
        state.update(status="running", startedAt=state.get("startedAt", datetime.now(UTC).isoformat()))
        save(path, state)
        results = evaluate(directory, plan, load(directory / "inputs/collection.json"), model)
        invalid = [r["error"] for r in results if r.get("error") and r.get("permanentMissing") and not r["error"].startswith("UnitExhausted:")]
        if invalid:
            raise ValueError("evaluation-checkpoint-or-code-failure:" + str(invalid))
        if model.root_error:
            recoverable = model.root_error["recoverable"]
            state.update(status="interrupted" if recoverable else "failed", terminal=not recoverable, rootError=model.root_error)
        elif summarize(results)["incompleteCases"]:
            state.update(status="incomplete", terminal=True, error="unit-two-attempts-exhausted; missing cases excluded")
        else:
            verify_complete(directory, plan)
            state.update(status="complete", terminal=False)
            state.pop("rootError", None)
            state.pop("inspectionError", None)
            state.pop("error", None)
    except InspectionUnavailable as error:
        state["inspectionError"] = str(error)
        raise
    except Exception as error:
        state.update(status="failed", terminal=True, error=type(error).__name__ + ": " + str(error))
    finally:
        if model is not None:
            model.stopped.set()
        state["updatedAt"] = datetime.now(UTC).isoformat()
        save(path, state)
    if state["status"] == "failed":
        raise ValueError(state.get("error") or str(state.get("rootError")))
    return report(directory, plan, state)
