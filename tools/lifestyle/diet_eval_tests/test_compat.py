import copy
import importlib
import json

import pytest

from tools.lifestyle.common import digest, load, rows, save
from tools.lifestyle.diet_eval import prepare as preparation
from tools.lifestyle.diet_eval.compat import FOLDER
from tools.lifestyle.diet_eval.protocol import parse_judge
from tools.lifestyle.diet_eval.run import run


@pytest.mark.parametrize(
    "entry",
    [
        {"X": "one", "Y": "two", "significance": "different"},
        {"answerX": "one", "answerY": "two", "difference": "different"},
    ],
)
def test_structured_difference_only_changes_explanation_representation(entry):
    item = {"rules": {"r0": True, "r1": False}, "coreRecommendations": ["concrete"], "reason": "reason"}
    value = {"X": item, "Y": copy.deepcopy(item), "differences": [entry]}
    parsed = parse_judge(json.dumps(value), {"rules": item["rules"]})
    assert parsed["X"] == parsed["Y"] == item
    assert parsed["differences"] == ["X: one; Y: two; Comparison: different"]
    for broken in ({**entry, "score": 10}, {k: 1 for k in entry}, {k: "x" * 601 for k in entry}):
        with pytest.raises(ValueError):
            parse_judge(json.dumps({**value, "differences": [broken]}), {"rules": item["rules"]})


def test_earliest_rejected_response_restored_offline_with_frozen_scores_and_budget(job, remote, monkeypatch):
    directory, plan = job
    runner = importlib.import_module("tools.lifestyle.diet_eval.run")
    remote["structuredCase"] = 1

    def old_parser(text, ref):
        if any(isinstance(v, dict) for v in json.loads(text)["differences"]):
            raise ValueError("old explanation schema rejected")
        return parse_judge(text, ref)

    monkeypatch.setattr(runner, "parse_judge", old_parser)
    with pytest.raises(ValueError, match="bounded"):
        run(directory)
    assert remote["paid"] == 20
    relative = "judging/primary/51ceb47f-fcd7-49f6-bd1c-45a1df4143df.json"
    original_unit = load(directory / relative)
    assert len(original_unit["failures"]) == 2
    prefix = {ns: load(directory / f"meter-{ns}/attempts.json") for ns in ("primary", "repeat")}
    source = next((directory / "meter-primary/rejected").glob("*.json"))
    cache = load(source)
    files = {
        str(p.relative_to(directory)): preparation.file_hash(p)
        for p in directory.rglob("*.json")
        if p.name not in {"attempts.json", "STOP.json"} and str(p.relative_to(directory)) != relative
    }
    before = {
        "planFingerprint": plan["fingerprint"],
        "implementation": plan["implementation"],
        "ledgers": prefix,
        "protected": files,
        "unit": relative,
        "originalUnitDigest": digest(original_unit),
    }
    save(directory / FOLDER / "before.json", before)
    save(directory / FOLDER / "original-unit.json", original_unit)
    current = {"files": {**plan["implementation"]["files"], "tools/lifestyle/diet_eval/protocol.py": "compat"}}
    raw = json.loads(cache["result"]["text"])
    accepted = {
        "source": str(source.relative_to(directory)),
        "sourceDigest": digest(cache),
        "requestHash": digest(cache["request"]),
        "ruleFlagsDigest": digest({label: raw[label]["rules"] for label in ("X", "Y")}),
        "namespace": "primary",
    }
    accepted["responseOrdinal"] = min(r["ordinal"] for r in prefix["primary"] if r["requestHash"] == accepted["requestHash"])
    receipt = {
        "kind": "structured-difference-format-only/1",
        "planFingerprint": plan["fingerprint"],
        "implementation": current,
        "beforeDigest": digest(before),
        "acceptedUnits": {relative: accepted},
    }
    save(directory / FOLDER / "receipt.json", receipt)
    ref = rows(directory / "inputs/references.jsonl")[1]
    value = parse_judge(cache["result"]["text"], ref)
    save(directory / relative, {**original_unit, "value": value, "valueDigest": digest(value)})
    (directory / "STOP.json").rename(directory / FOLDER / "STOP.json")
    monkeypatch.setattr(preparation, "implementation", lambda: current)
    monkeypatch.setattr(runner, "parse_judge", parse_judge)
    result = run(directory)
    assert result["attempts"] == remote["paid"] == 26  # 原20次保留，仅余6个评分，不重算已救回的评分。
    assert load(directory / "meter-primary/attempts.json")[: len(prefix["primary"])] == prefix["primary"]
    assert all(preparation.file_hash(directory / name) == sha for name, sha in files.items())
    assert load(source)["rejected"] is True
    assert load(directory / relative)["value"]["X"]["rules"] == raw["X"]["rules"]
    paid, inspected = remote["paid"], remote["inspect"]
    assert run(directory) == result and (remote["paid"], remote["inspect"]) == (paid, inspected)
    for key, replacement in (("responseOrdinal", 999), ("ruleFlagsDigest", "wrong"), ("source", "outside.json")):
        bad_receipt = copy.deepcopy(receipt)
        bad_receipt["acceptedUnits"][relative][key] = replacement
        save(directory / FOLDER / "receipt.json", bad_receipt)
        with pytest.raises((ValueError, KeyError)):
            run(directory)
        assert (remote["paid"], remote["inspect"]) == (paid, inspected)
    save(directory / FOLDER / "receipt.json", receipt)
    altered_source = copy.deepcopy(cache)
    altered_source["result"]["text"] += " "
    save(source, altered_source)
    with pytest.raises(ValueError):
        run(directory)
    save(source, cache)
    ledger_path = directory / "meter-primary/attempts.json"
    original_ledger = load(ledger_path)
    modified_ledger = copy.deepcopy(original_ledger)
    modified_ledger[0]["context"]["inputUtf8Bytes"] += 1
    save(ledger_path, modified_ledger)
    with pytest.raises(ValueError, match="ledger-prefix"):
        run(directory)
    save(ledger_path, original_ledger)
    bad = copy.deepcopy(current)
    bad["files"]["tools/lifestyle/diet_eval/audit.py"] = "changed matcher"
    monkeypatch.setattr(preparation, "implementation", lambda: bad)
    save(directory / FOLDER / "receipt.json", {**receipt, "implementation": bad})
    with pytest.raises(ValueError, match="frozen-code"):
        run(directory)
    assert remote["paid"] == paid
