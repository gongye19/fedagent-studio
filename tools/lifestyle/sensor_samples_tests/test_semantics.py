"""Synthetic observations test time/identity/measurement semantics, not model output."""

import csv
import json
from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from tools.lifestyle.sensor_samples import cgmacros, lifesnaps
from tools.lifestyle.sensor_samples.build import HERE, validate_case
from tools.lifestyle.sensor_samples.common import sample_id
from tools.lifestyle.sensor_samples.metrics import macro_score, positive_area
from tools.lifestyle.sensor_samples.split import assignments

POLICY = json.loads((HERE / "policy.json").read_text())


def grid(anchor):
    return {
        (anchor + timedelta(minutes=i)).isoformat(timespec="seconds"): {
            "dexcom_mg_dl": "100",
            "libre_mg_dl": "90",
            "source_rows": str(i + 100),
            "heart_rate_bpm": "60",
            "mets": "1",
            "activity_kcal": "1",
        }
        for i in range(-60, 121)
    }


@pytest.mark.parametrize(
    ("points", "expected"),
    [
        (["-1", "1"], "0.25"),
        (["1", "-1"], "0.25"),
        (["2", "2"], "2"),
        (["-2", "-1"], "0"),
    ],
)
def test_positive_area_integrates_crossings_without_negative_area(points, expected):
    assert positive_area([Decimal(v) for v in points], Decimal(0)) == Decimal(expected)


def test_complete_minute_grid_is_required_and_missing_causes_are_distinct():
    anchor = datetime.fromisoformat("2020-01-01T12:00:00")
    data = grid(anchor)
    del data[(anchor - timedelta(minutes=5)).isoformat(timespec="seconds")]
    data[anchor.isoformat(timespec="seconds")]["dexcom_mg_dl"] = ""
    result = cgmacros.channel_window(data, anchor, "dexcom_mg_dl", POLICY["cgmacros"])
    assert (
        not result["valid"]
        and result["diagnostics"]["missing_rows"] == 1
        and result["diagnostics"]["missing_values"] == 1
    )


@pytest.mark.parametrize("boundary", ["40", "400"])
def test_device_boundaries_are_retained_with_censoring_flag(boundary):
    anchor = datetime.fromisoformat("2020-01-01T12:00:00")
    data = grid(anchor)
    data[anchor.isoformat(timespec="seconds")]["dexcom_mg_dl"] = boundary
    result = cgmacros.channel_window(data, anchor, "dexcom_mg_dl", POLICY["cgmacros"])
    assert result["valid"] and result["outcome"]["boundary_censoring_possible"]


def test_out_of_range_is_not_reported_as_a_missing_point():
    anchor = datetime.fromisoformat("2020-01-01T12:00:00")
    data = grid(anchor)
    data[anchor.isoformat(timespec="seconds")]["dexcom_mg_dl"] = "401"
    result = cgmacros.channel_window(data, anchor, "dexcom_mg_dl", POLICY["cgmacros"])
    assert (
        not result["valid"]
        and result["diagnostics"]["out_of_range"] == 1
        and result["diagnostics"]["missing_values"] == 0
    )


def test_peak_delta_can_be_negative_and_postmeal_activity_cannot_enter_input():
    anchor = datetime.fromisoformat("2020-01-01T12:00:00")
    data = grid(anchor)
    for i in range(121):
        data[(anchor + timedelta(minutes=i)).isoformat(timespec="seconds")].update(
            dexcom_mg_dl="80", heart_rate_bpm="900", mets="900", activity_kcal="900"
        )
    outcome = cgmacros.channel_window(data, anchor, "dexcom_mg_dl", POLICY["cgmacros"])[
        "outcome"
    ]
    activity = cgmacros.prior_activity(data, anchor, POLICY["cgmacros"])
    assert (
        outcome["peak_delta_mg_dl"] == "-20"
        and outcome["positive_iauc_120_mg_dl_min"] == "0"
    )
    assert (
        activity["heart_rate_bpm_mean"] == "60"
        and activity["activity_kcal_sum"] == "60"
    )


def test_prior_activity_means_have_coverage_gate_and_sums_are_not_imputed():
    anchor = datetime.fromisoformat("2020-01-01T12:00:00")
    data = grid(anchor)
    for i in range(1, 14):
        data[(anchor - timedelta(minutes=i)).isoformat(timespec="seconds")].update(
            heart_rate_bpm="", mets="", activity_kcal=""
        )
    activity = cgmacros.prior_activity(data, anchor, POLICY["cgmacros"])
    assert (
        activity["heart_rate_bpm_observed_minutes"] == 47
        and activity["heart_rate_bpm_mean"] is None
        and activity["activity_kcal_sum"] is None
    )


def test_split_uses_entire_population_and_never_reseeds_after_filtering():
    ids = [f"source:{i}" for i in range(45)]
    split = assignments(ids, POLICY["splitSeed"])
    assert sum(r["role"] == "evaluation" for r in split.values()) == 9
    assert {site: sum(r["site"] == site for r in split.values()) for site in "ABC"} == {
        "A": 12,
        "B": 12,
        "C": 12,
    }
    assert split == assignments(list(reversed(ids)), POLICY["splitSeed"])
    assert len(split) == 45  # Even a zero-sample person stays assigned.
    with pytest.raises(ValueError, match="duplicate"):
        assignments(ids + ids[:1], POLICY["splitSeed"])


def test_macro_mae_gives_people_equal_weight_and_reports_invalid_coverage():
    rows = [{"participant_id": "A", "truth": "0", "prediction": "2"}] * 10 + [
        {"participant_id": "B", "truth": "0", "prediction": "10"}
    ]
    assert macro_score(rows)["conditional_user_macro_mae"] == "6"
    result = macro_score(
        rows + [{"participant_id": "B", "truth": "10", "prediction": "NaN"}]
    )
    assert not result["complete"] and result["invalid"] == 1 and result["valid"] == 11
    assert result["participants"]["B"]["cases"] == 2


def life_fixture(root):
    directory = root / "lifesnaps"
    directory.mkdir()
    rows = []
    for day in range(1, 9):
        rows.append(
            {
                "participant_id": "lifesnaps:synthetic",
                "date": f"2021-05-{day:02}",
                "source_rows": str(day + 1),
                "activity_candidate": "True",
                "sleep_candidate": "True",
                "minutesAsleep": str(300 + day),
                "sleep_duration_minutes": "500",
                "age": "<30",
                "gender": "FEMALE",
                "bmi": "<19",
                "quality_flags": "",
                **{
                    field: "10"
                    for field in POLICY["lifesnaps"]["historyFields"].values()
                    if field != "minutesAsleep"
                },
            }
        )
    with (directory / "daily_fitbit_sema_df_unprocessed.csv").open(
        "w", newline=""
    ) as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    return rows


def test_life_embargo_relative_dates_and_overlapping_cases_need_independent_sessions(
    tmp_path,
):
    life_fixture(tmp_path)
    cases, _, _ = lifesnaps.prepare(tmp_path, POLICY["lifesnaps"])
    first = next(c for c in cases if c["provenance"]["anchor"] == "2021-05-03")
    later = next(c for c in cases if c["provenance"]["anchor"] == "2021-05-05")
    assert first["observed_outcome"]["minutes_asleep"] == "305"
    assert [h["minutes_asleep"] for h in first["input"]["history"]] == [
        "301",
        "302",
        "303",
    ]
    assert later["input"]["history"][-1]["minutes_asleep"] == "305"
    assert first["provenance"]["target_date"] == "2021-05-05"
    assert "2021" not in json.dumps(first["input"])
    assert "stateless" in POLICY["evaluation"]["execution"]
    validate_case("lifesnaps", first, POLICY)
    first["input"]["history"][0]["target"] = "305"
    with pytest.raises(ValueError, match="history fields"):
        validate_case("lifesnaps", first, POLICY)


def test_life_profile_consensus_does_not_fill_missing_or_conflicting_categories():
    fields = POLICY["lifesnaps"]["profileFields"]
    profile, flags = lifesnaps.profile_consensus(
        [
            {"age": "<30", "gender": "FEMALE", "bmi": "<19"},
            {"age": "", "gender": "MALE", "bmi": "<19"},
            {"age": "<30", "gender": "FEMALE", "bmi": "<19"},
        ],
        fields,
    )
    assert profile == {"age_group": None, "gender": None, "bmi_group": "<19"}
    assert set(flags) == {"missing_profile:age_group", "conflicting_profile:gender"}


def test_case_ids_are_opaque_and_not_based_on_outcomes():
    identifier = sample_id("cgmacros", "patient-12345", "2020-05-01T12:00:00")
    assert "12345" not in identifier and "2020" not in identifier
    assert identifier == sample_id("cgmacros", "patient-12345", "2020-05-01T12:00:00")
