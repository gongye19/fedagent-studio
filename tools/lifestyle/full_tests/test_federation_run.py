"""真平台API与编排，模型在测试中替换；不发起付费调用。"""

import pytest
from fastapi.testclient import TestClient
from fedagent import models as m
from fedagent.api import create_app
from fedagent_fot import prompts
from fedagent_sdk import ModelError
from sqlalchemy import func, select

from tools.lifestyle import model as bridge
from tools.lifestyle.batch_tests.test_federation import FakeModel
from tools.lifestyle.common import digest, jsonl, load
from tools.lifestyle.full.federation.budget import InspectionUnavailable, SwitchingModel
from tools.lifestyle.full.federation.resources import resource_labels
from tools.lifestyle.full.federation.run import VerificationUnavailable, run
from tools.lifestyle.runner import local_platform

IDENTITY = {"endpoint": "default", "model": "test", "kind": "openai", "baseUrl": "https://example.test/v1"}


def setup_plan(directory, batches=2, sources=("NIH", "NHS")):
    values = []
    for index in range(batches):
        name = f"batch-{index + 1:02}"
        ids = []
        for source in sources:
            records = [
                {
                    "id": f"{source}-{index * 2 + i + 1:02}",
                    "input": {"profile": "公开资料，个人情况未知", "question": f"{source}-{index * 2 + i + 1:02}适合什么活动？"},
                    "events": [{"role": "advisor", "content": "先确认身体限制"}],
                    "output": "按能力逐步增加活动",
                    "provenance": {"synthetic": True},
                }
                for i in range(2)
            ]
            jsonl(directory / "inputs" / (name + "-" + source + ".jsonl"), records)
            ids += [r["id"] for r in records]
        values.append(
            {
                "id": name,
                "count": 2 * len(sources),
                "sources": {s: 2 for s in sources},
                "labels": {s: resource_labels("abcdef1234", name, s, 2) for s in sources},
                "ids": ids,
            }
        )
    plan = {
        "generationAttempts": 100,
        "identity": IDENTITY,
        "modelRef": "default:test",
        "batches": values,
        "counts": {s: 2 * batches for s in sources},
        "resourceTag": "abcdef1234",
        "globalCallCap": 1500,
        "batchCallCap": 250,
        "contextCap": 1050000,
        "params": {"insightTarget": "paper-auto", "maxTracesPerItem": 3, "aggregationRetries": 5},
    }
    plan["fingerprint"] = digest(plan)
    return plan


@pytest.fixture
def remote(monkeypatch):
    state = {
        "paid": 0,
        "inspect": 0,
        "outage": False,
        "failure": None,
        "model": FakeModel(),
        "identity": IDENTITY,
        "truncateProfile": False,
        "inspectFailAt": None,
        "truncateLibrary": False,
    }

    def fake(request):
        if request.get("inspect"):
            state["inspect"] += 1
            if state["inspect"] == state["inspectFailAt"]:
                raise ModelError("test unpaid identity connection failure")
            return state["identity"]
        state["paid"] += 1
        text = "\n".join(r["content"] for r in request["messages"])
        if state["truncateProfile"] and text.lstrip().startswith(prompts.PROFILING_TEMPLATE.strip()[:70]):
            return {"text": "partial-profile", "model": "test", "usage": {"completion_tokens": 32768}, "finish_reason": "length"}
        if state["truncateLibrary"] and text.lstrip().startswith(prompts.LIBRARY_TEMPLATE.strip()[:70]):
            return {"text": "partial-library", "model": "test", "usage": {"completion_tokens": 16384}, "finish_reason": "length"}
        if state["outage"] and "Before analyzing the" not in text and "Reply with OK" not in text:
            state["outage"] = False
            raise ModelError("test connection ended")
        model = state["model"]
        model.failure = state["failure"]
        answer = model.chat(request["messages"], **request["settings"])
        return {"text": answer.text, "model": "test", "usage": answer.usage, "finish_reason": answer.finish_reason}

    monkeypatch.setattr(bridge, "remote", fake)
    return state


def test_full_real_api_counts_and_completed_recovery_zero_inspection(tmp_path, remote):
    plan = setup_plan(tmp_path)
    result = run(tmp_path, plan)
    assert result["status"] == "complete" and result["totalAttempts"] == 122
    assert remote["paid"] == 22 and remote["inspect"] == 2
    assert result["combinedLibrary"] is False and len(result["finalEntriesByBatch"]) == 2
    assert {s: v["extractedUnits"] for s, v in result["sources"].items()} == {"NIH": 4, "NHS": 4}
    assert all(v["traceCount"] == 4 and v["zeroTraceItems"] == 0 for v in result["sources"].values())
    before = dict(remote)
    assert run(tmp_path, plan)["status"] == "complete"
    assert remote["paid"] == before["paid"] and remote["inspect"] == before["inspect"]
    platform = local_platform(tmp_path, SwitchingModel(IDENTITY))
    with platform.db.session() as session:
        assert session.scalar(select(func.count()).select_from(m.Participant)) == 2
        assert session.scalar(select(func.count()).select_from(m.App)) == 2
        assert list(session.scalars(select(m.Dataset.count))) == [2] * 4
        assert all("lifestyleSourceUsage" in t.audit for t in session.scalars(select(m.Task)))


def test_zero_trace_is_original_semantics_not_missing_processed_record(tmp_path, remote):
    plan = setup_plan(tmp_path, 1)
    remote["failure"] = "zero"
    result = run(tmp_path, plan)
    assert result["status"] == "complete"
    assert result["sources"]["NIH"]["extractedUnits"] == 2
    assert result["sources"]["NIH"]["zeroTraceItems"] == 1
    assert result["sources"]["NIH"]["traceCount"] == 1


@pytest.mark.parametrize("failure", ["profile", "library", "excess"])
def test_algorithm_failure_never_publishes_or_restarts(tmp_path, remote, failure):
    plan = setup_plan(tmp_path)
    remote["failure"] = failure
    result = run(tmp_path, plan)
    assert result["status"] == "incomplete" and result["batches"][0]["status"] == "failed"
    assert result["batches"][0]["appId"] is None and result["batches"][1]["status"] == "not-started"
    before = remote["paid"]
    with pytest.raises(ValueError, match="terminal-batch"):
        run(tmp_path, plan, resume=True)
    assert remote["paid"] == before


def test_connection_failure_snapshots_and_explicit_bounded_resume(tmp_path, remote):
    plan = setup_plan(tmp_path, 1)
    remote["outage"] = True
    first = run(tmp_path, plan)
    assert first["batches"][0]["status"] == "interrupted"
    history = load(tmp_path / "batch-01/failed-units.json")
    assert history and all(u["attempts"] == 1 for entry in history for u in entry["units"])
    before = remote["paid"]
    with pytest.raises(ValueError, match="explicit-resume"):
        run(tmp_path, plan)
    assert remote["paid"] == before
    final = run(tmp_path, plan, resume=True)
    assert final["status"] == "complete" and remote["paid"] == 12
    assert load(tmp_path / "batch-01/resumes.json")[0]["ledgerDigest"]


def test_recovered_config_change_fails_without_inspection_or_dispatch(tmp_path, remote):
    plan = setup_plan(tmp_path, 1)
    result = run(tmp_path, plan)
    platform = local_platform(tmp_path, SwitchingModel(IDENTITY))
    with platform.db.session() as session:
        task = session.get(m.Task, result["batches"][0]["taskId"])
        task.config = {**task.config, "workers": 8}
    before = (remote["paid"], remote["inspect"])
    with pytest.raises(VerificationUnavailable):
        run(tmp_path, plan)
    state = load(tmp_path / "batch-01/state.json")
    assert state["status"] == "complete" and not state["terminal"] and state["verificationError"]
    assert (remote["paid"], remote["inspect"]) == before


def test_switching_bridge_without_active_model_never_dispatches(tmp_path, remote):
    switching = SwitchingModel(IDENTITY)
    platform = local_platform(tmp_path, switching)
    with TestClient(create_app(platform)), pytest.raises(ModelError, match="No active"):
        platform.gateway.model("default:test").chat("not active")
    assert remote["paid"] == remote["inspect"] == 0


def test_truncated_profile_is_terminal_without_publish(tmp_path, remote):
    plan = setup_plan(tmp_path, 1)
    remote["truncateProfile"] = True
    result = run(tmp_path, plan)
    assert result["batches"][0]["status"] == "failed" and result["batches"][0]["appId"] is None
    assert all(v["extractedUnits"] == 2 for v in result["sources"].values())
    assert remote["paid"] == 10


def test_unpaid_inspect_failure_starting_second_batch_preserves_resume(tmp_path, remote):
    plan = setup_plan(tmp_path)
    remote["inspectFailAt"] = 2
    with pytest.raises(InspectionUnavailable):
        run(tmp_path, plan)
    assert remote["paid"] == 11
    state = load(tmp_path / "batch-02/state.json")
    assert state["status"] == "prepared" and not state.get("terminal")
    remote["inspectFailAt"] = None
    assert run(tmp_path, plan)["status"] == "complete" and remote["paid"] == 22


def test_unpaid_inspect_failure_during_explicit_resume_keeps_prior_cause(tmp_path, remote):
    plan = setup_plan(tmp_path, 1)
    remote["outage"] = True
    assert run(tmp_path, plan)["batches"][0]["status"] == "interrupted"
    before = load(tmp_path / "batch-01/state.json")
    paid = remote["paid"]
    remote["inspectFailAt"] = remote["inspect"] + 1
    with pytest.raises(InspectionUnavailable):
        run(tmp_path, plan, resume=True)
    state = load(tmp_path / "batch-01/state.json")
    assert state["status"] == "interrupted" and state["rootError"] == before["rootError"] and not state.get("terminal")
    assert remote["paid"] == paid
    remote["inspectFailAt"] = None
    assert run(tmp_path, plan, resume=True)["status"] == "complete" and remote["paid"] == 12


def test_truncated_library_is_terminal_without_publish(tmp_path, remote):
    plan = setup_plan(tmp_path, 1)
    remote["truncateLibrary"] = True
    result = run(tmp_path, plan)
    assert result["batches"][0]["status"] == "failed" and result["batches"][0]["appId"] is None
    assert remote["paid"] == 11


def test_fresh_batch_identity_drift_never_overwrites_frozen_identity(tmp_path, remote):
    plan = setup_plan(tmp_path, 1)
    remote["identity"] = {**IDENTITY, "baseUrl": "https://different.test/v1"}
    result = run(tmp_path, plan)
    assert result["batches"][0]["status"] == "failed" and remote["paid"] == 0
    assert load(tmp_path / "batch-01/model.json") == plan["identity"]


def test_transient_completed_recheck_failure_keeps_completed_facts(tmp_path, remote, monkeypatch):
    import importlib

    runtime = importlib.import_module("tools.lifestyle.full.federation.run")
    plan = setup_plan(tmp_path)
    assert run(tmp_path, plan)["status"] == "complete"
    before = remote["paid"], remote["inspect"]
    original = runtime.ensure_resources
    once = [True]

    def flaky(*args):
        if once[0]:
            once[0] = False
            raise OSError("temporary-recheck-read-error")
        return original(*args)

    monkeypatch.setattr(runtime, "ensure_resources", flaky)
    with pytest.raises(VerificationUnavailable):
        run(tmp_path, plan)
    state = load(tmp_path / "batch-01/state.json")
    assert state["status"] == "complete" and not state["terminal"]
    assert load(tmp_path / "source-usage.json")["status"] == "verification-required"
    assert run(tmp_path, plan)["status"] == "complete"
    assert (remote["paid"], remote["inspect"]) == before


def test_all_six_actual_source_labels_pass_real_upload_and_fot(tmp_path, remote):
    from tools.lifestyle.full.generation.prepare import COUNTS

    plan = setup_plan(tmp_path, 1, sources=tuple(COUNTS))
    assert max(len(v["name"]) for v in plan["batches"][0]["labels"].values()) <= 40
    result = run(tmp_path, plan)
    assert result["status"] == "complete" and set(result["sources"]) == set(COUNTS)
    assert all(v["uploaded"] == v["extractedUnits"] == 2 for v in result["sources"].values())
    assert remote["paid"] == 27
