import json

import pytest
from fedagent_sdk import ModelError

from tools.lifestyle.common import load, save
from tools.lifestyle.diet_eval.audit import numeric_features, retrieve
from tools.lifestyle.diet_eval.meter import Calls, ledgers
from tools.lifestyle.diet_eval.protocol import (
    assessed,
    compare,
    dimension_scores,
    parse_judge,
)
from tools.lifestyle.diet_eval.report import verify
from tools.lifestyle.diet_eval.run import run


def test_full_two_arm_run_independent_repeats_and_completed_offline_reentry(job, remote, monkeypatch):
    directory, _ = job
    result = run(directory)
    assert result["attempts"] == remote["paid"] == 25
    assert result["primary"]["cases"] == 6 and result["repeat"]["cases"] == 2
    assert result["primary"]["comparison"] == {"better": 6}
    assert all(v["sameDirection"] for v in result["stability"])
    assert not result["deployed"] and not result["clinicalBenefitProven"]
    answers = [r for r in remote["requests"] if r["messages"][0]["content"].startswith("You are a lifestyle")]
    assert len(answers) == 16
    for left, right in zip(answers[::2], answers[1::2]):
        assert left["messages"][0] == right["messages"][0] and left["messages"][2:] == right["messages"][2:]
        assert left["settings"] == right["settings"] and left["identity"] == right["identity"]
        assert (left["messages"][1]["content"].endswith("{}")) != (right["messages"][1]["content"].endswith("{}"))
    # 相同重复请求确实再次派发，而非回放主试验缓存。
    assert any(answers[i] == answers[j] for i in range(12) for j in range(12, 16))
    judges = [r for r in remote["requests"] if r["messages"][0]["content"].startswith("Evaluate two anonymous")]
    assert len(judges) == 9
    for request in judges:
        body = json.loads(request["messages"][1]["content"])
        assert set(body) == {"conversation", "rules", "answers", "outputShape"}
        assert set(body["answers"]) == {"X", "Y"}
    assert (directory / "comparison.html").exists()
    before = remote["paid"], remote["inspect"]
    monkeypatch.setattr("tools.lifestyle.model.remote", lambda *a: pytest.fail("complete run contacted remote"))
    assert run(directory) == verify(directory) == result
    assert (remote["paid"], remote["inspect"]) == before


def test_input_condition_matching_uses_numeric_values_and_never_pads(job):
    directory, _ = job
    lib = load(directory / "inputs/library.json")
    assert retrieve({}, lib)[0] == {}
    features = numeric_features({"profile": {"fasting_glucose_mg_dl": "135"}, "logged_meal": {"nutrition_estimates": {"fiber_g": "0"}}})
    chosen, audit = retrieve(features, lib)
    assert set(chosen) == {"insight_confirmatoryThresholdEscalation", "insight_gapBasedNextAction"}
    assert not audit["zeroScorePadding"]
    healthy = numeric_features({"profile": {"fasting_glucose_mg_dl": "99"}, "logged_meal": {"nutrition_estimates": {"fiber_g": "5"}}})
    assert retrieve(healthy, lib)[0] == {}
    assert numeric_features({"profile": {"fasting_glucose_mg_dl": True}})["screening_review"] is False
    assert len({tuple(v["id"] for v in item["selected"]) for item in load(directory / "inputs/retrieval.json").values()}) >= 3


def test_negative_rules_and_critical_risks_cannot_be_averaged_away():
    ref = {
        "dimensions": {
            k: {"pos": ["p"], "neg": ["n"] if k == "decision" else []} for k in ("decision", "personalization", "actionability", "evidence")
        },
        "critical": ["n"],
        "originalRubrics": {"p": {"points": 5}, "n": {"points": -10}},
        "rules": {"p": "positive", "n": "dangerous negative"},
    }
    assert dimension_scores(ref, {"p": True, "n": True})["decision"] == 0
    item = {"rules": {"p": True, "n": True}, "coreRecommendations": ["unsafe"], "reason": "r"}
    unsafe = assessed(ref, item)
    safe = {**unsafe, "acceptable": True, "total": 1, "criticalRisks": []}
    assert unsafe["total"] > safe["total"] and compare(unsafe, safe) == "better"
    assert compare(unsafe, unsafe) == "both_unacceptable"


@pytest.mark.parametrize("kind", ["badCalibration", "unknown", "invalid"])
def test_preflight_failure_is_terminal_and_never_generates_test_answers(job, remote, kind):
    directory, _ = job
    remote[kind] = 2 if kind == "invalid" else True
    with pytest.raises((ValueError, ModelError)):
        run(directory)
    assert not (directory / "answers").exists() and (directory / "STOP.json").exists()
    before = remote["paid"], remote["inspect"]
    with pytest.raises(ValueError):
        run(directory)
    assert (remote["paid"], remote["inspect"]) == before


def test_known_overload_and_one_format_retry_are_counted(job, remote):
    directory, _ = job
    remote["overloads"] = 2
    remote["invalid"] = 1
    result = run(directory)
    assert result["attempts"] == 28 and result["failedDispatches"] == 2 and result["unknownUsageDispatches"] == 2


def test_six_overloads_do_not_turn_into_unbounded_retries(job, remote):
    remote["overloads"] = 10
    with pytest.raises(ValueError, match="bounded"):
        run(job[0])
    assert remote["paid"] == 6


def test_global_budget_includes_both_namespaces(job, remote):
    directory, plan = job
    calls = Calls(directory, plan)
    for i in range(48):
        namespace = "primary" if i < 27 else "repeat"
        calls.one(namespace, f"budget/{i}.json", [{"role": "user", "content": f"budget request {i}"}], {"max_tokens": 10}, str, reserved=0)
    with pytest.raises(ModelError):
        calls.one("repeat", "budget/over.json", [{"role": "user", "content": "new over budget"}], {"max_tokens": 10}, str, reserved=0)
    assert sum(map(len, ledgers(directory, plan).values())) == remote["paid"] == 48


@pytest.mark.parametrize("target", ["plan", "source", "references", "library", "unit", "cache", "report", "code"])
def test_tampering_never_triggers_replacement_dispatch(job, remote, monkeypatch, target):
    directory, plan = job
    run(directory)
    if target == "code":
        monkeypatch.setattr("tools.lifestyle.diet_eval.prepare.implementation", dict)
    else:
        paths = {
            "plan": directory / "inputs/plan.json",
            "source": next(iter(plan["sourceFiles"])),
            "references": directory / "inputs/references.jsonl",
            "library": directory / "inputs/library.json",
            "unit": directory / "units/calibration.json",
            "cache": next((directory / "meter-primary/calls").glob("*.json")),
            "report": directory / "report.json",
        }
        path = paths[target]
        if target == "source":
            from tools.lifestyle.diet_eval import prepare

            path = prepare.ROOT / path
        save(path, {})
    before = remote["paid"], remote["inspect"]
    with pytest.raises((ValueError, KeyError, TypeError, AttributeError)):
        run(directory)
    assert (remote["paid"], remote["inspect"]) == before


def test_rule_parser_rejects_missing_flags_nonbooleans_or_fabricated_rule_ids():
    ref = {"rules": {"r0": "one"}}
    value = {
        "X": {"rules": {"r0": True}, "coreRecommendations": ["one"], "reason": "reason"},
        "Y": {"rules": {"r0": False}, "coreRecommendations": ["two"], "reason": "reason"},
        "differences": [],
    }
    assert parse_judge(json.dumps(value), ref)
    for broken in ({"r0": 1}, {}, {"r0": True, "r1": False}):
        value["X"]["rules"] = broken
        with pytest.raises(ValueError):
            parse_judge(json.dumps(value), ref)
