"""每个生成／回答／评分单元的持久化有限尝试及结果校验。"""

from fedagent_sdk import ModelError

from ..common import digest, load, save
from ..model import InvalidReply


class UnitExhausted(ValueError):
    """本单元两次失败已用完，续跑也不能再次计费。"""


def obtain(path, identity, model, messages, settings, parse):
    fingerprint = digest({"identity": identity, "messages": messages, "settings": settings})
    unit = load(path) if path.exists() else {"fingerprint": fingerprint, "failures": []}
    if unit.get("fingerprint") != fingerprint or not isinstance(unit.get("failures"), list) or len(unit["failures"]) > 2:
        raise ValueError("unit-checkpoint-changed")
    if "value" in unit:
        if digest(unit["value"]) != unit.get("valueDigest"):
            raise ValueError("unit-checkpoint-corrupted")
        return unit["value"]
    while len(unit["failures"]) < 2:
        try:
            reply = model.chat(messages, **settings)
            if not reply.text.strip() or reply.finish_reason not in (None, "stop"):
                raise InvalidReply("completed reply empty or truncated")
        except ModelError as error:
            if isinstance(error, InvalidReply) or getattr(model, "was_dispatched", lambda: False)():
                unit["failures"].append(type(error).__name__)
                save(path, unit)
            if isinstance(error, InvalidReply):
                model.reject_last()
                continue
            if len(unit["failures"]) >= 2:
                raise UnitExhausted("unit-two-failed-dispatches-exhausted") from error
            raise
        try:
            value = parse(reply.text)
        except (ValueError, TypeError, AttributeError):
            model.reject_last()
            unit["failures"].append("InvalidFormat")
            save(path, unit)
            continue
        unit.update({"value": value, "valueDigest": digest(value)})
        save(path, unit)
        return value
    raise UnitExhausted("unit-two-failed-attempts-exhausted; no further dispatch")
