"""限500次、两路并行，终态单元不重算，非局部异常立即停止派发。"""

import json
import threading
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import UTC, datetime

from fedagent_sdk import ModelError

from ...batch.calls import UnitExhausted, obtain
from ...common import load, save
from ...model import CachedModel, InvalidReply, NotDispatchedPermanent
from .progress import unit_identity, usage
from .templates import parse_reply


def now():
    return datetime.now(UTC).isoformat()


class HaltOnFailure:
    """连接异常后阻止其他线程的下一次尝试；已派发的请求正常收尾。"""

    def __init__(self, model):
        self.model, self.stopped, self.local = model, threading.Event(), threading.local()

    def chat(self, messages, **settings):
        self.local.blocked = self.stopped.is_set()
        if self.local.blocked:
            raise ModelError("本次运行已停止派发，未发送此请求")
        try:
            return self.model.chat(messages, **settings)
        except ModelError as error:
            if not isinstance(error, InvalidReply):
                self.stopped.set()
            raise
        except BaseException:
            self.stopped.set()
            raise

    def was_dispatched(self):
        return not self.local.blocked and self.model.was_dispatched()

    def reject_last(self):
        self.model.reject_last()


def run(directory, plan, cases, *, take=None, model_factory=CachedModel):
    path = directory / "run.json"
    state = load(path) if path.exists() else {"status": "prepared", "startedAt": now()}
    before, states = usage(directory, plan, cases)
    if state.get("terminal") or state["status"] in (
        "complete",
        "complete-with-failures",
    ):
        return before
    if before["counts"]["unresolvedDispatches"]:
        state.update(
            status="failed",
            terminal=True,
            error="有未确认结果的已派发调用；本批终止，禁止重发或修改账本续跑；须另行核对已计费用量",
            updatedAt=now(),
        )
        save(path, state)
        return usage(directory, plan, cases, write=True)[0]
    if before["counts"]["terminalFailed"] >= plan["failureCircuit"] or before["remoteAttempts"] >= plan["callLimit"]:
        state.update(
            status="failed",
            terminal=True,
            error="failure-circuit-or-generation-budget",
            updatedAt=now(),
        )
        save(path, state)
        return usage(directory, plan, cases, write=True)[0]
    selected = [case for case in cases if states[case["id"]] not in ("generated", "terminalFailed")]
    if take is not None:
        if type(take) is not int or take < 1:
            raise ValueError("take必须为正整数")
        selected = selected[:take]
    try:
        # 在构造模型（会读取远端身份）之前再核对全部请求，包含双层JSON转义。
        if any(
            len(json.dumps(c["messages"], ensure_ascii=False).encode()) != c["requestBytes"]
            or c["requestBytes"] + plan["settings"]["max_tokens"] + 1024 > plan["contextCap"]
            for c in cases
        ):
            raise ValueError("frozen-context-preflight-changed")
        model = model_factory(
            directory,
            plan["modelRef"],
            plan["callLimit"],
            ceiling=850,
            reserved=0,
            context_cap=plan["contextCap"],
        )
        guarded = HaltOnFailure(model)
        state.update(status="running", updatedAt=now())
        state.pop("error", None)
        save(path, state)

        def one(case):
            try:
                obtain(
                    directory / "units" / (case["id"] + ".json"),
                    unit_identity(case, model.identity),
                    guarded,
                    case["messages"],
                    plan["settings"],
                    lambda text: parse_reply(text, case),
                )
            except UnitExhausted as error:
                if isinstance(error.__cause__, ModelError) and not isinstance(error.__cause__, InvalidReply):
                    raise error.__cause__ from None
                return "terminalFailed"
            return "generated"

        iterator = iter(selected)
        with ThreadPoolExecutor(max_workers=2) as pool:
            pending = {pool.submit(one, case) for case in [next(iterator, None), next(iterator, None)] if case is not None}
            try:
                while pending:
                    done, pending = wait(pending, return_when=FIRST_COMPLETED)
                    for future in done:
                        future.result()
                    current, _ = usage(directory, plan, cases, write=True)
                    print(
                        f"generated {current['counts']['generated']}/{len(cases)}; terminalFailed {current['counts']['terminalFailed']}",
                        flush=True,
                    )
                    if current["counts"]["terminalFailed"] >= plan["failureCircuit"]:
                        raise ValueError("terminal-unit-failure-circuit")
                    for _ in done:
                        case = next(iterator, None)
                        if case is not None:
                            pending.add(pool.submit(one, case))
            except BaseException:
                guarded.stopped.set()
                for future in pending:
                    future.cancel()
                raise
        final, _ = usage(directory, plan, cases)
        state["status"] = (
            "complete"
            if final["counts"]["generated"] == len(cases)
            else "complete-with-failures"
            if (final["counts"]["generated"] + final["counts"]["terminalFailed"] == len(cases))
            else "paused-by-limit"
        )
    except Exception as error:
        state.update(status="interrupted", error=type(error).__name__ + ": " + str(error))
        if not isinstance(error, ModelError) or isinstance(error, NotDispatchedPermanent) or ("model" in locals() and model.budget_exhausted):
            state["terminal"] = True
            state["status"] = "failed"
    state["updatedAt"] = now()
    save(path, state)
    return usage(directory, plan, cases, write=True)[0]
