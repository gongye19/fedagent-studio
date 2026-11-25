import json
import sqlite3

import pytest

from tools.lifestyle.common import load, save
from tools.lifestyle.sensor_trial.recovery import prepare_recovery
from tools.lifestyle.sensor_trial.run import checked_ledger, run
from tools.lifestyle.sensor_trial.transport import ConnectedModel, SSHLink


def pause(job, remote):
    remote["extractOutages"] = 2
    with pytest.raises(ValueError, match="algorithm-not-completed"):
        run(job[0])
    remote["extractOutages"] = 0


def test_authorized_recovery_preserves_prefix_and_done_units_then_offline_verify(job, remote):
    directory, _, plan = job
    pause(job, remote)
    original_plan = (directory / "inputs/plan.json").read_bytes()
    prefix = load(directory / "meter/attempts.json")
    spent = remote["paid"]
    value = prepare_recovery(directory, related=1)
    assert prepare_recovery(directory, related=1) == value
    result = run(directory)
    assert result["recovered"] and result["unknownCostAttempts"] in (1, 2)
    assert result["relatedDiagnosticCalls"] == 1
    assert remote["paid"] - spent == 20  # 不再probe或反思，只6提取+归类+建库+12回答。
    assert result["attempts"] + 1 == result["totalCountedDispatches"] <= 40
    assert load(directory / "meter/attempts.json")[: len(prefix)] == prefix
    assert (directory / "inputs/plan.json").read_bytes() == original_plan
    assert checked_ledger(directory, plan)
    before = remote["paid"], remote["inspect"]
    assert run(directory) == result
    assert (remote["paid"], remote["inspect"]) == before


def test_second_transport_failure_not_automatically_acknowledged(job, remote):
    pause(job, remote)
    directory = job[0]
    prepare_recovery(directory)
    remote["extractOutages"] = 2
    with pytest.raises(ValueError, match="algorithm-not-completed"):
        run(directory)
    spent = remote["paid"], remote["inspect"]
    with pytest.raises(ValueError, match="unknown-cost"):
        run(directory)
    assert (remote["paid"], remote["inspect"]) == spent


@pytest.mark.parametrize("target", ["ledger", "cache", "unit", "content", "code"])
def test_recovery_rejects_changed_prior_evidence(job, remote, monkeypatch, target):
    directory = job[0]
    pause(job, remote)
    prepare_recovery(directory)
    if target == "ledger":
        path = directory / "meter/attempts.json"
        values = load(path)
        values[-1]["context"]["outputTokenCap"] += 1
        save(path, values)
    elif target == "cache":
        path = next((directory / "meter/calls").glob("*.json"))
        path.write_text(path.read_text() + " ")
    elif target == "unit":
        with sqlite3.connect(directory / "platform/fedagent.db") as db:
            db.execute("UPDATE work_units SET attempts=attempts+1 WHERE step='reflect'")
    elif target == "content":
        with sqlite3.connect(directory / "platform/fedagent.db") as db:
            db.execute("UPDATE site_state SET value='\"tampered\"' WHERE key='reflection'")
    else:
        monkeypatch.setattr("tools.lifestyle.sensor_trial.prepare.implementation", dict)
    before = remote["paid"], remote["inspect"]
    with pytest.raises(ValueError):
        run(directory)
    assert (remote["paid"], remote["inspect"]) == before


def test_algorithm_changes_cannot_be_adopted_as_recovery(job, remote, monkeypatch):
    directory, _, plan = job
    pause(job, remote)
    changed = json.loads(json.dumps(plan["implementation"]))
    changed["plugin"] = "changed"
    monkeypatch.setattr("tools.lifestyle.sensor_trial.prepare.implementation", lambda: changed)
    with pytest.raises(ValueError, match="algorithm-or-unrelated"):
        prepare_recovery(directory)


def test_connected_model_uses_injected_transport_and_same_cache(job, remote):
    from tools.lifestyle import model as bridge

    directory, _, plan = job

    class Link:
        def request(self, request):
            return bridge.remote(request)

    model = ConnectedModel(directory / "transport-test", plan["modelRef"], limit=2, link=Link())
    first = model.chat("test transport cache", max_tokens=10)
    second = model.chat("test transport cache", max_tokens=10)
    assert first.text == second.text and second.cached
    assert remote["paid"] == 1


def test_control_master_private_socket_and_no_model_retry(monkeypatch):
    import subprocess

    calls = []

    def fake(args, **kwargs):
        calls.append((args, kwargs))
        if args[-1].startswith('cd "$HOME'):
            return subprocess.CompletedProcess(args, 0, stdout='{"model":"test"}', stderr="")
        return subprocess.CompletedProcess(args, 0, stdout=b"", stderr=b"")

    monkeypatch.setenv("FEDAGENT_LIFESTYLE_SSH_TARGET", "user@example.test")
    monkeypatch.setattr(subprocess, "run", fake)
    with SSHLink() as link:
        from pathlib import Path

        assert Path(link.folder.name).stat().st_mode & 0o777 == 0o700
        assert link.request({"inspect": True}) == {"model": "test"}
    assert sum(c[0][-1].startswith('cd "$HOME') for c in calls) == 1
    assert any("-M" in c[0] for c in calls) and any("exit" in c[0] for c in calls)


def test_recovery_cannot_be_created_for_completed_job(job, remote):
    run(job[0])
    with pytest.raises(ValueError):
        prepare_recovery(job[0])
    assert not (job[0] / "recovery.json").exists()


def test_completed_upstream_error_retries_bounded_and_counts_unknown_usage(job, remote):
    remote["upstreamErrors"] = 1
    result = run(job[0])
    assert result["attempts"] == 28 and result["unknownCostAttempts"] == 1
    values = load(job[0] / "meter/attempts.json")
    failed = [r for r in values if r["status"] == "error"]
    assert len(failed) == 1 and failed[0]["completedUpstreamError"] and "usage" not in failed[0]


def test_only_server_matched_error_can_amend_recovery(job, remote):
    directory = job[0]
    pause(job, remote)
    first = prepare_recovery(directory, related=1)
    remote["extractOutages"] = 1
    with pytest.raises(ValueError):
        run(directory)
    remote["extractOutages"] = 0
    values = load(directory / "meter/attempts.json")
    new = next(r for r in values if r["status"] == "error" and r["ordinal"] > len(first["ledgerPrefix"]))
    with sqlite3.connect(directory / "platform/fedagent.db") as db:
        model_hash = db.execute(
            "SELECT request_hash FROM calls WHERE error LIKE ?", ("%GuardStop:ended:" + new["requestHash"] + "%",)
        ).fetchone()[0]
    evidence = directory / "server-audit.json"
    save(evidence, [[123, "fixture", "error", "wrong-hash", 10, "重试 0 次后仍失败（模型接口返回错误）", 0, 0]])
    with pytest.raises(ValueError, match="server-evidence"):
        prepare_recovery(directory, related=1, server_audit=evidence)
    save(evidence, [[123, "fixture", "error", model_hash, 10, "重试 0 次后仍失败（模型接口返回错误）", 0, 0]])
    second = prepare_recovery(directory, related=1, server_audit=evidence)
    assert second["previousRecovery"] == first["digest"]
    assert load(directory / "meter/attempts.json") == values
    result = run(directory)
    assert result["totalCountedDispatches"] <= 40 and result["status"] == "complete"


def test_transport_recognizes_only_explicit_upstream_error(monkeypatch):
    import subprocess

    from tools.lifestyle.sensor_trial.transport import UpstreamReplyError

    link = SSHLink()
    link.base = ["ssh", "user@example.test"]
    monkeypatch.setattr(link, "check", lambda: None)

    def fail(*args, **kwargs):
        raise subprocess.CalledProcessError(
            1, args[0], stderr="fedagent_sdk.model.ModelUnavailable: 重试 0 次后仍失败（模型接口返回错误）\n"
        )

    monkeypatch.setattr(subprocess, "run", fail)
    with pytest.raises(UpstreamReplyError):
        link.request({})
