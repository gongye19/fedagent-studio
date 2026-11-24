"""Fail-closed inputs and conservative quality labels."""

import hashlib
import io
import json
import zipfile

import pytest

from tools.lifestyle.sensors import archives, cgmacros, lifesnaps
from tools.lifestyle.sensors.build import HERE, build
from tools.lifestyle.sensors.common import Audit, Row

POLICY = json.loads((HERE / "policy.json").read_text())


@pytest.mark.parametrize(
    ("amounts", "expected"),
    [
        (["1.0", "100"], "mixed_or_unknown"),
        (["75", "100"], "percent_like_unverified"),
        (["0", "2.0"], "fraction_or_serving_like_unverified"),
    ],
)
def test_amount_scale_is_only_a_conservative_hint(amounts, expected):
    rows = [
        Row("synthetic", [i + 2], {"Amount Consumed": v}) for i, v in enumerate(amounts)
    ]
    assert cgmacros.amount_status(rows) == expected


@pytest.mark.parametrize("algorithm", ["sha256", "md5"])
def test_wrong_official_checksum_cannot_create_an_output(
    tmp_path, monkeypatch, algorithm
):
    (tmp_path / "original.zip").write_bytes(b"x")
    monkeypatch.setattr(
        archives,
        "SOURCES",
        {"original.zip": {"algorithm": algorithm, "checksum": "0" * 64, "bytes": 1}},
    )
    with pytest.raises(ValueError, match="checksum/size mismatch"):
        archives.verify_sources(tmp_path)


def test_unknown_cg_header_stops_instead_of_dropping_a_new_field(tmp_path):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr(
            "CGMacros/CGMacros-001/CGMacros-001.csv",
            "Timestamp,Libre GL,Dexcom GL,Meal Type,Unknown\n2021-05-24 12:00:00,100,99,Lunch,x\n",
        )
    with zipfile.ZipFile(buffer) as z, pytest.raises(ValueError, match="schema"):
        cgmacros.prepare(
            z,
            tmp_path,
            Audit(io.StringIO()),
            io.StringIO(),
            {"mealTypes": {"lunch": "lunch"}},
        )


def test_unknown_life_header_stops_instead_of_assuming_units(tmp_path):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        for table in lifesnaps.SURVEYS:
            z.writestr(f"scored_surveys/{table}.csv", "Unknown\nx\n")
        for table in ["daily", "hourly"]:
            z.writestr(
                f"csv_rais_anonymized/{table}_fitbit_sema_df_unprocessed.csv",
                "Unknown\nx\n",
            )
    with zipfile.ZipFile(buffer) as z, pytest.raises(ValueError, match="schema"):
        lifesnaps.prepare(z, tmp_path, Audit(io.StringIO()), io.StringIO(), POLICY)


def test_out_of_dictionary_meal_is_retained_but_flagged():
    row = Row(
        "synthetic",
        [2],
        {
            "Meal Type": "Lunch",
            "Calories": "1375",
            "Carbs": "100",
            "Protein": "10",
            "Fat": "3",
            "Fiber": "2",
        },
    )
    with zipfile.ZipFile(io.BytesIO(), "w") as z:
        result = cgmacros.meal(
            row,
            "001",
            "2021-05-24T12:00:00",
            z,
            Audit(io.StringIO()),
            POLICY,
        )
    assert (
        result["logged_nutrients"]["kcal"] == "1375" and result["nutrition_candidate"]
    )
    assert "outside_published_nutrient_range" in result["quality_flags"]


def test_existing_finished_output_is_preserved(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "finished"
    raw.mkdir()
    out.mkdir()
    (out / "do-not-touch").write_text("kept")
    with pytest.raises(ValueError, match="already exists"):
        build(raw, out)
    assert (out / "do-not-touch").read_text() == "kept"


def test_campaign_flag_is_not_a_date_truncation_rule():
    assert lifesnaps.nominal_campaign("2021-05-24") and lifesnaps.nominal_campaign(
        "2022-01-17"
    )
    assert not lifesnaps.nominal_campaign("2021-04-08")


def test_zero_stress_and_out_of_domain_fraction_are_audited_differently():
    audit = Audit(io.StringIO())
    values = lifesnaps.clean_values(
        Row(
            "synthetic",
            [2],
            {"stress_score": "0", "spo2": "101", "sleep_points_percentage": "1.1"},
        ),
        audit,
        POLICY["lifeNumericBounds"],
    )
    assert values == {"stress_score": "0", "spo2": "", "sleep_points_percentage": ""}
    assert "zero_stress_score_unverified_retained" in audit.stream.getvalue()


def test_untyped_meal_fields_are_preserved_without_inflating_typed_meals(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(cgmacros, "prepare_supplements", lambda *args: {})
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr(
            "CGMacros/CGMacros-001/CGMacros-001.csv",
            "Timestamp,Libre GL,Dexcom GL,Meal Type,Calories,Carbs,Protein,Fat,Fiber,Amount Consumed,Image path\n"
            "2021-05-24 12:00:00,100,99,Lunch,100,10,3,2,1,100,photos/a.jpg\n"
            "2021-05-24 12:01:00,101,98,,50,4,1,0.5,0,900,photos/b.jpg\n"
            "2021-05-24 12:02:00,102,97,,,,,,,,\n",
        )
        z.writestr("CGMacros/CGMacros-001/photos/a.jpg", b"synthetic reference only")
    with zipfile.ZipFile(buffer) as z:
        summary = cgmacros.prepare(
            z, tmp_path, Audit(io.StringIO()), io.StringIO(), POLICY
        )
    typed = [json.loads(s) for s in (tmp_path / "meals.jsonl").read_text().splitlines()]
    untyped = [
        json.loads(s)
        for s in (tmp_path / "untyped_meal_fields.jsonl").read_text().splitlines()
    ]
    assert len(typed) == len(untyped) == 1
    assert (
        summary["loggedMeals"] == summary["untypedMealFieldRows"] == 1
        and summary["sensorRows"] == 3
    )
    assert (
        untyped[0]["source"]["rows"] == [3]
        and untyped[0]["raw"]["Amount Consumed"] == "900"
    )


def test_official_license_alias_is_verified_and_only_pdf_may_be_missing(tmp_path):
    names = [
        "CGMacros_dateshifted365.zip",
        "DataDictionary.pdf",
        "DataDictionary_Bio.csv",
        "DataDictionary_CGMacros-00X.csv",
        "DataDictionary_Gut_Health_Test.csv",
        "DataDictionary_Microbes.csv",
        "LICENSE.txt",
    ]
    checksum = hashlib.sha256(b"").hexdigest()
    (tmp_path / "CGMacros-SHA256SUMS.txt").write_text(
        "\n".join(f"{checksum} {name}" for name in names)
    )
    for name in names:
        if name != "DataDictionary.pdf":
            (
                tmp_path / ("CGMacros-LICENSE.txt" if name == "LICENSE.txt" else name)
            ).touch()
    checks = archives.official_cg_files(tmp_path)
    assert (
        next(v for v in checks if v["officialName"] == "LICENSE.txt")["status"]
        == "verified"
    )
    assert (
        next(v for v in checks if v["officialName"] == "DataDictionary.pdf")["status"]
        == "not_downloaded"
    )
    (tmp_path / "CGMacros-LICENSE.txt").unlink()
    with pytest.raises(ValueError, match="missing.*LICENSE"):
        archives.official_cg_files(tmp_path)


def test_stray_finder_files_do_not_change_evidence_identity(tmp_path, monkeypatch):
    monkeypatch.setattr(archives, "EVIDENCE_FILES", ("support.txt",))
    (tmp_path / "support.txt").write_text("verified support")
    before = archives.evidence_files(tmp_path)
    (tmp_path / ".DS_Store").write_bytes(b"metadata")
    (tmp_path / "editor.bak").write_bytes(b"backup")
    assert archives.evidence_files(tmp_path) == before


def test_missing_named_evidence_fails_closed(tmp_path, monkeypatch):
    monkeypatch.setattr(archives, "EVIDENCE_FILES", ("support.txt",))
    with pytest.raises(ValueError, match="required evidence missing"):
        archives.evidence_files(tmp_path)
