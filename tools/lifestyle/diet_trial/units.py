"""独立调用账本与严格模型缓存回证，不扩展或修复历史冻结计划。"""

from ..batch.calls import obtain
from ..common import digest, load
from ..full.federation.budget import GuardedModel, ledger


class DietModel(GuardedModel):
    def chat(self, prompt, **settings):
        self.model.last.dispatched = False
        return super().chat(prompt, **settings)

    def was_dispatched(self):
        return self.model.was_dispatched()

    def reject_last(self):
        return self.model.reject_last()


def checked_ledger(directory, plan):
    values = ledger(directory / "meter", plan["identity"])
    if len(values) > plan["globalCallCap"]:
        raise ValueError("call-cap-exceeded")
    if any(r["status"] == "error" and "usage" not in r and not r.get("completedUpstreamError") for r in values):
        raise ValueError("unknown-cost-failure-blocks-job")
    return values


def value(directory, plan, relative, messages, settings, parse, *, guard=None, reserve=0):
    body = {"ref": plan["modelRef"], "identity": plan["identity"], "messages": messages, "settings": settings}
    path = directory / relative
    if guard is not None:
        checked_ledger(directory, plan)
        guard.model.reserved = reserve
        obtain(path, plan["identity"], guard, messages, settings, parse)
    unit = load(path)
    cache = load(directory / f"meter/calls/{digest(body)}.json")
    if (
        unit["fingerprint"] != digest({k: body[k] for k in ("identity", "messages", "settings")})
        or cache["request"] != body
        or cache.get("rejected")
        or cache["resultDigest"] != digest(cache["result"])
        or cache["result"].get("finish_reason") not in (None, "stop")
        or parse(cache["result"]["text"]) != unit["value"]
        or digest(unit["value"]) != unit["valueDigest"]
    ):
        raise ValueError("unit-not-backed-by-model-cache")
    return unit["value"]
