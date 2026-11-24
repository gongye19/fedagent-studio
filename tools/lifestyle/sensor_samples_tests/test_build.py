"""A complete synthetic 45/71-person build exercises the real domain and writer paths."""

import csv
import hashlib
import json
from datetime import datetime, timedelta

import pytest

import tools.lifestyle.sensor_samples.build as builder


def write_csv(path, rows):
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def write_jsonl(path, rows):
    path.write_text("".join(json.dumps(row) + "\n" for row in rows))


def load_jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


@pytest.fixture
def synthetic_source(tmp_path, monkeypatch):
    source = tmp_path / "source"
    (source / "cgmacros").mkdir(parents=True)
    (source / "lifesnaps").mkdir()
    profiles, meals, sensors = [], [], []
    anchor = datetime.fromisoformat("2020-01-01T12:00:00")
    for i in sorted(set(range(1, 50)) - {24, 25, 37, 40}):
        pid = f"cgmacros:{i:03}"
        profiles.append(
            {
                "participant_id": pid,
                "has_sensor_data": True,
                "numeric_clean": {
                    "Age": "27",
                    "BMI": "22",
                    "Fasting GLU - PDL (Lab)": "90",
                },
                "raw": {"Gender": "F"},
                "weight_kg": "60",
                "height_cm": "165",
                "source": {"member": "synthetic-bio", "rows": [i]},
            }
        )
        meals.append(
            {
                "participant_id": pid,
                "local_timestamp": anchor.isoformat(timespec="seconds"),
                "nutrition_candidate": True,
                "quality_flags": [],
                "amount_consumed_raw": "100",
                "amount_unit_status": "percent_like_unverified",
                "meal_type": "lunch",
                "logged_nutrients": {
                    "kcal": "100",
                    "carbs_g": "10",
                    "protein_g": "3",
                    "fat_g": "2",
                    "fiber_g": "1",
                },
                "source": {"member": "synthetic-meal", "rows": [i]},
            }
        )
        for offset in range(-60, 121):
            sensors.append(
                {
                    "participant_id": pid,
                    "local_timestamp": (anchor + timedelta(minutes=offset)).isoformat(
                        timespec="seconds"
                    ),
                    "dexcom_mg_dl": "100" if offset < 0 else "120",
                    "libre_mg_dl": "90",
                    "heart_rate_bpm": "60",
                    "mets": "1",
                    "activity_kcal": "1",
                    "source_rows": str(offset + 100),
                }
            )
    write_jsonl(source / "cgmacros/participants.jsonl", profiles)
    write_jsonl(source / "cgmacros/meals.jsonl", meals)
    write_jsonl(source / "cgmacros/untyped_meal_fields.jsonl", [])
    write_csv(source / "cgmacros/sensor_grid.csv", sensors)
    days = []
    for person in range(71):
        for day in range(1, 9):
            days.append(
                {
                    "participant_id": f"lifesnaps:{person:024x}",
                    "date": f"2021-05-{day:02}",
                    "source_rows": str(day + 1),
                    "quality_flags": "",
                    "activity_candidate": "True",
                    "sleep_candidate": "True",
                    "sleep_duration_minutes": "500",
                    "minutesAsleep": str(300 + day),
                    "age": "<30",
                    "gender": "FEMALE",
                    "bmi": "<19",
                    "steps": "9000",
                    "calories": "1800",
                    "bpm": "70",
                    "lightly_active_minutes": "50",
                    "moderately_active_minutes": "15",
                    "very_active_minutes": "20",
                    "sedentary_minutes": "900",
                }
            )
    write_csv(source / "lifesnaps/daily_fitbit_sema_df_unprocessed.csv", days)
    (source / "manifest.json").write_text('{"version":"synthetic-test"}')
    (source / "ATTRIBUTION.txt").write_text(
        "Synthetic fixtures, not dataset records.\n"
    )
    # Authentication itself has separate tamper tests; all construction logic stays real.
    monkeypatch.setattr(
        builder, "verify_input", lambda *_: {"version": "synthetic-test"}
    )
    return source


def test_full_build_separates_people_and_answers_and_finishes_atomically(
    synthetic_source, tmp_path
):
    output = tmp_path / "prepared"
    summary = builder.build(synthetic_source, output)
    assert summary["cgmacros"]["roles"]["evaluation"]["samples"] == 9
    assert summary["lifesnaps"]["roles"]["evaluation"]["samples"] == 56
    for domain in ["cgmacros", "lifesnaps"]:
        training = [
            row
            for site in "ABC"
            for row in load_jsonl(output / f"learning/{domain}/site-{site}.jsonl")
        ]
        evaluation = load_jsonl(output / f"evaluation/{domain}/inputs.jsonl")
        references = load_jsonl(output / f"references/{domain}.jsonl")
        assert {r["id"] for r in references} == {r["id"] for r in evaluation}
        assert not {r["participant_id"] for r in training} & {
            r["participant_id"] for r in references
        }
        assert all(set(r) == {"id", "input"} for r in evaluation)
        assert all("input" not in r for r in references)
        assert [r["id"] for r in evaluation] == sorted(r["id"] for r in evaluation)
        if domain == "cgmacros":
            assert all(
                r["provenance"]["window_start"] == "2020-01-01T11:00:00"
                for r in training
            )
    complete = json.loads((output / "COMPLETE.json").read_text())
    manifest = json.loads((output / "manifest.json").read_text())
    assert (
        complete["manifestSha256"]
        == hashlib.sha256((output / "manifest.json").read_bytes()).hexdigest()
    )
    assert set(manifest["files"]) | {"manifest.json", "COMPLETE.json"} == {
        str(p.relative_to(output)) for p in output.rglob("*") if p.is_file()
    }
    assert not output.with_name("prepared.partial").exists()


def test_interrupted_build_cannot_appear_complete(
    synthetic_source, tmp_path, monkeypatch
):
    original = builder.dump

    def fail_before_manifest(path, value):
        if path.name == "manifest.json":
            raise OSError("synthetic interrupted write")
        return original(path, value)

    monkeypatch.setattr(builder, "dump", fail_before_manifest)
    output = tmp_path / "unfinished"
    with pytest.raises(OSError, match="interrupted"):
        builder.build(synthetic_source, output)
    assert not output.exists()
    assert output.with_name("unfinished.partial").is_dir()
    assert not (output.with_name("unfinished.partial") / "COMPLETE.json").exists()
