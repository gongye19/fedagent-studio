"""一次性卡片命名兼容；旧计划、三个调用、拒绝响应与停止记录原样保留。"""

from ..common import digest, load

ALLOWED = {
    "tools/lifestyle/guidance_trial/" + n + ".py"
    for n in ("protocol", "prepare", "calls", "__main__", "compat")
}


def validate_compat(directory, plan, current):
    path = directory / "compatibility.json"
    if current == plan["implementation"] and not path.exists():
        return None
    receipt = load(path) if path.exists() else {}
    original = plan["implementation"]
    changes = {
        p for p in original.keys() | current.keys() if original.get(p) != current.get(p)
    }
    if (
        receipt.get("kind") != "card-name-format-only/1"
        or receipt.get("planFingerprint") != plan["fingerprint"]
        or receipt.get("implementation") != current
        or not changes <= ALLOWED
        or digest({k: v for k, v in receipt.items() if k != "digest"})
        != receipt.get("digest")
    ):
        raise ValueError("unapproved-code-or-plan-change")
    for name, expected in receipt["protected"].items():
        if digest(load(directory / name)) != expected:
            raise ValueError("original-format-stop-data-changed")
    for namespace, prefix in receipt["ledgerPrefixes"].items():
        if load(directory / namespace / "attempts.json")[: len(prefix)] != prefix:
            raise ValueError("original-paid-ledger-prefix-changed")
    return receipt


def accepted(directory, relative, body, parse):
    path = directory / "compatibility.json"
    if not path.exists():
        return None
    receipt = load(path)
    proof = receipt.get("accepted", {}).get(relative)
    if proof is None:
        return None
    cache = load(directory / proof["cache"])
    if (
        receipt["protected"].get(proof["cache"]) != digest(cache)
        or cache["request"] != body
        or cache["resultDigest"] != digest(cache["result"])
        or cache["result"].get("finish_reason") not in (None, "stop")
    ):
        raise ValueError("accepted-response-not-original")
    value = parse(cache["result"]["text"])
    if digest(value) != proof["valueDigest"]:
        raise ValueError("accepted-content-changed")
    return value
