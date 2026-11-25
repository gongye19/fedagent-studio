import importlib
import json
import subprocess
import sys
from copy import deepcopy

import pytest

from tools.lifestyle.common import digest, load, save
from tools.lifestyle.preservation.check import check, regression_control
from tools.lifestyle.preservation.fixtures import SOURCE_FILE
from tools.lifestyle.preservation.prepare import prepare, verify
from tools.lifestyle.preservation.reference import SCHEMAS, validate_reference
from tools.lifestyle.quality_audit import sha


def test_complete_pipeline_and_fresh_output_and_legacy_not_falsely_accepted(source, tmp_path):
    before = {p: sha(p) for p in source.rglob("*") if p.is_file()}
    out = tmp_path / "prepared"
    result = prepare(source, out)
    assert verify(source, out) == result
    assert result["sourceRecordsPrepared"] == 444 and result["manuallyAnnotatedReferences"] == 2
    assert result["positiveStructuralControls"] == 8 and result["rejectedAdversarialControls"] == 32
    assert result["newModelCalls"] == result["newExperiencesGenerated"] == 0
    assert not result["nativeFoTChanged"] and not result["medicalEffectivenessProven"]
    assert all(sha(p) == value for p, value in before.items())
    for row in load(out / "legacy-diagnostics.json"):
        assert not row["traceReport"]["structurePreserved"] and not row["aggregateReport"]["structurePreserved"]
        assert row["status"].startswith("legacy-format-not-structurally-verifiable")
    with pytest.raises(ValueError, match="must-be-new"):
        prepare(source, out)
    for name, value in load(out / "COMPLETE.json")["files"].items():
        assert sha(out / name) == value
    old = load(out / "references/older-adult-aerobic.json")
    old["fields"]["parameters"]["value"][0]["amount"] = 225
    save(out / "references/older-adult-aerobic.json", old)
    with pytest.raises(ValueError, match="artifact-or-code-changed"):
        verify(source, out)


@pytest.mark.parametrize("change", ["amount", "unit", "period", "intensity", "bool"])
def test_parameter_semantics_not_just_matching_number(reference, change):
    card = regression_control(reference)
    card["fields"] = deepcopy(card["fields"])
    replacement = {"amount": 225, "unit": "hours", "period": "day", "intensity": "vigorous", "bool": True}
    card["fields"]["parameters"][0]["amount" if change == "bool" else change] = replacement[change]
    result = check(reference, [card], stage="trace")
    assert not result["structurePreserved"]
    assert {i["code"] for i in result["issues"]} >= {"field-value-changed", "required-field-missing"}


def test_control_mutations_cannot_change_trusted_reference(reference):
    before = digest(reference)
    card = regression_control(reference)
    card["fields"]["parameters"][0]["amount"] = 225
    assert digest(reference) == before
    assert not check(reference, [card], stage="trace")["structurePreserved"]


def test_nonfinite_generated_value_is_a_rejection_not_a_success_or_crash(reference):
    card = regression_control(reference)
    card["fields"]["parameters"][0]["amount"] = float("nan")
    result = check(reference, [card], stage="trace")
    assert not result["structurePreserved"]
    assert any(i["code"] == "non-json-or-nonfinite-value" for i in result["issues"])


def test_inputs_changing_during_export_cannot_be_marked_complete(source, tmp_path, monkeypatch):
    module = importlib.import_module("tools.lifestyle.preservation.prepare")
    original = module.save

    def changed(path, value):
        original(path, value)
        if path.name == "summary.json":
            p = source / SOURCE_FILE
            p.write_text(p.read_text() + "\n")

    monkeypatch.setattr(module, "save", changed)
    out = tmp_path / "changed"
    with pytest.raises(ValueError, match="previous-experiment-file-changed"):
        prepare(source, out)
    assert not out.exists() and not (out.with_suffix(".partial") / "COMPLETE.json").exists()


def test_reference_identity_and_source_span_and_finite_values(reference):
    for change in ("body", "quote", "kind", "infinite", "extra"):
        broken = deepcopy(reference)
        if change == "body":
            broken["sources"][0]["body"] += " changed"
        elif change == "quote":
            broken["fields"]["population"]["support"][0]["quote"] = "not in actual source"
        elif change == "kind":
            broken["evidenceKind"] = "causal-effect"
        elif change == "infinite":
            broken["fields"]["parameters"]["value"][0]["amount"] = float("nan")
        else:
            broken["medicalEfficacyValidated"] = True
        with pytest.raises(ValueError):
            validate_reference(broken)
    card = regression_control(reference)
    altered = deepcopy(reference)
    altered["sources"][0]["metadata"]["version"] = "new-version"
    result = check(altered, [card], stage="trace")
    assert not result["structurePreserved"] and any(i["code"] == "reference-binding-changed" for i in result["issues"])


def test_split_merge_requires_actual_supporting_parents(reference):
    all_fields = regression_control(reference)["fields"]
    first = regression_control(reference, fields={"population": all_fields["population"]})
    rest = regression_control(reference, fields={k: v for k, v in all_fields.items() if k != "population"})
    first["id"], rest["id"] = "first", "rest"
    merged = regression_control(reference, stage="aggregate", parents=[first, rest])
    assert check(reference, [merged], stage="aggregate", parents=[first, rest])["structurePreserved"]
    merged["parentRefs"] = [digest(first)]
    assert not check(reference, [merged], stage="aggregate", parents=[first, rest])["structurePreserved"]
    assert not check(reference, [merged], stage="aggregate", parents=[{"fields": ["population"]}])["structurePreserved"]
    assert not check(reference, [first, first, rest], stage="trace")["structurePreserved"]


@pytest.mark.parametrize("kind", ["observational-pattern", "workflow-strategy"])
def test_other_record_kinds_preserve_evidence_tier_without_claiming_medical_validity(reference, kind):
    value = deepcopy(reference)
    evidence, source_kind, names = SCHEMAS[kind]
    value["kind"], value["evidenceKind"] = kind, evidence
    value["sources"][0]["kind"] = source_kind
    template = value["fields"]["population"]
    value["fields"] = {k: {**deepcopy(template), "value": k} for k in names}
    if kind == "observational-pattern":
        value["fields"]["subjectCount"]["value"] = 3
        value["fields"]["observationCount"]["value"] = 12
    card = regression_control(value)
    result = check(value, [card], stage="trace")
    assert result["structurePreserved"] and not result["medicalEfficacyValidated"] and not result["platformAdmission"]
    card["evidenceKind"] = "causal-effect"
    assert not check(value, [card], stage="trace")["structurePreserved"]
    if kind == "observational-pattern":
        value["fields"]["subjectCount"]["value"] = True
        with pytest.raises(ValueError, match="observation-count"):
            validate_reference(value)


def test_pinned_source_changes_stop_preparation(source, tmp_path):
    path = source / SOURCE_FILE
    path.write_text(path.read_text() + "\n")
    out = tmp_path / "bad"
    with pytest.raises(ValueError, match="snapshot-changed"):
        prepare(source, out)
    assert not out.exists() and not out.with_suffix(".partial").exists()


def test_cli_rejects_bad_card_with_machine_readable_failure(reference, tmp_path):
    card = regression_control(reference)
    card["fields"].pop("exceptions")
    save(tmp_path / "reference.json", reference)
    save(tmp_path / "cards.json", [card])
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "tools.lifestyle.preservation",
            "check",
            "--reference",
            str(tmp_path / "reference.json"),
            "--cards",
            str(tmp_path / "cards.json"),
            "--stage",
            "trace",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1 and not json.loads(result.stdout)["structurePreserved"]
