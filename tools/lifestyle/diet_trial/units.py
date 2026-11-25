"""独立调用账本与严格模型缓存回证，不扩展或修复历史冻结计划。"""

from ..batch.calls import obtain
from ..common import digest, load
from ..full.federation.budget import GuardedModel, ledger


class DietModel(GuardedModel):
    def _prior_errors(self, values, key):
        approved = self.plan.get("recovery")
        if not approved:
            return super()._prior_errors(values, key)
        relevant = [r for r in values if r["ordinal"] not in approved["acknowledgedOrdinals"]]
        failures = [r for r in relevant if r["requestHash"] == key and r["status"] == "error" and "usage" not in r]
        if failures:
            from .recovery import diagnostic_counts

            known = diagnostic_counts(self.directory.parent).get(key, 0) - approved["priorDiagnostics"].get(key, 0)
            if known >= len(failures) and all(r.get("completedUpstreamError") for r in failures):
                return 0 if len(failures) < 4 else 2
        return super()._prior_errors(relevant, key)

    def chat(self, prompt, **settings):
        from ..diet_transport import CompletedUpstreamError

        for attempt in range(4):
            self.model.last.dispatched = False
            try:
                return super().chat(prompt, **settings)
            except CompletedUpstreamError as error:
                if not self.plan.get("recovery") or not error.overloaded or attempt == 3:
                    raise
                # 传输层会在下一次真正发出请求前共享退避；所有失败仍由原CachedModel入账。
                print("confirmed upstream overload; bounded delayed retry", flush=True)

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
    approved = plan.get("recovery")
    proof = approved.get("acceptedResponses", {}).get(relative) if approved else None
    path = directory / ("recovery/units/" + relative if approved and (relative == approved["failedUnit"] or proof) else relative)
    if guard is not None and not proof:
        checked_ledger(directory, plan)
        guard.model.reserved = reserve
        obtain(path, plan["identity"], guard, messages, settings, parse)
    unit = load(path)
    cache = load(directory / proof["file"] if proof else directory / f"meter/calls/{digest(body)}.json")
    if (
        unit["fingerprint"] != digest({k: body[k] for k in ("identity", "messages", "settings")})
        or cache["request"] != body
        or (cache.get("rejected") and not proof)
        or cache["resultDigest"] != digest(cache["result"])
        or cache["result"].get("finish_reason") not in (None, "stop")
        or parse(cache["result"]["text"]) != unit["value"]
        or digest(unit["value"]) != unit["valueDigest"]
    ):
        raise ValueError("unit-not-backed-by-model-cache")
    return unit["value"]
