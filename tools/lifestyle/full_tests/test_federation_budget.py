import threading
from types import SimpleNamespace

import pytest
from fedagent import models as m
from fedagent.engine import TaskEngine
from fedagent_sdk import ModelError
from sqlalchemy import select

from tools.lifestyle import model as bridge
from tools.lifestyle.common import load, save
from tools.lifestyle.full.federation.budget import GuardedModel, GuardStop, SwitchingModel, allocate, ledger
from tools.lifestyle.full.federation.engine import DrainingEngine, resume_failed
from tools.lifestyle.full_tests.test_federation_run import IDENTITY, setup_plan
from tools.lifestyle.runner import local_platform


def test_global_budget_reserves_future_before_model_construction(tmp_path):
    plan = setup_plan(tmp_path, 5)
    plan["generationAttempts"] = 500
    for batch in plan["batches"][:4]:
        save(tmp_path / batch["id"] / "model.json", IDENTITY)
        save(tmp_path / batch["id"] / "attempts.json", [{"ordinal": i + 1, "status": "ok", "requestHash": "a" * 64} for i in range(250)])
    with pytest.raises(ValueError, match="insufficient-reserved-budget"):
        allocate(tmp_path, plan, 4)
    assert not (tmp_path / "batch-05/allocation.json").exists()


def test_allocation_is_locked_and_unknown_directories_or_started_rejected(tmp_path):
    plan = setup_plan(tmp_path)
    assert allocate(tmp_path, plan, 0) == 250
    plan["generationAttempts"] += 1
    with pytest.raises(ValueError, match="locked-allocation"):
        allocate(tmp_path, plan, 0)
    (tmp_path / "batch-06").mkdir()
    with pytest.raises(ValueError, match="unknown-batch"):
        allocate(tmp_path, plan, 0)
    (tmp_path / "batch-06").rmdir()
    save(tmp_path / "batch-01/attempts.json", [{"ordinal": 1, "status": "started", "requestHash": "b" * 64}])
    with pytest.raises(ValueError, match="unconfirmed"):
        allocate(tmp_path, plan, 0)


def test_same_request_two_errors_cannot_dispatch_third(tmp_path, monkeypatch):
    calls = []

    def remote(request):
        if request.get("inspect"):
            return IDENTITY
        calls.append(request)
        raise ModelError("connection failed")

    monkeypatch.setattr(bridge, "remote", remote)
    plan = setup_plan(tmp_path, 1)
    for _ in range(3):
        guard = GuardedModel(tmp_path / "batch-01", plan, 250)
        with pytest.raises(GuardStop):
            guard.chat("fixed-request", max_tokens=20)
    assert len(calls) == 2
    assert guard.root_error["recoverable"] is False


def test_actual_escaped_context_preflight_and_identity_fail_before_paid(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(bridge, "remote", lambda r: IDENTITY if r.get("inspect") else calls.append(r))
    plan = setup_plan(tmp_path, 1)
    plan["contextCap"] = 1500
    guard = GuardedModel(tmp_path / "batch-01", plan, 250)
    with pytest.raises(GuardStop):
        guard.chat([{"role": "user", "content": '"' * 1000}], max_tokens=20)
    assert calls == [] and guard.root_error["recoverable"] is False
    monkeypatch.setattr(bridge, "remote", lambda _: {**IDENTITY, "baseUrl": "https://changed.test"})
    with pytest.raises(ValueError):
        GuardedModel(tmp_path / "batch-01", plan, 250)


def test_engine_exception_waits_worker_and_sets_stop_before_worker_finishes(tmp_path, monkeypatch):
    stopped = threading.Event()
    finished = []

    def fake_step(*_):
        thread = threading.Thread(target=lambda: (stopped.wait(2), finished.append("drained")), name="reflect_0")
        thread.start()
        raise RuntimeError("engine-error")

    monkeypatch.setattr(TaskEngine, "_run_step", fake_step)
    engine = DrainingEngine.__new__(DrainingEngine)
    engine.guard = SimpleNamespace(stopped=stopped)
    with pytest.raises(RuntimeError):
        engine._run_step(1, SimpleNamespace(id="reflect"))
    assert stopped.is_set() and finished == ["drained"]


def test_guarded_failed_units_resume_atomically_with_original_attempts(tmp_path):
    platform = local_platform(tmp_path, SwitchingModel(IDENTITY))
    key1, key2 = "a" * 64, "b" * 64
    errors = [f"GuardStop:blocked:{key1}", f"GuardStop:ended:{key2}"]
    with platform.db.session() as session:
        session.add(
            m.Task(
                id="t",
                name="t",
                scenario="horizontal",
                task_type="lifestyle-records",
                algorithm="fot-records",
                plugin_version="1",
                plugin_hash="fixed",
                config={},
                audit={},
                status="paused",
            )
        )
        session.flush()
        units = [
            m.WorkUnit(task_id="t", round=1, step="reflect", site_id="s", unit_key=str(i), executor="platform", status="failed", attempts=1, error=e)
            for i, e in enumerate(errors)
        ]
        session.add_all(units)
        session.flush()
        snapshots = [{"id": u.id, "attempts": 1, "error": u.error} for u in units]
    save(tmp_path / "failed-units.json", [{"units": snapshots}])
    save(tmp_path / "attempts.json", [{"ordinal": 1, "status": "error", "requestHash": key2}])
    resume_failed(platform, "t", tmp_path)
    with platform.db.session() as session:
        assert [(u.status, u.attempts) for u in session.scalars(select(m.WorkUnit))] == [("pending", 1), ("pending", 1)]
    assert len(load(tmp_path / "resumes.json")[0]["restoredUnits"]) == 2
    with platform.db.session() as session:
        for u in session.scalars(select(m.WorkUnit)):
            u.status = "failed"
        session.scalars(select(m.WorkUnit)).first().error = "invalid profile"
    with pytest.raises(ValueError, match="non-connection"):
        resume_failed(platform, "t", tmp_path)
    with platform.db.session() as session:
        assert all(u.status == "failed" for u in session.scalars(select(m.WorkUnit)))


def test_cache_digest_and_ledger_identity_corruption_rejected(tmp_path):
    save(tmp_path / "attempts.json", [{"ordinal": 1, "status": "ok", "requestHash": "a" * 64}])
    with pytest.raises(ValueError, match="identity-missing"):
        ledger(tmp_path, IDENTITY)
    save(tmp_path / "model.json", IDENTITY)
    save(tmp_path / "calls" / ("a" * 64 + ".json"), {"request": {"identity": IDENTITY}, "result": {"text": "changed"}, "resultDigest": "wrong"})
    with pytest.raises(ValueError, match="cache-corrupt"):
        ledger(tmp_path, IDENTITY)


def test_invalid_reply_keeps_original_finite_format_retries(tmp_path, monkeypatch):
    from tools.lifestyle.model import InvalidReply

    calls = []

    def remote(request):
        if request.get("inspect"):
            return IDENTITY
        calls.append(request)
        return {"text": "partial" if len(calls) < 4 else "valid", "model": "test", "usage": {}, "finish_reason": "length" if len(calls) < 4 else "stop"}

    monkeypatch.setattr(bridge, "remote", remote)
    plan = setup_plan(tmp_path, 1)
    guard = GuardedModel(tmp_path / "batch-01", plan, 250)
    for _ in range(3):
        with pytest.raises(InvalidReply):
            guard.chat("same-format-request", max_tokens=10)
        assert not guard.stopped.is_set()
    assert guard.chat("same-format-request", max_tokens=10).text == "valid" and len(calls) == 4


def test_primary_format_failure_already_reset_pending_cannot_hide_behind_peer(tmp_path):
    platform = local_platform(tmp_path, SwitchingModel(IDENTITY))
    with platform.db.session() as session:
        session.add(
            m.Task(
                id="t",
                name="t",
                scenario="horizontal",
                task_type="lifestyle-records",
                algorithm="fot-records",
                plugin_version="1",
                plugin_hash="f",
                config={},
                audit={},
                status="paused",
            )
        )
        session.flush()
        primary = m.WorkUnit(
            task_id="t", round=1, step="profile", site_id="server", unit_key="_", executor="platform", status="pending", attempts=0, error="invalid profile"
        )
        peer = m.WorkUnit(
            task_id="t",
            round=1,
            step="reflect",
            site_id="s",
            unit_key="peer",
            executor="platform",
            status="failed",
            attempts=1,
            error="GuardStop:blocked:" + "a" * 64,
        )
        session.add_all([primary, peer])
        session.flush()
        snapshots = [{"id": u.id, "error": u.error, "attempts": 1} for u in (primary, peer)]
    save(tmp_path / "failed-units.json", [{"units": snapshots}])
    with pytest.raises(ValueError, match="non-connection"):
        resume_failed(platform, "t", tmp_path)
    with platform.db.session() as session:
        assert [(u.status, u.attempts) for u in session.scalars(select(m.WorkUnit))] == [("pending", 0), ("failed", 1)]
    assert not (tmp_path / "resumes.json").exists()
