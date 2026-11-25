import pytest

from tools.lifestyle.common import load, save
from tools.lifestyle.diet_trial.prepare import file_hash, validate
from tools.lifestyle.diet_trial.recovery import prepare_recovery
from tools.lifestyle.diet_trial.run import run
from tools.lifestyle.diet_trial.verify import verify


def stopped(directory, remote):
    remote["failLast"] = 2
    with pytest.raises(ValueError, match="unit-two-failed"):
        run(directory)
    prefix = load(directory / "meter/attempts.json")
    assert len(prefix) == 7
    proof = {
        "planSha256": file_hash(directory / "inputs/plan.json"),
        "ledgerPrefix": prefix,
        "generationFiles": {p.name: file_hash(p) for p in (directory / "generation").glob("*.json")},
        "cacheFiles": {p.name: file_hash(p) for p in (directory / "meter/calls").glob("*.json")},
    }
    save(directory / "verification/recovery-before.json", proof)
    key = prefix[-1]["requestHash"]
    save(
        directory / f"verification/upstream/upstream-{key}-prior.json",
        {
            "completedUpstreamError": True,
            "upstream": [{"type": "upstream_error", "message": "Our servers are currently overloaded. Please try again later."}],
        },
    )
    return proof


def test_recovery_preserves_prefix_successes_failed_unit_and_original_plan(job, remote):
    directory, _ = job
    proof = stopped(directory, remote)
    approved = prepare_recovery(directory)
    try:
        assert approved["callCap"] == 60 and len(approved["acknowledgedOrdinals"]) == 2
        remote["diagnosticsDirectory"] = directory / "verification/upstream"
        remote["resumeOverloads"] = 3
        result = run(directory)
        assert result["attempts"] == remote["paid"] == 41
        assert result["failedAttempts"] == 5 and result["callCap"] == 60
        assert load(directory / "meter/attempts.json")[:7] == proof["ledgerPrefix"]
        assert file_hash(directory / "inputs/plan.json") == proof["planSha256"]
        for name, expected in proof["generationFiles"].items():
            assert file_hash(directory / "generation" / name) == expected
        for name, expected in proof["cacheFiles"].items():
            assert file_hash(directory / "meter/calls" / name) == expected
        assert verify(directory) == result
        before = remote["paid"], remote["inspect"]
        assert run(directory) == result
        assert (remote["paid"], remote["inspect"]) == before
    finally:
        import shutil

        shutil.rmtree(approved["backup"])


def test_four_new_overloads_stop_without_fifth_dispatch_or_automatic_restart(job, remote):
    directory, _ = job
    stopped(directory, remote)
    approved = prepare_recovery(directory)
    try:
        remote["diagnosticsDirectory"] = directory / "verification/upstream"
        remote["resumeOverloads"] = 8
        with pytest.raises(Exception, match="GuardStop"):
            run(directory)
        assert remote["paid"] == 11
        assert (directory / "recovery/STOP.json").exists()
        before = remote["paid"], remote["inspect"]
        with pytest.raises(ValueError, match="stopped-job"):
            run(directory)
        assert (remote["paid"], remote["inspect"]) == before
    finally:
        import shutil

        shutil.rmtree(approved["backup"])


@pytest.mark.parametrize("target", ["plan", "cache", "ledger", "stop", "receipt"])
def test_recovery_detects_preserved_content_tampering_before_remote(job, remote, target):
    directory, _ = job
    stopped(directory, remote)
    approved = prepare_recovery(directory)
    try:
        paths = {
            "plan": directory / "inputs/plan.json",
            "cache": next((directory / "meter/calls").glob("*.json")),
            "ledger": directory / "meter/attempts.json",
            "stop": directory / "STOP.json",
            "receipt": directory / "recovery.json",
        }
        save(paths[target], {})
        before = remote["paid"], remote["inspect"]
        with pytest.raises((ValueError, KeyError, TypeError, AttributeError)):
            validate(directory)
        assert (remote["paid"], remote["inspect"]) == before
    finally:
        import shutil

        shutil.rmtree(approved["backup"])
