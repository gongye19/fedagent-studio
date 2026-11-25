"""共用总预算、两次独立调用命名空间；未知结果停，明确过载才有界等待重试。"""

from functools import partial

from fedagent_sdk import ModelError

from ..common import digest, load, save
from ..diet_transport import CompletedUpstreamError, DietCachedModel
from ..full.federation.budget import ledger
from ..model import CachedModel, InvalidReply
from .compat import accepted_cache


def ledgers(directory, plan):
    result = {name: ledger(directory / ("meter-" + name), plan["identity"]) for name in plan["namespaces"]}
    if sum(map(len, result.values())) > plan["globalCallCap"]:
        raise ValueError("global-budget-exceeded")
    if any(
        r["status"] == "error" and "usage" not in r and not r.get("completedUpstreamError") for values in result.values() for r in values
    ):
        raise ValueError("unknown-cost-result-blocks-this-job")
    return result


class Calls:
    def __init__(self, directory, plan, link=None):
        self.directory, self.plan, self.models = directory, plan, {}
        self.factory = partial(DietCachedModel, link=link) if link is not None else CachedModel

    def one(self, namespace, relative, messages, settings, parse, *, reserved):
        values = ledgers(self.directory, self.plan)
        path = self.directory / relative
        body = {"ref": self.plan["modelRef"], "identity": self.plan["identity"], "messages": messages, "settings": settings}
        key = digest(body)
        fingerprint = digest({"namespace": namespace, "request": body})
        unit = load(path) if path.exists() else {"fingerprint": fingerprint, "failures": []}
        if unit["fingerprint"] != fingerprint:
            raise ValueError("unit-request-changed")
        if "value" in unit:
            return verify_unit(self.directory, self.plan, namespace, relative, messages, settings, parse)
        if namespace not in self.models:
            model = self.factory(
                self.directory / ("meter-" + namespace),
                self.plan["modelRef"],
                self.plan["globalCallCap"],
                ceiling=48,
                context_cap=self.plan["contextCap"],
            )
            if model.identity != self.plan["identity"]:
                raise ValueError("live-model-identity-changed")
            self.models[namespace] = model
        model = self.models[namespace]
        while True:
            values = ledgers(self.directory, self.plan)
            prior = [r for r in values[namespace] if r["requestHash"] == key]
            formats = sum(f["kind"] == "format" for f in unit["failures"])
            overloads = sum(f["kind"] == "overload" for f in unit["failures"])
            if formats >= 2 or overloads >= 6:
                raise ValueError("unit-bounded-attempts-exhausted")
            if prior and not unit["failures"]:
                # 解释器中断发生在账本落盘与单元保存之间时，不盲目补发。
                cache = self.directory / ("meter-" + namespace) / f"calls/{key}.json"
                if not cache.exists() or load(cache).get("rejected"):
                    raise ValueError("unacknowledged-unit-attempt-blocks-job")
            others = sum(len(v) for n, v in values.items() if n != namespace)
            model.limit = self.plan["globalCallCap"] - others
            model.reserved = reserved
            try:
                reply = model.chat(messages, **settings)
                if reply.finish_reason not in (None, "stop") or not reply.text.strip():
                    raise InvalidReply("empty-or-truncated-response")
            except CompletedUpstreamError as error:
                unit["failures"].append(
                    {"kind": "overload" if error.overloaded else "upstream", "ordinal": len(ledger(model.directory, self.plan["identity"]))}
                )
                save(path, unit)
                if error.overloaded:
                    continue  # DietLink在真正发出下一请求前共享45秒冷却。
                raise
            except InvalidReply:
                unit["failures"].append({"kind": "format", "ordinal": len(ledger(model.directory, self.plan["identity"]))})
                model.reject_last()
                save(path, unit)
                continue
            except ModelError:
                # 包含未知结果、额度不足、身份／上下文错误；不能吞掉重发。
                raise
            try:
                value = parse(reply.text)
            except (ValueError, TypeError, KeyError):
                model.reject_last()
                unit["failures"].append({"kind": "format", "ordinal": len(ledger(model.directory, self.plan["identity"]))})
                save(path, unit)
                continue
            unit.update(value=value, valueDigest=digest(value))
            save(path, unit)
            return verify_unit(self.directory, self.plan, namespace, relative, messages, settings, parse)


def verify_unit(directory, plan, namespace, relative, messages, settings, parse):
    body = {"ref": plan["modelRef"], "identity": plan["identity"], "messages": messages, "settings": settings}
    key = digest(body)
    unit = load(directory / relative)
    cache = load(directory / ("meter-" + namespace) / f"calls/{key}.json")
    cache, recovered = accepted_cache(directory, relative, cache)
    if (
        unit["fingerprint"] != digest({"namespace": namespace, "request": body})
        or cache["request"] != body
        or (cache.get("rejected") and not recovered)
        or cache["resultDigest"] != digest(cache["result"])
        or cache["result"].get("finish_reason") not in (None, "stop")
        or parse(cache["result"]["text"]) != unit["value"]
        or unit["valueDigest"] != digest(unit["value"])
    ):
        raise ValueError("unit-not-backed-by-valid-model-response")
    return unit["value"]
