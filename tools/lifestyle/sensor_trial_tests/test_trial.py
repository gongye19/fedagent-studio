import json
import sqlite3

import pytest

from tools.lifestyle.batch.calls import UnitExhausted, obtain
from tools.lifestyle.common import digest, load, save
from tools.lifestyle.sensor_trial.adapter import (
    TARGET,
    messages,
    prediction,
    public_input,
)
from tools.lifestyle.sensor_trial.retrieval import retrieve
from tools.lifestyle.sensor_trial.run import TrialModel, checked_ledger, run
from tools.lifestyle.sensor_trial.verify import verify


def test_real_platform_original_fot_27_calls_and_offline_reentry(job, remote):
    directory, _, plan = job
    result = run(directory)
    assert result["attempts"] == remote["paid"] == 27
    assert result["federationAttempts"] == 15
    assert result["learningCases"] == result["evaluationCases"] == 6
    assert all(u["processedItems"] == u["reflectedItems"] == u["extractedUnits"] == 2 for u in result["sourceUsage"].values())
    assert result["scores"]["baseline"]["complete"] and result["scores"]["shared"]["coverage"] == "1"
    assert result["maeDeltaSharedMinusBaseline"] == "0"
    assert not result["recommendationEffectProven"] and not result["deployed"]
    before = dict(remote)
    assert run(directory) == verify(directory) == result
    assert remote == before  # 完成重入连inspect都不调用。
    eval_requests = [r for r in remote["requests"] if r["messages"][0]["content"].startswith("CG_OBSERVATION_V1")]
    assert len(eval_requests) == 12
    for i in range(0, 12, 2):
        left, right = eval_requests[i : i + 2]
        a, b = (json.loads(r["messages"][1]["content"]) for r in (left, right))
        assert a["input"] == b["input"] and bool(a["experience"]) != bool(b["experience"])
        assert left["settings"] == right["settings"] and left["identity"] == right["identity"]
        assert bool(a["experience"]) == bool((i // 2) % 2)
    all_requests = json.dumps(remote["requests"])
    assert "HELDOUT_REFERENCE_CANARY" not in all_requests
    assert all(str(123456 + n) not in all_requests for n in range(6))
    for site in "ABC":
        records = [json.loads(r) for r in (directory / f"inputs/batch-01-{site}.jsonl").read_text().splitlines()]
        assert all(r["provenance"]["modelGenerated"] is False and r["provenance"]["agentDialogue"] is False for r in records)
    assert plan["implementation"]["plugin"] == load(directory / "inputs/plan.json")["implementation"]["plugin"]


@pytest.mark.parametrize("mode", ["invalid", "truncated"])
def test_one_format_failure_is_paid_then_success_and_cache_replayed(job, remote, mode):
    remote[mode] = 1
    directory = job[0]
    result = run(directory)
    assert result["attempts"] == remote["paid"] == 28
    assert sum(len(load(p)["failures"]) for p in (directory / "answers").glob("*.json") if "-receipt" not in p.name) == 1
    assert verify(directory) == result


def test_two_invalid_answers_terminal_unit_no_more_paid_requests(job, remote):
    remote["invalid"] = 2
    directory = job[0]
    with pytest.raises(UnitExhausted):
        run(directory)
    assert remote["paid"] == 17
    with pytest.raises(UnitExhausted):
        run(directory)
    assert remote["paid"] == 17
    assert not (directory / "COMPLETE.json").exists()


def test_network_failure_blocks_job_before_next_identity_inspect(job, remote):
    directory = job[0]
    remote["outage"] = True
    with pytest.raises(ValueError, match="probe"):
        run(directory)
    count = remote["paid"], remote["inspect"]
    with pytest.raises(ValueError, match="unknown-cost"):
        run(directory)
    assert (remote["paid"], remote["inspect"]) == count


def test_unresolved_started_attempt_blocks_any_dispatch(job, remote):
    directory, _, plan = job
    save(directory / "meter/model.json", plan["identity"])
    save(directory / "meter/attempts.json", [{"ordinal": 1, "status": "started", "requestHash": "a" * 64}])
    with pytest.raises(ValueError, match="unconfirmed-dispatch"):
        run(directory)
    assert remote["paid"] == remote["inspect"] == 0


def test_single_ledger_stage_reserve_and_global_cap(job, remote):
    directory, _, plan = job
    guard = TrialModel(directory / "meter", plan, 40)
    guard.model.reserved = 12
    for i in range(28):
        guard.chat("test request " + str(i), max_tokens=10)
    with pytest.raises(Exception, match="GuardStop"):
        guard.chat("blocked new request", max_tokens=10)
    assert len(checked_ledger(directory, plan)) == remote["paid"] == 28
    guard = TrialModel(directory / "meter", plan, 40)
    for i in range(12):
        guard.chat("eval request " + str(i), max_tokens=10)
    with pytest.raises(Exception, match="GuardStop"):
        guard.chat("over40", max_tokens=10)
    assert len(checked_ledger(directory, plan)) == remote["paid"] == 40


@pytest.mark.parametrize("reason", ["stopped", "context"])
def test_guard_rejection_does_not_spend_unit_attempt_from_stale_dispatch(job, remote, reason):
    directory, _, plan = job
    guard = TrialModel(directory / "meter", plan, 40)
    guard.chat("previous real dispatch", max_tokens=10)
    assert guard.was_dispatched()
    if reason == "stopped":
        guard.stopped.set()
    prompt = [{"role": "user", "content": "x" * (70000 if reason == "context" else 1)}]
    unit = directory / "unsent-unit.json"
    with pytest.raises(Exception, match="GuardStop"):
        obtain(unit, plan["identity"], guard, prompt, {"max_tokens": 10}, prediction)
    assert not guard.was_dispatched() and not unit.exists()
    assert len(checked_ledger(directory, plan)) == remote["paid"] == 1
    if reason == "context":
        assert not guard.root_error["dispatched"]


@pytest.mark.parametrize("target", ["source", "inputs", "code", "plan"])
def test_drift_blocked_before_inspect_or_paid(job, remote, monkeypatch, target):
    directory, source, _ = job
    if target == "code":
        monkeypatch.setattr("tools.lifestyle.sensor_trial.prepare.implementation", dict)
    else:
        path = (
            source / "ATTRIBUTION.txt"
            if target == "source"
            else directory / ("inputs/evaluation.jsonl" if target == "inputs" else "inputs/plan.json")
        )
        path.write_text(path.read_text() + " ")
        if target == "plan":
            plan = load(path)
            plan["globalCallCap"] = 41
            save(path, plan)
    with pytest.raises(ValueError):
        run(directory)
    assert remote["paid"] == remote["inspect"] == 0


@pytest.mark.parametrize("target", ["unit", "cache", "receipt", "app", "library", "report"])
def test_completed_verify_rejects_tampered_results_without_dispatch(job, remote, target):
    directory = job[0]
    run(directory)
    first = min((directory / "answers").glob("*-baseline.json"))
    if target == "app":
        with sqlite3.connect(directory / "platform/fedagent.db") as db:
            db.execute("UPDATE apps SET content='{}'")
    else:
        path = {
            "unit": first,
            "cache": min((directory / "meter/calls").glob("*.json")),
            "receipt": first.with_name(first.stem + "-receipt.json"),
            "library": directory / "batch-01/library.json",
            "report": directory / "report.json",
        }[target]
        value = load(path)
        if target == "unit":
            value["value"][TARGET] = "123"
            value["valueDigest"] = digest(value["value"])
        else:
            value["tampered"] = True
            if target == "cache":
                value["result"]["text"] = "tampered"
        save(path, value)
    before = remote["paid"], remote["inspect"]
    with pytest.raises(ValueError):
        verify(directory)
    assert (remote["paid"], remote["inspect"]) == before


def test_retrieval_input_only_bounded_whole_entries_and_fallback():
    value = {"logged_meal": {"type": "breakfast"}, "profile": {"age_years": "30"}}
    library = {"a": "breakfast " + "x" * 12001, "b": "breakfast meal", **{str(i): "generic advice" for i in range(8)}, "z": "x" * 12001}
    selected, audit = retrieve(value, library)
    assert len(selected) == 4 and selected["b"] == library["b"] and "a" not in selected and audit["skipped"]
    assert sum(len(k) + len(v) for k, v in selected.items()) <= 12000
    assert [r["id"] for r in audit["skipped"]] == ["a"]
    assert retrieve(value, library) == (selected, audit)
    assert retrieve({}, {"only": "plain"})[1]["mode"] == "generic-fallback"
    with pytest.raises(ValueError, match="no-complete-experience"):
        retrieve(value, {"huge": "x" * 12001})


@pytest.mark.parametrize("value", [True, -1, "NaN", float("nan"), float("inf"), 1e100, None, "123"])
def test_invalid_numeric_predictions_rejected(value):
    with pytest.raises(ValueError):
        prediction(json.dumps({TARGET: value, "explanation": "reason"}))


def test_public_input_and_reference_not_conflated():
    public = {"profile": {}, "logged_meal": {}, "prior_activity": {}}
    assert TARGET not in public_input(public)["profile"]
    assert "experience" in json.loads(messages(public, {})[1]["content"])
    with pytest.raises(ValueError):
        public_input({**public, "observed_outcome": {TARGET: 1}})
