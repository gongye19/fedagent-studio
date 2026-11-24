"""Data-semantic tests; fixtures are synthetic and never uploaded."""

import io
import json
import zipfile
from decimal import Decimal

import pytest

from tools.lifestyle.sensors.archives import inventory
from tools.lifestyle.sensors.build import HERE, build
from tools.lifestyle.sensors.cgmacros import amount_status, meal
from tools.lifestyle.sensors.common import (
    Audit,
    Row,
    local_time,
    normalized_headers,
    read_table,
    scaled,
    unique_rows,
)
from tools.lifestyle.sensors.lifesnaps import candidates, clean_values, row_key
from tools.lifestyle.sensors.supplements import baseline

POLICY = json.loads((HERE / "policy.json").read_text())


def row(data, line=2):
    return Row("synthetic.csv", [line], data)


def audit():
    return Audit(io.StringIO())


def test_duplicate_header_positions_and_whitespace_are_preserved():
    assert normalized_headers(["subject", "Time (t)", "Time (t)", " Time (t) "]) == [
        "subject",
        "Time (t)",
        "Time (t)__2",
        "Time (t)__3",
    ]
    with pytest.raises(ValueError, match="ambiguous"):
        normalized_headers(["x", "x", "x__2"])


def test_named_columns_not_position_determine_glucose():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr("s.csv", "Dexcom GL,Libre GL\n123,84\n")
    with zipfile.ZipFile(buffer) as z:
        _, rows = read_table(z, "s.csv", audit())
    assert rows[0].data == {"Dexcom GL": "123", "Libre GL": "84"}


def test_row_width_is_never_silently_truncated():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr("s.csv", "a,b\n1,2,3\n")
    with zipfile.ZipFile(buffer) as z, pytest.raises(ValueError, match="width"):
        read_table(z, "s.csv", audit())


def test_missing_absent_invalid_and_true_zero_are_different():
    a = audit()
    r = row(
        {
            "empty": "",
            "zero": "0",
            "bad": "NaN",
            "infinite": "Infinity",
            "negative": "-1",
        }
    )
    for field in ["empty", "absent", "bad", "infinite", "negative"]:
        assert a.number(r, field, minimum=0) == ""
    assert a.number(r, "zero", minimum=0) == "0"
    assert (
        sum(a.empty.values()) == 1
        and sum(a.absent.values()) == 1
        and sum(a.events.values()) == 3
    )


def test_dedup_merges_all_origins_but_conflicts_do_not_keep_first():
    rows = [
        row({"id": "a", "v": "1", "source_index": "0"}, 2),
        row({"id": "a", "v": "1", "source_index": "1"}, 3),
        row({"id": "b", "v": "NaN"}, 4),
        row({"id": "b", "v": "Infinity"}, 5),
    ]
    a, q = audit(), io.StringIO()
    kept = unique_rows(rows, lambda r: (r.data["id"],), a, q)
    assert len(kept) == 1 and kept[0].lines == [2, 3]
    assert a.tables["synthetic.csv"] == {
        "raw": 4,
        "retained": 1,
        "duplicateMerged": 1,
        "quarantined": 2,
        "rejected": 0,
    }
    quarantined = [json.loads(s) for s in q.getvalue().splitlines()]
    assert {r["raw"]["v"] for r in quarantined} == {"NaN", "Infinity"}


@pytest.mark.parametrize("value", ["2021-2-01", "2021-02-30", "2021-05-24T00:00:00Z"])
def test_local_date_must_be_strict_and_not_guess_a_timezone(value):
    with pytest.raises(ValueError):
        local_time(value, date_only=True)


def test_units_are_not_guessed_or_double_converted():
    assert scaled("24", "0.1") == "2.4"
    assert scaled("133.8", "0.45359237") == "60.69065911"
    assert scaled("65", "2.54") == "165.1"
    assert scaled("31260000", str(Decimal(1) / 60000)) == "521"
    values = {
        "steps": "0",
        "bpm": "60",
        "lightly_active_minutes": "0",
        "moderately_active_minutes": "0",
        "very_active_minutes": "0",
        "sedentary_minutes": "1440",
        "sleep_duration": "31260000",
        "minutesAsleep": "445",
    }
    assert candidates(values) == (True, True, [])
    assert candidates({**values, "bpm": ""})[0] is False
    assert candidates({**values, "minutesAsleep": "522"})[1] is False


def test_life_categories_ratios_and_energy_are_not_misinterpreted():
    values = clean_values(
        row(
            {
                "age": "<30",
                "bmi": "<19",
                "activityType": "['Walk']",
                "sleep_deep_ratio": "1.34",
                "sleep_duration": "31260000",
                "minutesAsleep": "445",
                "calories": "2351.59",
                "stress_score": "0",
            }
        ),
        audit(),
        POLICY["lifeNumericBounds"],
    )
    assert (
        values["age"] == "<30"
        and values["bmi"] == "<19"
        and values["activityType"] == "['Walk']"
    )
    assert values["sleep_deep_ratio"] == "1.34" and values["minutesAsleep"] == "445"
    assert values["stress_score"] == "0" and values["calories"] == "2351.59"


@pytest.mark.parametrize("hour", ["0.5", "24", "NaN", "-1"])
def test_hour_key_requires_integer_0_to_23(hour):
    with pytest.raises(ValueError):
        row_key(row({"id": "a" * 24, "date": "2021-05-24", "hour": hour}))


def test_hour_accepts_published_float_text_and_ids_remain_exact():
    assert row_key(row({"id": "a" * 24, "date": "2021-05-24", "hour": "0.0"})) == (
        "a" * 24,
        "2021-05-24",
        0,
    )


def test_documented_lab_errors_removed_with_raw_and_provenance_preserved():
    r = row(
        {
            "subject": "1",
            "LDL (Cal)": "800",
            "VLDL (Cal)": "400",
            "Cho/HDL Ratio": "400",
            "A1c PDL (Lab)": "5.4",
            "Body weight": "133.8",
            "Height": "65",
        }
    )
    a = audit()
    result = baseline(r, {1}, a)
    assert (
        result["numeric_clean"]["LDL (Cal)"]
        == result["numeric_clean"]["VLDL (Cal)"]
        == ""
    )
    assert (
        result["numeric_clean"]["Cho/HDL Ratio"] == "400"
        and result["raw"]["LDL (Cal)"] == "800"
    )
    assert (
        result["numeric_clean"]["A1c PDL (Lab)"] == "5.4"
        and "unresolved" in result["hba1c_unit_status"]
    )
    assert len(a.stream.getvalue().splitlines()) == 3


def test_amount_is_not_assumed_percent_and_meal_flags_keep_raw():
    policy = POLICY
    assert (
        amount_status([row({"Amount Consumed": "1.0"})])
        == "fraction_or_serving_like_unverified"
    )
    assert (
        amount_status(
            [row({"Amount Consumed": "100"}), row({"Amount Consumed": "900"})]
        )
        == "mixed_or_unknown"
    )
    r = row(
        {
            "Meal Type": "Snacks",
            "Calories": "100",
            "Carbs": "10",
            "Protein": "5",
            "Fat": "2",
            "Fiber": "60",
            "Amount Consumed": "900",
        }
    )
    with zipfile.ZipFile(io.BytesIO(), "w") as z:
        result = meal(r, "001", "2021-01-01T12:00:00", z, audit(), policy)
    assert result["meal_type"] == "snack" and result["nutrition_candidate"]
    assert (
        "fiber_exceeds_carbs" in result["quality_flags"]
        and result["amount_consumed_raw"] == "900"
    )
    assert result["logged_nutrients"]["carbs_g"] == "10"


def test_all_zero_meal_is_not_a_candidate():
    r = row(
        {
            "Meal Type": "Lunch",
            **{f: "0" for f in ["Calories", "Carbs", "Protein", "Fat", "Fiber"]},
        }
    )
    with zipfile.ZipFile(io.BytesIO(), "w") as z:
        result = meal(
            r,
            "001",
            "2021-01-01T12:00:00",
            z,
            audit(),
            POLICY,
        )
    assert (
        not result["nutrition_candidate"]
        and "all_zero_nutrition" in result["quality_flags"]
    )


@pytest.mark.parametrize(
    "name", ["../escape.csv", "/abs.csv", "x\\y.csv", "nested.zip"]
)
def test_archive_members_are_checked_without_extraction(name):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr(name, b"data")
    with zipfile.ZipFile(buffer) as z, pytest.raises(ValueError):
        inventory(
            z,
            {"maxMemberBytes": 100, "maxArchiveBytes": 100, "maxCompressionRatio": 100},
        )


def test_finished_or_partial_build_is_not_overwritten(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "out"
    raw.mkdir()
    out.with_name("out.partial").mkdir()
    with pytest.raises(ValueError, match="already exists"):
        build(raw, out)
    assert not out.exists()
