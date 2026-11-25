from tools.lifestyle.common import load, save
from tools.lifestyle.sensor_trial.adapter import TARGET
from tools.lifestyle.sensor_trial.evaluation_upgrade import accept_abstentions
from tools.lifestyle.sensor_trial.recovery import prepare_recovery
from tools.lifestyle.sensor_trial.run import run
from tools.lifestyle.sensor_trial.verify import verify
from tools.lifestyle.sensor_trial_tests.test_recovery import pause


def test_all_abstentions_complete_requests_but_no_false_mae_improvement(job, remote):
    directory = job[0]
    remote["abstainShared"] = True
    result = run(directory)
    assert result["attempts"] == 27
    assert result["scores"]["baseline"]["valid"] == 6 and result["scores"]["shared"]["valid"] == 0
    assert result["scores"]["shared"]["coverage"] == "0"
    assert result["maeDeltaSharedMinusBaseline"] is None and result["relativeErrorReduction"] is None
    assert not result["fullyComparable"] and result["changes"] == {"abstained_with_experience": 6}
    assert all(row["predictions"]["shared"] is None and row["absoluteErrors"]["shared"] is None for row in result["cases"])
    assert verify(directory) == result


def test_old_rejected_abstention_recovered_without_changing_prompt_or_reply(job, remote):
    directory = job[0]
    pause(job, remote)
    prepare_recovery(directory)
    remote["abstainShared"] = True
    run(directory)
    unit_path = min((directory / "answers").glob("*-shared.json"))
    unit = load(unit_path)
    assert unit["value"][TARGET] is None
    unit.pop("value")
    unit.pop("valueDigest")
    unit["failures"] = ["InvalidFormat", "InvalidFormat"]
    save(unit_path, unit)
    receipt_path = unit_path.with_name(unit_path.stem + "-receipt.json")
    key = load(receipt_path)["requestHash"]
    cache_path = directory / f"meter/calls/{key}.json"
    cache = load(cache_path)
    cache["rejected"] = True
    save(cache_path, cache)
    receipt_path.unlink()
    (directory / "COMPLETE.json").unlink()
    before_cache = cache_path.read_bytes()
    before_plan = (directory / "inputs/plan.json").read_bytes()
    before_ledger = (directory / "meter/attempts.json").read_bytes()
    paid = remote["paid"]
    upgrade = accept_abstentions(directory)
    assert upgrade["evaluationAcceptance"] == "abstention-coverage/v1"
    assert load(unit_path)["failures"] == ["InvalidFormat", "InvalidFormat"]
    assert load(unit_path)["value"][TARGET] is None
    result = run(directory)
    assert remote["paid"] == paid and not result["fullyComparable"]
    assert cache_path.read_bytes() == before_cache
    assert (directory / "inputs/plan.json").read_bytes() == before_plan
    assert (directory / "meter/attempts.json").read_bytes() == before_ledger
