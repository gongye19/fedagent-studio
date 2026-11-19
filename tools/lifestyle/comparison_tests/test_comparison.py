"""完整正常API来源+两组评测，模型替身，无真实付费请求。"""

import fcntl
import gc
import json
import sqlite3

import pytest
from fedagent_sdk import ModelError

from tools.lifestyle import model as bridge
from tools.lifestyle.common import digest, jsonl, load, save
from tools.lifestyle.full.comparison import prepare as preparation
from tools.lifestyle.full.comparison import source
from tools.lifestyle.full.comparison.__main__ import wait_prepare
from tools.lifestyle.full.comparison.checkpoints import verify_complete
from tools.lifestyle.full.comparison.run import run
from tools.lifestyle.full.federation.run import run as federate
from tools.lifestyle.full_tests.test_federation_run import IDENTITY, setup_plan
from tools.lifestyle.full_tests.test_federation_run import remote as remote


@pytest.fixture
def experiment(tmp_path, monkeypatch, remote):
    federation = tmp_path / "federation"
    plan = setup_plan(federation, batches=5)
    assert federate(federation, plan)["status"] == "complete"
    gc.collect()
    with sqlite3.connect(federation / "platform/fedagent.db") as db:
        db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    monkeypatch.setattr(source, "federation_prepare", lambda directory: plan)
    monkeypatch.setattr(source, "FEDERATION_FP", plan["fingerprint"])
    monkeypatch.setattr(preparation, "FEDERATION", federation)
    old = tmp_path / "old-inputs"
    ids = [f"healthbench:case-{i:02}" for i in range(24)]
    jsonl(
        old / "evaluation-inputs.jsonl",
        [{"id": key, "question": "饮食运动建议" + key, "messages": [{"role": "user", "content": "activity " + key}]} for key in ids],
    )
    jsonl(
        old / "evaluation-references.jsonl",
        [
            {"id": key, "rubrics": [{"points": 1, "criterion": f"criterion-{i}", "tags": []} for i in range(14 if index < 23 else 19)]}
            for index, key in enumerate(ids)
        ],
    )
    (old / "grader-source.py").write_text('GRADER_TEMPLATE = """GRADE\n<<conversation>>\n<<rubric_item>>""".strip()')
    (old / "LICENSE.simple-evals").write_text("test license")
    save(old / "prepared.json", {"evaluationIds": ids})
    manifest = {"outputs": {p.name: preparation.sha(p) for p in old.iterdir()}}
    manifest["manifestDigest"] = digest(manifest)
    save(old / "manifest.json", manifest)
    monkeypatch.setattr(preparation, "OLD", old)
    monkeypatch.setattr(preparation, "OLD_MANIFEST", manifest["manifestDigest"])
    monkeypatch.setattr(preparation, "implementation", lambda: {"fixture": True})
    original_load = preparation.load

    def configured(path):
        if path.name == "upstream.json":
            return {
                "sha256": preparation.sha(old / "grader-source.py"),
                "licenseSha256": preparation.sha(old / "LICENSE.simple-evals"),
                "templateDigest": digest("GRADE\n<<conversation>>\n<<rubric_item>>"),
            }
        return original_load(path)

    monkeypatch.setattr(preparation, "load", configured)
    net = {"paid": 0, "inspect": 0, "outage": False, "identity": dict(IDENTITY), "format": False, "requests": []}

    def fake(body):
        if body.get("inspect"):
            net["inspect"] += 1
            if net.get("inspectionOutage"):
                raise ModelError("unpaid inspection unavailable")
            return net["identity"]
        net["paid"] += 1
        net["requests"].append(body)
        if net["outage"]:
            net["outage"] = False
            raise ModelError("ended connection error")
        if body["messages"][0]["content"].startswith("LIFESTYLE_COMPARISON_V1"):
            collection = json.loads(body["messages"][0]["content"].splitlines()[-1])["experience"]
            text = body["messages"][-1]["content"] + (" with" if collection else " without")
        elif net["format"]:
            text = "bad format"
        else:
            text = '{"criteria_met": true, "explanation": "fixture"}'
        return {"text": text, "model": "test", "finish_reason": "stop", "usage": {"prompt_tokens": 10, "completion_tokens": 5}}

    monkeypatch.setattr(bridge, "remote", fake)
    return tmp_path / "comparison", federation, plan, net


def prepare_case(experiment):
    directory, _, _, _ = experiment
    return directory, preparation.prepare(directory)


def snapshot(directory):
    paths = [directory / "platform/fedagent.db", directory / "source-usage.json", *directory.glob("batch-*/state.json")]
    return {str(p): p.read_bytes() for p in paths}


def test_readonly_freeze_all_five_no_overwrite_and_normal_730_calls(experiment):
    directory, federation, _, net = experiment
    before = snapshot(federation)
    plan = preparation.prepare(directory)
    assert snapshot(federation) == before and net["paid"] == net["inspect"] == 0
    with (federation / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    collection = load(directory / "inputs/collection.json")
    assert len(collection) == sum(v["entries"] for v in plan["origins"])
    assert {key.split("::")[0] for key in collection} == {f"batch-{i:02}" for i in range(1, 6)}
    result = run(directory, plan)
    assert result["run"]["status"] == "complete" and result["summary"]["completePairedCases"] == 24
    assert net["paid"] == 730 and net["inspect"] == 1
    answering = [r for r in net["requests"] if r["messages"][0]["content"].startswith("LIFESTYLE_COMPARISON_V1")]
    assert len(answering) == 48
    sizes = [len(json.loads(r["messages"][0]["content"].splitlines()[-1])["experience"]) for r in answering]
    assert sizes.count(0) == 24 and sizes.count(len(collection)) == 24
    verify_complete(directory, plan)
    counters = net["paid"], net["inspect"]
    assert run(directory, preparation.prepare(directory))["run"]["status"] == "complete"
    assert (net["paid"], net["inspect"]) == counters
    assert snapshot(federation) == before
    page = (directory / "report.html").read_text()
    assert (directory / "comparison.png").exists() and "五包共同加载" in page
    assert "无经验 · 规则满足分" in page and "全部经验 · 规则满足分" in page and "个百分点" in page
    assert "变好 0 · 持平 24 · 变差 0" in page and "rawMacroScore" not in page
    answer = next((directory / "answers").glob("*.json"))
    saved = load(answer)
    save(answer, {**saved, "value": "corrupt"})
    with pytest.raises(ValueError, match="unit-checkpoint-changed"):
        run(directory, plan)
    assert load(directory / "run.json")["status"] == "complete" and load(directory / "run.json")["verificationError"]
    assert (net["paid"], net["inspect"]) == counters


def test_connection_drain_and_explicit_resume_reuses_successful_units(experiment):
    directory, plan = prepare_case(experiment)
    net = experiment[-1]
    net["outage"] = True
    first = run(directory, plan)
    assert first["run"]["status"] == "interrupted" and not first["run"]["terminal"]
    paid = net["paid"]
    assert paid <= 2 and not any(r["status"] == "started" for r in load(directory / "attempts.json"))
    assert sum(len(load(p)["failures"]) for p in (directory / "answers").glob("*.json")) == 1
    with pytest.raises(ValueError, match="explicit-connection"):
        run(directory, plan)
    assert net["paid"] == paid
    result = run(directory, plan, resume=True)
    assert result["run"]["status"] == "complete" and net["paid"] == 731
    assert len(load(directory / "resumes.json")) == 1
    assert sum(len(load(p)["failures"]) for p in (directory / "answers").glob("*.json")) == 1


@pytest.mark.parametrize("fault", ["library", "artifact", "incomplete", "audit"])
def test_readiness_refuses_bad_source_without_inspection(experiment, fault):
    directory, federation, _, net = experiment
    if fault == "library":
        save(federation / "batch-01/library.json", {"bad": "changed"})
    elif fault == "artifact":
        import sqlite3

        with sqlite3.connect(federation / "platform/fedagent.db") as db:
            db.execute("UPDATE artifacts SET content='{}'")
    elif fault == "incomplete":
        state = load(federation / "batch-05/state.json")
        save(federation / "batch-05/state.json", {**state, "status": "running"})
    else:
        usage = load(federation / "source-usage.json")
        usage["batches"][0]["sources"]["NIH"]["traceCount"] += 1
        save(federation / "source-usage.json", usage)
    with pytest.raises(ValueError):
        preparation.prepare(directory)
    assert not (directory / "inputs").exists() and net["paid"] == net["inspect"] == 0


def test_waiting_stall_boundary_and_single_transition(experiment, monkeypatch):
    directory, federation, _, net = experiment
    now = max(p.stat().st_mtime for p in federation.glob("batch-*/attempts.json"))
    with (federation / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(source.Waiting):
            source.bundle(federation, now + 2700)
        with pytest.raises(ValueError, match="45-minutes"):
            source.bundle(federation, now + 2701)
    real = preparation.prepare
    count = []

    def first_wait(path):
        count.append(1)
        if len(count) == 1:
            raise source.Waiting("fixture")
        return real(path)

    monkeypatch.setattr("tools.lifestyle.full.comparison.__main__.prepare", first_wait)
    sleeps = []
    assert wait_prepare(directory, waiting=True, sleep=sleeps.append)["normalCalls"] == 730
    assert sleeps == [30] and len(count) == 2 and net["paid"] == net["inspect"] == 0


def test_context_cap_preflight_all_cases_no_truncation(experiment, monkeypatch):
    directory = experiment[0]
    original = preparation.bundle

    def oversized(*args):
        plan, libraries, collection, origin = original(*args)
        return plan, libraries, {**collection, "large": "中" * 50000}, origin

    monkeypatch.setattr(preparation, "bundle", oversized)
    with pytest.raises(ValueError, match="over-context-cap"):
        preparation.prepare(directory)
    assert not (directory / "inputs").exists() and experiment[-1]["paid"] == 0


def test_frozen_and_unit_corruption_are_terminal_not_missing(experiment):
    directory, plan = prepare_case(experiment)
    net = experiment[-1]
    net["outage"] = True
    run(directory, plan)
    successes = list((directory / "answers").glob("*.json"))
    path = successes[0]
    value = load(path)
    save(path, {**value, "fingerprint": "wrong"})
    with pytest.raises(ValueError, match="unit-checkpoint-changed"):
        run(directory, plan, resume=True)
    state = load(directory / "run.json")
    assert state["status"] == "failed" and state["terminal"]
    paid = net["paid"]
    with pytest.raises(ValueError, match="terminal"):
        run(directory, plan, resume=True)
    assert net["paid"] == paid


def test_model_drift_and_inspection_outage_before_paid(experiment):
    directory, plan = prepare_case(experiment)
    net = experiment[-1]
    net["inspectionOutage"] = True
    with pytest.raises(Exception, match="身份读取"):
        run(directory, plan)
    assert load(directory / "run.json")["status"] == "prepared" and net["paid"] == 0
    net["inspectionOutage"] = False
    net["identity"] = {**IDENTITY, "model": "changed"}
    with pytest.raises(ValueError):
        run(directory, plan)
    assert net["paid"] == 0 and load(directory / "model.json") == plan["identity"]
    assert load(directory / "run.json")["status"] == "failed" and load(directory / "run.json")["terminal"]


def test_unconfirmed_ledger_blocks_replay(experiment):
    directory, plan = prepare_case(experiment)
    save(directory / "model.json", plan["identity"])
    save(directory / "attempts.json", [{"ordinal": 1, "requestHash": "a" * 64, "status": "started"}])
    with pytest.raises(ValueError, match="unconfirmed-dispatch"):
        run(directory, plan)
    assert experiment[-1]["paid"] == experiment[-1]["inspect"] == 0


def test_850_hard_cap_is_preflight_and_no_identity_read(experiment):
    directory, plan = prepare_case(experiment)
    save(directory / "model.json", plan["identity"])
    save(directory / "attempts.json", [{"ordinal": i + 1, "requestHash": "a" * 64, "status": "error"} for i in range(850)])
    with pytest.raises(ValueError, match="budget-exhausted"):
        run(directory, plan)
    assert load(directory / "run.json")["terminal"] and experiment[-1]["paid"] == experiment[-1]["inspect"] == 0


def test_frozen_collection_change_refuses_prepare(experiment):
    directory, _ = prepare_case(experiment)
    save(directory / "inputs/collection.json", {"changed": "bad"})
    with pytest.raises(ValueError, match="frozen-output-corrupted"):
        preparation.prepare(directory)
    assert experiment[-1]["paid"] == experiment[-1]["inspect"] == 0


def test_two_bad_formats_are_missing_not_wrong_and_never_retry(experiment):
    directory, plan = prepare_case(experiment)
    net = experiment[-1]
    net["format"] = True
    result = run(directory, plan)
    assert result["run"]["status"] == "incomplete" and result["run"]["terminal"]
    assert result["summary"]["completePairedCases"] == 0 and result["summary"]["arms"]["shared"]["rawMacroScore"] is None
    assert all(len(load(p)["failures"]) <= 2 for p in (directory / "grades").rglob("*.json"))
    paid = net["paid"]
    with pytest.raises(ValueError, match="terminal"):
        run(directory, plan, resume=True)
    assert net["paid"] == paid


def test_volatile_source_timestamps_do_not_change_frozen_comparison(experiment):
    directory, plan = prepare_case(experiment)
    federation = experiment[1]
    for path in federation.glob("batch-*/state.json"):
        save(path, {**load(path), "updatedAt": "new verification time"})
    save(federation / "source-usage.json", {**load(federation / "source-usage.json"), "verificationAt": "new time"})
    assert preparation.prepare(directory) == plan and experiment[-1]["paid"] == experiment[-1]["inspect"] == 0


def test_duplicate_process_lock_refuses_second_start(experiment):
    from tools.lifestyle.common import hold_experiment_lock

    directory, _ = prepare_case(experiment)
    with (directory / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(BlockingIOError):
            hold_experiment_lock(directory)
    assert experiment[-1]["paid"] == experiment[-1]["inspect"] == 0


def test_type_error_is_terminal_not_an_ordinary_missing_case(experiment, monkeypatch):
    directory, plan = prepare_case(experiment)

    def broken(*args):
        raise TypeError("fixture code failure")

    monkeypatch.setattr("tools.lifestyle.full.comparison.run.evaluate", broken)
    with pytest.raises(ValueError, match="TypeError"):
        run(directory, plan)
    assert load(directory / "run.json")["terminal"] and experiment[-1]["paid"] == 0


def test_code_change_during_wait_stops_before_paid(experiment, monkeypatch):
    version = {"version": 1}
    monkeypatch.setattr(preparation, "implementation", lambda: dict(version))

    def waiting(*args):
        raise source.Waiting("still running")

    monkeypatch.setattr("tools.lifestyle.full.comparison.__main__.prepare", waiting)
    with pytest.raises(ValueError, match="code-changed-while-waiting"):
        wait_prepare(experiment[0], waiting=True, sleep=lambda _: version.update(version=2))
    assert experiment[-1]["paid"] == experiment[-1]["inspect"] == 0
