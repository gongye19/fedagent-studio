"""固定全作业1500次；每批预留后续批次正常调用，账本不清零。"""

import json
import subprocess
import threading

from fedagent_sdk import ModelError, ModelUnavailable

from ...common import digest, load, save
from ...model import CachedModel, InvalidReply, NotDispatchedPermanent


class GuardStop(ModelUnavailable):
    """立即暂停并保留成功调用，不耗尽其他单元的格式重试。"""


class InspectionUnavailable(ModelUnavailable):
    """未付费的身份读取失败，保持原状态与账本，不能当成身份变更。"""


def connection_errors(values, key):
    return sum(r["requestHash"] == key and r["status"] == "error" and "usage" not in r for r in values)


def ledger(directory, identity):
    path = directory / "attempts.json"
    values = load(path) if path.exists() else []
    if any(
        r.get("ordinal") != i + 1
        or r.get("status") not in ("started", "ok", "error")
        or not isinstance(r.get("requestHash"), str)
        or len(r["requestHash"]) != 64
        for i, r in enumerate(values)
    ):
        raise ValueError("batch-ledger-corrupt")
    if any(r["status"] == "started" for r in values):
        raise ValueError("unconfirmed-dispatch-permanently-blocks-this-job")
    model_path = directory / "model.json"
    if values and not model_path.exists():
        raise ValueError("paid-ledger-model-identity-missing")
    if model_path.exists() and load(model_path) != identity:
        raise ValueError("batch-model-identity-changed")
    for path in (directory / "calls").glob("*.json"):
        value = load(path)
        if digest(value["request"]) != path.stem or value["request"]["identity"] != identity or digest(value["result"]) != value.get("resultDigest"):
            raise ValueError("batch-model-cache-corrupt")
        if not any(r["requestHash"] == path.stem and r["status"] == "ok" for r in values):
            raise ValueError("cached-result-missing-paid-ledger")
    return values


def allocate(directory, plan, index):
    allowed = {b["id"] for b in plan["batches"]}
    if {p.name for p in directory.glob("batch-*")} - allowed:
        raise ValueError("unknown-batch-directory")
    ledgers = [ledger(directory / b["id"], plan["identity"]) for b in plan["batches"]]
    spent = plan["generationAttempts"] + sum(map(len, ledgers))
    if spent > plan["globalCallCap"] or any(ledgers[index + 1 :]):
        raise ValueError("global-budget-or-batch-order-invalid")
    future = sum(2 * b["count"] + 3 for b in plan["batches"][index + 1 :])
    prior = sum(len(v) for v in ledgers[:index])
    limit = min(plan["batchCallCap"], plan["globalCallCap"] - plan["generationAttempts"] - prior - future)
    value = {"fingerprint": plan["fingerprint"], "limit": limit, "priorSpent": prior, "reservedFuture": future, "generationSpent": plan["generationAttempts"]}
    path = directory / plan["batches"][index]["id"] / "allocation.json"
    if path.exists():
        if load(path) != value or len(ledgers[index]) > limit:
            raise ValueError("locked-allocation-changed")
    else:
        if limit < 2 * plan["batches"][index]["count"] + 3:
            raise ValueError("insufficient-reserved-budget-before-batch")
        save(path, value)
    return limit


class GuardedModel:
    def __init__(self, directory, plan, limit, *, factory=CachedModel):
        self.directory, self.plan = directory, plan
        # 只是冻结预期身份；构造器仍须通过远端读取验证，不能先写入新身份。
        if not (directory / "model.json").exists():
            save(directory / "model.json", plan["identity"])
        try:
            self.model = factory(directory, plan["modelRef"], limit, ceiling=850, reserved=0, context_cap=plan["contextCap"])
        except (ModelError, subprocess.SubprocessError, json.JSONDecodeError) as error:
            if isinstance(error, NotDispatchedPermanent):
                raise
            raise InspectionUnavailable("身份读取暂不可用；未付费派发，核对SSH后可续跑原批次") from error
        if self.model.identity != plan["identity"]:
            raise ValueError("generation-and-federation-model-mismatch")
        self.name, self.identity = self.model.name, self.model.identity
        self.stopped, self.lock, self.root_error = threading.Event(), threading.Lock(), None

    def chat(self, prompt, **settings):
        messages = [{"role": "user", "content": prompt}] if isinstance(prompt, str) else prompt
        key = digest({"ref": self.plan["modelRef"], "identity": self.identity, "messages": messages, "settings": settings})
        if self.stopped.is_set():
            raise GuardStop("GuardStop:blocked:" + key)
        entered = False
        prior_errors = 0
        try:
            attempts = load(self.directory / "attempts.json") if (self.directory / "attempts.json").exists() else []
            prior_errors = connection_errors(attempts, key)
            if prior_errors >= 2:
                raise NotDispatchedPermanent("same-request-two-errors-exhausted")
            output_cap = max(settings.get("max_tokens") or 0, settings.get("max_completion_tokens") or 0)
            if len(json.dumps(messages, ensure_ascii=False).encode()) + output_cap + 1024 > self.plan["contextCap"]:
                raise NotDispatchedPermanent("actual-aggregate-request-over-operational-context-cap")
            entered = True
            return self.model.chat(messages, **settings)
        except InvalidReply:
            raise
        except Exception as error:
            with self.lock:
                if self.root_error is None:
                    self.root_error = {
                        "type": type(error).__name__,
                        "message": str(error),
                        "requestHash": key,
                        "dispatched": entered and self.model.was_dispatched(),
                        "recoverable": isinstance(error, ModelError)
                        and not isinstance(error, NotDispatchedPermanent)
                        and prior_errors + int(entered and self.model.was_dispatched()) < 2
                        and not self.model.budget_exhausted
                        and not self.model.context_failure,
                    }
                self.stopped.set()
            raise GuardStop("GuardStop:ended:" + key) from error


class SwitchingModel:
    def __init__(self, identity):
        self.name, self.identity, self.active = identity["model"], identity, None

    def chat(self, messages, **settings):
        active = self.active
        if active is None:
            raise GuardStop("No active batch; business dispatch refused")
        return active.chat(messages, **settings)
