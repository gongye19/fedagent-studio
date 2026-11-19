from collections import Counter

import pytest

from tools.lifestyle.common import save
from tools.lifestyle.full.federation import prepare as preparation
from tools.lifestyle.full.generation.prepare import COUNTS, implementation
from tools.lifestyle.full_tests.test_federation_run import IDENTITY


def test_prepare_requires_complete_generation_before_creating_inputs(tmp_path, monkeypatch):
    monkeypatch.setattr(preparation, "generation_prepare", lambda _: ({}, []))
    monkeypatch.setattr(preparation, "usage", lambda *_: ({"state": {"status": "running"}, "counts": {"unresolvedDispatches": 2}}, {}))
    with pytest.raises(ValueError, match="must-complete"):
        preparation.prepare(tmp_path / "federation")
    assert not (tmp_path / "federation").exists()


def test_all444_partition_and_frozen_generation_and_upload_digest(tmp_path, monkeypatch):
    cases = [{"id": f"{source}-{i}", "source": source} for source, count in COUNTS.items() for i in range(count)]
    generation = tmp_path / "generation"
    for c in cases:
        save(generation / "units" / (c["id"] + ".json"), {"value": {"id": c["id"], "source": c["source"]}})
    save(generation / "model.json", IDENTITY)
    monkeypatch.setattr(preparation, "generation_prepare", lambda _: ({"fingerprint": "fixed-generation", "modelRef": "default:test", "counts": COUNTS}, cases))
    monkeypatch.setattr(
        preparation,
        "usage",
        lambda *_: ({"state": {"status": "complete"}, "counts": {"unresolvedDispatches": 0}, "remoteAttempts": 445}, {c["id"]: "generated" for c in cases}),
    )
    directory = tmp_path / "federation"
    plan = preparation.prepare(directory)
    assert [b["count"] for b in plan["batches"]] == [89, 89, 89, 89, 88]
    actual = Counter()
    ids = []
    for batch in plan["batches"]:
        assert set(batch["sources"]) == set(COUNTS)
        records = preparation.records_for(directory, batch)
        for source, values in records.items():
            actual[source] += len(values)
            ids += [v["id"] for v in values]
    assert actual == COUNTS and len(ids) == len(set(ids)) == 444
    assert preparation.prepare(directory) == plan
    save(generation / "units" / (cases[0]["id"] + ".json"), {"value": {"changed": True}})
    with pytest.raises(ValueError, match="frozen-federation"):
        preparation.prepare(directory)


def test_large_batch_rejected_by_output_and_time_planning():
    assert preparation.capacity(90)["profileOutputTokens"] < 32768 * 0.6
    with pytest.raises(ValueError, match="extrapolation-risk"):
        preparation.capacity(444)


def test_sibling_phase2_is_not_in_frozen_generation_code():
    assert not any("full/federation/" in path for path in implementation()["files"])


def test_generation_lock_prevents_snapshot_until_process_exits(tmp_path):
    import fcntl

    generation = tmp_path / "generation"
    generation.mkdir()
    with (generation / ".lock").open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(ValueError, match="generation-lock-held"):
            preparation.prepare(tmp_path / "federation")
    assert not (tmp_path / "federation/inputs").exists()
