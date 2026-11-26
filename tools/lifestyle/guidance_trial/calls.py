"""复用现有真实模型桥与账本；总额度、缓存、有限过载重试。"""

from functools import partial

from fedagent_sdk import ModelError

from ..common import digest, load, save
from ..diet_transport import CompletedUpstreamError, DietCachedModel
from ..full.federation.budget import ledger
from ..model import InvalidReply
from .compat import accepted


class Calls:
    def __init__(self, directory, plan, link):
        self.directory, self.plan, self.models = directory, plan, {}
        self.factory = partial(DietCachedModel, link=link)
        self.identity = plan["identity"]
        self.name = self.identity["model"]
        for name in plan["namespaces"]:
            values = ledger(directory / name, self.identity)
            if any(
                r["status"] == "error"
                and "usage" not in r
                and not r.get("completedUpstreamError")
                for r in values
            ):
                raise ValueError("unknown-dispatch-result-requires-investigation")

    def spent(self):
        return sum(len(load(p)) for p in self.directory.glob("meter-*/attempts.json"))

    def one(self, namespace, relative, messages, settings, parse):
        if isinstance(messages, str):
            messages = [{"role": "user", "content": messages}]
        if namespace not in self.plan["namespaces"]:
            raise ValueError("unknown-model-namespace")
        body = {
            "ref": self.plan["modelRef"],
            "identity": self.identity,
            "messages": messages,
            "settings": settings,
        }
        recovered = accepted(self.directory, relative, body, parse)
        if recovered is not None:
            return recovered
        if namespace not in self.models:
            cap = (
                self.plan["evaluationCap"]
                if namespace == "meter-evaluation"
                else self.plan["batchCap"]
            )
            model = self.factory(
                self.directory / namespace,
                self.plan["modelRef"],
                cap,
                ceiling=850,
                context_cap=self.plan["contextCap"],
            )
            if model.identity != self.identity:
                raise ValueError("model-identity-changed")
            self.models[namespace] = model
        model = self.models[namespace]
        # Successful units can be re-read at a spent cap without dispatching again.
        target = self.directory / relative
        if target.exists() and "value" in load(target):
            unit = load(target)
            body = {
                "ref": self.plan["modelRef"],
                "identity": self.identity,
                "messages": messages,
                "settings": settings,
            }
            cache = load(model.directory / f"calls/{digest(body)}.json")
            if (
                cache["request"] != body
                or cache.get("rejected")
                or cache.get("resultDigest") != digest(cache["result"])
                or unit.get("valueDigest") != digest(unit["value"])
                or parse(cache["result"]["text"]) != unit["value"]
                or unit.get("fingerprint")
                != digest(
                    {
                        "identity": self.plan["fingerprint"],
                        "messages": messages,
                        "settings": settings,
                    }
                )
            ):
                raise ValueError("unit-cache-mismatch")
            return unit["value"]
        fingerprint = digest(
            {
                "identity": self.plan["fingerprint"],
                "messages": messages,
                "settings": settings,
            }
        )
        unit = (
            load(target)
            if target.exists()
            else {"fingerprint": fingerprint, "failures": [], "overloads": 0}
        )
        if unit.get("fingerprint") != fingerprint:
            raise ValueError("unit-request-changed")
        while True:
            if (
                unit["overloads"] >= 6
                or len(unit["failures"]) >= 2
                or self.spent() >= self.plan["globalCallCap"]
            ):
                raise ValueError("bounded-retry-or-global-budget-exhausted")
            spent_elsewhere = self.spent() - len(
                load(model.directory / "attempts.json")
                if (model.directory / "attempts.json").exists()
                else []
            )
            model.limit = min(
                self.plan["evaluationCap"]
                if namespace == "meter-evaluation"
                else self.plan["batchCap"],
                self.plan["globalCallCap"] - spent_elsewhere,
            )
            model.reserved = 0
            try:
                reply = model.chat(messages, **settings)
            except CompletedUpstreamError as error:
                if not error.overloaded:
                    raise
                unit["overloads"] += 1
                save(target, unit)
                continue
            except InvalidReply:
                model.reject_last()
                unit["failures"].append("empty-or-truncated")
                save(target, unit)
                continue
            except ModelError:
                raise  # Unknown results never trigger a blind re-send.
            try:
                value = parse(reply.text)
            except (ValueError, TypeError, KeyError, AttributeError) as error:
                model.reject_last()
                unit["failures"].append(str(error))
                save(target, unit)
                continue
            unit.update(value=value, valueDigest=digest(value))
            save(target, unit)
            return value
