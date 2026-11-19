"""已支付一次probe后的标签修复：无模型调用、无DB写入、不中断账本。"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from fedagent import models as m
from fedagent.api import create_app
from fedagent.resource_services.endpoint_checks import check_endpoint
from sqlalchemy import func, select

from tools.lifestyle import model as bridge
from tools.lifestyle.common import digest, load, save
from tools.lifestyle.full.federation import prepare as preparation
from tools.lifestyle.full.federation.budget import GuardedModel, SwitchingModel, allocate
from tools.lifestyle.full.federation.run import run_batch
from tools.lifestyle.full.maintenance.repair_labels import database_evidence, inputs_ok, paid_files, repair
from tools.lifestyle.full_tests.test_federation_prepare import complete_generation
from tools.lifestyle.full_tests.test_federation_run import IDENTITY
from tools.lifestyle.full_tests.test_federation_run import remote as remote
from tools.lifestyle.runner import checked, local_platform


def legacy_run(tmp_path, monkeypatch):
    complete_generation(tmp_path, monkeypatch)
    directory = tmp_path / "federation"
    new = preparation.prepare(directory)
    old = {k: v for k, v in new.items() if k not in ("fingerprint", "resourceTag", "labelOverrides")}
    old["protocol"] = "lifestyle-full-federation/1"
    old["batches"] = [{k: v for k, v in b.items() if k != "labels"} for b in old["batches"]]
    old["fingerprint"] = digest(old)
    save(directory / "inputs/plan.json", old)
    manifest = {"outputs": {p.name: digest(p.read_bytes().hex()) for p in (directory / "inputs").iterdir() if p.name != "manifest.json"}}
    manifest["manifestDigest"] = digest(manifest)
    save(directory / "inputs/manifest.json", manifest)
    guard = GuardedModel(directory / "batch-01", old, allocate(directory, old, 0))
    switching = SwitchingModel(IDENTITY)
    switching.active = guard
    platform = local_platform(directory, switching)
    tag = old["fingerprint"][:10]
    with TestClient(create_app(platform)) as client:
        assert check_endpoint(platform, "default", verify_platform=True).ok
        data = checked(
            client.post(
                "/v1/resources/data",
                data={
                    "name": f"LifeStyle CDC · batch-01 · {tag}",
                    "sourceName": f"LifeStyle CDC · {tag}",
                    "hosting": "platform",
                    "taskType": "lifestyle-records",
                },
                files={"file": ("process.jsonl", (directory / "inputs/batch-01-CDC.jsonl").read_bytes(), "application/jsonl")},
            ),
            201,
        )
        bad = client.post(
            "/v1/resources/data",
            data={
                "name": f"LifeStyle MedMCQA · batch-01 · {tag}",
                "sourceName": f"LifeStyle MedMCQA · {tag}",
                "hosting": "platform",
                "taskType": "lifestyle-records",
            },
            files={"file": ("process.jsonl", (directory / "inputs/batch-01-MedMCQA.jsonl").read_bytes(), "application/jsonl")},
        )
        assert bad.status_code == 422
    switching.active = None
    state = {
        "fingerprint": old["fingerprint"],
        "status": "failed",
        "terminal": True,
        "rootError": None,
        "probePassed": True,
        "sites": {"CDC": {"participantId": data["source"]["id"], "datasetId": data["dataset"]["id"]}},
        "error": "ValueError: 本机平台请求失败：422 " + json.dumps(bad.json(), ensure_ascii=False),
    }
    save(directory / "batch-01/state.json", state)
    save(directory / "source-usage.json", {"status": "incomplete", "batches": [{"batch": "batch-01", "status": "failed"}]})
    return directory, old, state, platform


def forbid_calls(monkeypatch):
    def forbidden(*_, **__):
        pytest.fail("label migration must not inspect or call models")

    monkeypatch.setattr(bridge, "remote", forbidden)
    monkeypatch.setattr(bridge.CachedModel, "__init__", forbidden)
    monkeypatch.setattr(GuardedModel, "__init__", forbidden)
    monkeypatch.setattr("fedagent.resource_services.endpoint_checks.check_endpoint", forbidden)


def test_paid_probe_and_legacy_resource_survive_label_revision(tmp_path, monkeypatch, remote):
    directory, old, state, platform = legacy_run(tmp_path, monkeypatch)
    before = database_evidence(directory, old, state)
    counters = remote["paid"], remote["inspect"]
    with monkeypatch.context() as guarded:
        forbid_calls(guarded)
        receipt = repair(directory, expected_old_fingerprint=old["fingerprint"])
    assert (remote["paid"], remote["inspect"]) == counters == (1, 1)
    assert receipt["totalAttempts"] == 448 and receipt["databaseWrites"] == 0
    assert load(directory / "source-usage.json")["status"] == "label-repaired-pending-run"
    assert database_evidence(directory, old, load(directory / "batch-01/state.json")) == before
    new = preparation.prepare(directory)
    assert new["resourceTag"] == old["fingerprint"][:10] and new["labelOverrides"] == {"batch-01/CDC": before["dataset"]["name"]}
    assert inputs_ok(Path(receipt["archive"])) == old
    assert new["fingerprint"] != old["fingerprint"]
    switching = SwitchingModel(IDENTITY)
    platform = local_platform(directory, switching)
    with TestClient(create_app(platform)) as client:
        result = run_batch(directory, new, 0, platform, client, switching)
    assert result["status"] == "complete" and remote["paid"] == 181  # 原1次probe保留，89反思+89提取+2聚合
    with platform.db.session() as session:
        assert session.scalar(select(func.count()).select_from(m.Dataset)) == 6
        assert session.scalar(select(func.sum(m.Dataset.count))) == 89
    assert len(load(directory / "batch-01/attempts.json")) == 181


def test_failed_revision_restores_files_without_paid_or_database_change(tmp_path, monkeypatch, remote):
    directory, old, state, _ = legacy_run(tmp_path, monkeypatch)
    before = database_evidence(directory, old, state)
    paid = paid_files(directory)
    state_bytes = (directory / "batch-01/state.json").read_bytes()
    alloc_bytes = (directory / "batch-01/allocation.json").read_bytes()

    def fail(_):
        raise RuntimeError("injected-maintenance-failure")

    with monkeypatch.context() as guarded:
        forbid_calls(guarded)
        with pytest.raises(RuntimeError, match="injected"):
            repair(directory, expected_old_fingerprint=old["fingerprint"], fail_at=fail)
    assert inputs_ok(directory) == old and paid_files(directory) == paid
    assert (directory / "batch-01/state.json").read_bytes() == state_bytes and (directory / "batch-01/allocation.json").read_bytes() == alloc_bytes
    assert database_evidence(directory, old, state) == before and remote["paid"] == 1
    assert load(next((directory / "repairs").glob("*/failure.json")))["rolledBack"]


@pytest.mark.parametrize("fault", ["later-directory", "extra-ledger", "task-exists"])
def test_revision_refuses_unexpected_progress_before_mutating(tmp_path, monkeypatch, remote, fault):
    directory, old, state, platform = legacy_run(tmp_path, monkeypatch)
    if fault == "later-directory":
        (directory / "batch-02").mkdir()
    elif fault == "extra-ledger":
        values = load(directory / "batch-01/attempts.json")
        save(directory / "batch-01/attempts.json", [*values, {**values[0], "ordinal": 2}])
    else:
        with platform.db.session() as session:
            session.add(
                m.Task(
                    id="unexpected",
                    name="unexpected",
                    scenario="horizontal",
                    task_type="lifestyle-records",
                    algorithm="fot-records",
                    plugin_version="1",
                    plugin_hash="fixed",
                    config={},
                    audit={},
                    status="queued",
                )
            )
    with monkeypatch.context() as guarded:
        forbid_calls(guarded)
        with pytest.raises(ValueError):
            repair(directory, expected_old_fingerprint=old["fingerprint"])
    assert inputs_ok(directory) == old and load(directory / "batch-01/state.json") == state and remote["paid"] == 1
    assert not (directory / "repairs").exists()


def test_normal_prepare_refuses_legacy_and_missing_inputs(tmp_path, monkeypatch, remote):
    directory, _, _, _ = legacy_run(tmp_path, monkeypatch)
    with pytest.raises(ValueError, match="legacy-v1"):
        preparation.prepare(directory)
    (directory / "inputs").rename(directory / "archived-inputs")
    with pytest.raises(ValueError, match="inputs-missing-but-batch-state-exists"):
        preparation.prepare(directory)
    assert not (directory / "inputs").exists() and remote["paid"] == 1


@pytest.mark.parametrize(
    "options,error",
    [
        ({"resource_tag": "bad"}, "invalid-resource-tag"),
        ({"label_overrides": {"batch-01/unknown": "name"}}, "unknown-label-override"),
        ({"label_overrides": {"batch-01/CDC": "x" * 41}}, "resource-label-exceeds-upload-contract"),
    ],
)
def test_label_preflight_rejects_invalid_values(tmp_path, monkeypatch, options, error):
    complete_generation(tmp_path, monkeypatch)
    directory = tmp_path / "federation"
    with pytest.raises(ValueError, match=error):
        preparation.prepare(directory, **options)
    assert not (directory / "inputs").exists()


def test_existing_v2_cannot_override_labels(tmp_path, monkeypatch):
    complete_generation(tmp_path, monkeypatch)
    directory = tmp_path / "federation"
    preparation.prepare(directory)
    with pytest.raises(ValueError, match="cannot-override-existing-frozen-labels"):
        preparation.prepare(directory, resource_tag="a" * 10)
