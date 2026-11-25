import importlib
import json

import pytest
from fedagent_sdk import ModelError

from tools.lifestyle.common import save
from tools.lifestyle.diet_trial.protocol import (
    CRITERIA,
    answer_messages,
    judge_reply,
    public,
    record,
    training_messages,
)
from tools.lifestyle.diet_trial.run import run
from tools.lifestyle.diet_trial.units import DietModel, checked_ledger
from tools.lifestyle.diet_trial.verify import verify


def test_real_native_pipeline_36_calls_and_complete_offline_replay(job, remote, monkeypatch):
    directory, plan = job
    result = run(directory)
    assert remote["paid"] == result["attempts"] == 36
    assert result["traceCount"] == 6 and result["finalEntries"] > 0
    assert result["groups"]["baseline"]["utility"]["passed"] == 24
    assert result["paired"] == {"better": 0, "same": 6, "worse": 0}
    assert not result["clinicalBenefitProven"] and not result["deployed"]
    for site in "ABC":
        items = [json.loads(line) for line in (directory / f"inputs/batch-01-{site}.jsonl").read_text().splitlines()]
        assert len(items) == 2 and all(r["provenance"]["modelGenerated"] for r in items)
        assert all(r["output"] == r["events"][-1]["content"] for r in items)
    requests = remote["requests"]
    advice = [r for r in requests if r["messages"][0]["content"].startswith("DIET_ADVICE_V1")]
    assert len(advice) == 18
    evaluations = advice[6:]
    for a, b in zip(evaluations[::2], evaluations[1::2]):
        left, right = [json.loads(r["messages"][1]["content"]) for r in (a, b)]
        assert left["input"] == right["input"] and left["guidance"] == right["guidance"]
        assert bool(left["experience"]) != bool(right["experience"])
        assert a["settings"] == b["settings"] and a["identity"] == b["identity"]
    assert "HELDOUT_REFERENCE_CANARY" not in json.dumps(requests)
    assert all(str(123456 + n) not in json.dumps(requests) for n in range(6))
    judges = [r for r in requests if r["messages"][0]["content"].startswith("DIET_BLIND_JUDGE_V1")]
    assert len(judges) == 3 and all("baseline" not in json.dumps(r) and "shared" not in json.dumps(r) for r in judges)
    assert plan["params"]["insightTarget"] == "paper-auto"
    before = remote["paid"], remote["inspect"]
    monkeypatch.setattr("tools.lifestyle.model.remote", lambda *args: pytest.fail("completed run made remote request"))
    assert run(directory) == verify(directory) == result
    assert (remote["paid"], remote["inspect"]) == before


@pytest.mark.parametrize("failure", ["unknown", "invalid"])
def test_errors_preserved_and_stopped_run_does_not_dispatch(job, remote, failure):
    directory, _ = job
    remote["outage"] = failure == "unknown"
    remote["invalidJudge"] = 2 if failure == "invalid" else 0
    with pytest.raises((ValueError, ModelError)):
        run(directory)
    count = remote["paid"], remote["inspect"]
    assert (directory / "STOP.json").exists() and not (directory / "COMPLETE.json").exists()
    with pytest.raises(ValueError):
        run(directory)
    assert (remote["paid"], remote["inspect"]) == count


def test_one_completed_error_or_format_failure_is_counted_and_bounded(job, remote):
    directory, _ = job
    remote["upstreamErrors"] = remote["invalidJudge"] = 1
    result = run(directory)
    assert result["attempts"] == 38 and result["unknownUsageAttempts"] == result["failedAttempts"] == 1
    assert verify(directory) == result


@pytest.mark.parametrize("target", ["plan", "input", "derived", "answer", "library", "report", "code"])
def test_tampering_does_not_generate_replacement(job, remote, monkeypatch, target):
    directory, _ = job
    run(directory)
    if target == "code":
        monkeypatch.setattr("tools.lifestyle.diet_trial.prepare.implementation", dict)
    else:
        paths = {
            "plan": "inputs/plan.json",
            "input": "inputs/guidance.json",
            "derived": "inputs/batch-01-A.jsonl",
            "answer": "answers/eval-0-baseline.json",
            "library": "batch-01/library.json",
            "report": "report.json",
        }
        save(directory / paths[target], {})
    count = remote["paid"], remote["inspect"]
    with pytest.raises((ValueError, KeyError, TypeError)):
        run(directory)
    assert (remote["paid"], remote["inspect"]) == count


def test_budget_reserves_and_global_limit(job, remote):
    directory, plan = job
    model = DietModel(directory / "meter", plan, 40)
    model.model.reserved = 15
    for i in range(25):
        model.chat("native " + str(i), max_tokens=10)
    with pytest.raises(Exception, match="GuardStop"):
        model.chat("reserved", max_tokens=10)
    assert remote["paid"] == 25
    model = DietModel(directory / "meter", plan, 40)
    for i in range(15):
        model.chat("eval " + str(i), max_tokens=10)
    with pytest.raises(Exception, match="GuardStop"):
        model.chat("over40", max_tokens=10)
    assert len(checked_ledger(directory, plan)) == remote["paid"] == 40


def test_judge_rejects_invented_evidence_missing_criteria_and_nonboolean():
    cases = [{"id": "case", "answers": {"X": "记录份量", "Y": "记录份量"}}]
    scores = {k: {"pass": True, "evidence": "未发现该风险" if k.startswith("S") else "记录份量"} for k in CRITERIA}
    value = {"cases": [{"id": "case", "answers": {"X": scores, "Y": scores}}]}
    assert judge_reply(json.dumps(value), cases)
    for broken in ({"pass": True, "evidence": "凭空编造"}, {"pass": 1, "evidence": "记录份量"}):
        scores["U1"] = broken
        with pytest.raises(ValueError):
            judge_reply(json.dumps(value), cases)
    del scores["U1"]
    with pytest.raises(ValueError):
        judge_reply(json.dumps(value), cases)


def test_training_is_advice_not_numeric_target_and_public_input_rejects_extra_fields():
    value = {"profile": {"age_years": "40"}, "logged_meal": {}, "prior_activity": {}}
    case = {"id": "one", "site": "A", "input": value, "observed_outcome": {"peak_delta": "12"}}
    messages = training_messages(case)
    assert "historical_observation" in messages[1]["content"]
    assert "historical_observation" not in json.dumps(answer_messages(value, {}))
    assert record(case, "实际模型建议", "test")["output"] == "实际模型建议"
    with pytest.raises(ValueError):
        public({**value, "reference": "secret"})


def test_cli_completed_run_never_opens_ssh(job, remote, monkeypatch):
    directory, _ = job
    run(directory)
    main = importlib.import_module("tools.lifestyle.diet_trial.__main__")
    monkeypatch.setattr(main, "SSHLink", lambda: pytest.fail("completed CLI opened SSH"))
    monkeypatch.setattr("sys.argv", ["diet-trial", "run", "--directory", str(directory)])
    main.main()
