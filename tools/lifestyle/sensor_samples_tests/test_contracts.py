"""Verified source identity, measured case boundaries, and estimate-only capacity."""

import csv
import hashlib
import json
from datetime import datetime, timedelta

import pytest

from tools.lifestyle.sensor_samples import cgmacros
from tools.lifestyle.sensor_samples.budget import (
    allocation,
    nonoverlap,
    proposal,
    representative,
)
from tools.lifestyle.sensor_samples.build import HERE, build, validate_case
from tools.lifestyle.sensor_samples.common import verify_input

POLICY = json.loads((HERE / "policy.json").read_text())


def cg_fixture(
    root,
    *,
    dexcom=True,
    amount="100",
    amount_status="percent_like_unverified",
    second_offset=None,
):
    directory = root / "cgmacros"
    directory.mkdir()
    pid, anchor = "cgmacros:001", datetime.fromisoformat("2020-01-01T12:00:00")
    profile = {
        "participant_id": pid,
        "numeric_clean": {"Age": "27", "BMI": "22", "Fasting GLU - PDL (Lab)": "90"},
        "raw": {"Gender": "F"},
        "weight_kg": "60",
        "height_cm": "165",
        "source": {"member": "bio.csv", "rows": [2]},
    }
    meal = {
        "participant_id": pid,
        "local_timestamp": anchor.isoformat(timespec="seconds"),
        "nutrition_candidate": True,
        "quality_flags": [],
        "amount_consumed_raw": amount,
        "amount_unit_status": amount_status,
        "meal_type": "lunch",
        "logged_nutrients": {
            "kcal": "100",
            "carbs_g": "10",
            "protein_g": "3",
            "fat_g": "2",
            "fiber_g": "1",
        },
        "source": {"member": "CGMacros/001.csv", "rows": [62]},
    }
    meals = [meal]
    if second_offset is not None:
        meals.append(
            {
                **meal,
                "local_timestamp": (
                    anchor + timedelta(minutes=second_offset)
                ).isoformat(timespec="seconds"),
                "nutrition_candidate": False,
                "quality_flags": ["all_zero_nutrition"],
                "amount_consumed_raw": "0",
            }
        )
    for file, records in [
        ("participants.jsonl", [profile]),
        ("meals.jsonl", meals),
        ("untyped_meal_fields.jsonl", []),
    ]:
        (directory / file).write_text(
            "".join(json.dumps(row) + "\n" for row in records)
        )
    rows = [
        {
            "participant_id": pid,
            "local_timestamp": (anchor + timedelta(minutes=i)).isoformat(
                timespec="seconds"
            ),
            "dexcom_mg_dl": ("100" if i < 0 else "120") if dexcom else "",
            "libre_mg_dl": "80",
            "source_rows": str(i + 100),
            "heart_rate_bpm": "60",
            "mets": "1",
            "activity_kcal": "1",
        }
        for i in range(-60, 121)
    ]
    with (directory / "sensor_grid.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


@pytest.mark.parametrize("dexcom", [True, False])
def test_primary_device_preference_is_fixed_not_best_outcome(tmp_path, dexcom):
    cg_fixture(tmp_path, dexcom=dexcom)
    cases, audit, _ = cgmacros.prepare(tmp_path, POLICY["cgmacros"])
    assert len(cases) == 1
    assert cases[0]["observed_outcome"]["primary_device"] == (
        "dexcom_mg_dl" if dexcom else "libre_mg_dl"
    )
    if dexcom:
        assert cases[0]["observed_outcome"]["positive_iauc_120_mg_dl_min"] == "2400"
    else:
        assert audit[0]["devices"]["dexcom_mg_dl"]["missing_values"] == 136
    assert "amount_raw" not in json.dumps(cases[0]["input"])
    validate_case("cgmacros", cases[0], POLICY)
    cases[0]["input"]["prior_activity"]["future_glucose"] = "120"
    with pytest.raises(ValueError, match="input fields"):
        validate_case("cgmacros", cases[0], POLICY)


@pytest.mark.parametrize(
    ("amount", "status", "reason"),
    [
        ("", "column_absent", "amount_column_absent"),
        ("", "all_missing", "amount_missing_or_invalid"),
        ("0", "percent_like_unverified", "amount_nonpositive"),
    ],
)
def test_consumption_absence_and_nonpositive_are_different(
    tmp_path, amount, status, reason
):
    cg_fixture(tmp_path, amount=amount, amount_status=status)
    cases, audit, _ = cgmacros.prepare(tmp_path, POLICY["cgmacros"])
    assert not cases and audit[0]["primary_reason"] == reason


@pytest.mark.parametrize(("offset", "eligible"), [(120, False), (121, True)])
def test_excluded_food_still_blocks_nearby_reference_at_inclusive_boundary(
    tmp_path, offset, eligible
):
    cg_fixture(tmp_path, second_offset=offset)
    cases, _, _ = cgmacros.prepare(tmp_path, POLICY["cgmacros"])
    assert bool(cases) == eligible


def cases_and_split(counts, *, evaluation=30):
    cases, split = [], {}
    for site, count in zip("ABC", counts, strict=True):
        for i in range(count):
            pid = f"p-{site}-{i % 12}"
            split[pid] = {"role": "learning", "site": site}
            cases.append(
                {
                    "id": f"{site}-{i:04}",
                    "participant_id": pid,
                    "input": {},
                    "observed_outcome": {},
                }
            )
    for i in range(evaluation):
        pid = f"eval-{i % 6}"
        split[pid] = {"role": "evaluation", "site": None}
        cases.append(
            {
                "id": f"eval-{i:04}",
                "participant_id": pid,
                "input": {},
                "observed_outcome": {},
            }
        )
    return cases, split


def test_multisite_capacity_counts_all_records_and_does_not_approve_calls():
    cases, split = cases_and_split([292, 290, 317])
    learning = [c for c in cases if split[c["participant_id"]]["role"] == "learning"]
    batches = allocation(learning, split, 30, 2)
    assert len(batches) == 30 and sum(map(len, batches)) == 899
    assert all(
        len(batch) <= 30 and len({row["site"] for row in batch}) >= 2
        for batch in batches
    )
    smoke = proposal(cases, split, POLICY["budget"], "smoke")
    assert (
        smoke["learningCases"],
        smoke["evaluationCases"],
        smoke["normalCallsTemplate"],
    ) == (6, 6, 27)
    assert smoke["normalCallsWithSyntheticExplanation"] == 33
    assert smoke["evaluationParticipants"] == 6
    assert POLICY["budget"]["executionApproved"] is False
    assert representative(cases, 0) == []


def test_impossible_multisite_batch_is_not_silently_budgeted_as_valid():
    cases, split = cases_and_split([2, 0, 100], evaluation=0)
    with pytest.raises(ValueError, match="multisite"):
        allocation(cases, split, 30, 2)


def test_nonoverlap_view_is_chronological_and_never_filters_by_outcome():
    cases = [
        {
            "id": str(i),
            "participant_id": "p",
            "provenance": {"window_start": start, "window_end": end},
            "observed_outcome": {"arbitrary": outcome},
        }
        for i, (start, end, outcome) in enumerate(
            [
                ("2021-01-01", "2021-01-05", "bad"),
                ("2021-01-02", "2021-01-06", "good"),
                ("2021-01-06", "2021-01-10", "bad"),
            ]
        )
    ]
    assert [c["id"] for c in nonoverlap(list(reversed(cases)))] == ["0", "2"]


def verified_fixture(root):
    data = root / "values.txt"
    data.write_text("immutable source")
    manifest = {
        "version": "test",
        "files": {
            "values.txt": {
                "bytes": data.stat().st_size,
                "sha256": hashlib.sha256(data.read_bytes()).hexdigest(),
            }
        },
    }
    (root / "manifest.json").write_text(json.dumps(manifest))
    digest = hashlib.sha256((root / "manifest.json").read_bytes()).hexdigest()
    (root / "COMPLETE.json").write_text(
        json.dumps({"version": "test", "manifestSha256": digest})
    )
    return {"sourceVersion": "test", "sourceManifestSha256": digest}


def test_source_file_set_and_bytes_are_bound_before_processing(tmp_path):
    policy = verified_fixture(tmp_path)
    verify_input(tmp_path, policy)
    extra = tmp_path / "stray.txt"
    extra.touch()
    with pytest.raises(ValueError, match="file set"):
        verify_input(tmp_path, policy)
    extra.unlink()
    (tmp_path / "values.txt").write_text("changed source")
    with pytest.raises(ValueError, match="checksum"):
        verify_input(tmp_path, policy)


@pytest.mark.parametrize("suffix", ["", ".partial"])
def test_existing_or_partial_output_is_never_overwritten(tmp_path, suffix):
    out = tmp_path / "out"
    existing = tmp_path / ("out" + suffix)
    existing.mkdir()
    (existing / "keep").write_text("safe")
    with pytest.raises(ValueError, match="exists"):
        build(tmp_path / "no-source", out)
    assert (existing / "keep").read_text() == "safe"
