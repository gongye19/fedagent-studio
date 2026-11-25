"""受凭据约束的说明格式兼容；旧计划、账本、拒绝缓存与布尔分值全部保留。"""

import hashlib
import json

from ..common import digest, load

FOLDER = "verification/format-compat-01"
ALLOWED = {f"tools/lifestyle/diet_eval/{name}.py" for name in ("protocol", "prepare", "meter", "compat")}


def check_implementation(directory, plan, current):
    original = plan["implementation"]
    receipt_path = directory / FOLDER / "receipt.json"
    if original == current and not receipt_path.exists():
        return
    receipt = load(receipt_path) if receipt_path.exists() else {}
    before = load(directory / FOLDER / "before.json") if receipt else {}
    old_files, new_files = original.get("files", {}), current.get("files", {})
    changes = {key for key in old_files.keys() | new_files.keys() if old_files.get(key) != new_files.get(key)}
    if (
        receipt.get("kind") != "structured-difference-format-only/1"
        or receipt.get("planFingerprint") != plan["fingerprint"]
        or receipt.get("implementation") != current
        or receipt.get("beforeDigest") != digest(before)
        or before.get("planFingerprint") != plan["fingerprint"]
        or before.get("implementation") != original
        or {k: v for k, v in original.items() if k != "files"} != {k: v for k, v in current.items() if k != "files"}
        or not changes <= ALLOWED
    ):
        raise ValueError("frozen-code-or-plan-changed")
    for namespace, prefix in before["ledgers"].items():
        path = directory / ("meter-" + namespace) / "attempts.json"
        actual = load(path) if path.exists() else []
        if actual[: len(prefix)] != prefix:
            raise ValueError("format-compat-ledger-prefix-changed")
    if any(hashlib.sha256((directory / name).read_bytes()).hexdigest() != sha for name, sha in before["protected"].items()):
        raise ValueError("format-compat-existing-response-or-input-changed")
    if digest(load(directory / FOLDER / "original-unit.json")) != before["originalUnitDigest"]:
        raise ValueError("format-compat-original-unit-changed")


def accepted_cache(directory, relative, default):
    """只选择凭据绑定的最早完整响应；不反转原缓存的rejected标记。"""
    receipt_path = directory / FOLDER / "receipt.json"
    if not receipt_path.exists():
        return default, False
    receipt = load(receipt_path)
    entry = receipt.get("acceptedUnits", {}).get(relative)
    if entry is None:
        return default, False
    before = load(directory / FOLDER / "before.json")
    if relative != before["unit"] or receipt["beforeDigest"] != digest(before):
        raise ValueError("format-compat-unit-not-authorized")
    source = entry["source"]
    if source not in before["protected"]:
        raise ValueError("format-compat-source-not-preserved")
    cache = load(directory / source)
    raw = load_json_rules(cache["result"]["text"])
    flags = {label: raw[label]["rules"] for label in ("X", "Y")}
    attempts = [r for r in before["ledgers"][entry["namespace"]] if r["requestHash"] == entry["requestHash"] and r["status"] == "ok"]
    if (
        digest(cache) != entry["sourceDigest"]
        or digest(flags) != entry["ruleFlagsDigest"]
        or digest(cache["request"]) != entry["requestHash"]
        or cache["result"].get("finish_reason") not in (None, "stop")
        or not attempts
        or entry["responseOrdinal"] != min(r["ordinal"] for r in attempts)
    ):
        raise ValueError("format-compat-original-response-changed")
    return cache, True


def load_json_rules(text):
    clean = text.strip()
    if clean.startswith("```json\n") and clean.endswith("\n```"):
        clean = clean[8:-4]
    return json.loads(clean)
