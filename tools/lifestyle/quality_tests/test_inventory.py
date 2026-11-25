import pytest

from tools.lifestyle import quality_audit as audit
from tools.lifestyle.common import digest, load, save


@pytest.fixture
def source(tmp_path):
    root = tmp_path / "data"
    for index, (name, relative, count, _) in enumerate(audit.PACKS):
        library = {f"entry-{i}": f"Text for {name} {i}" for i in range(count)}
        if index < 2:
            library["entry-0"] = "Shared exact text"
        save(root / relative / "library.json", library)
        save(root / relative / "state.json", {"status": "complete", "finalEntries": count, "libraryDigest": digest(library)})
    return root


def test_complete_readonly_inventory_and_no_overwrite(source, tmp_path):
    protected = {p: audit.sha(p) for p in source.rglob("*.json")}
    out = source / "quality/new"
    result = audit.audit(source, out)
    assert result["entries"] == 122 and result["measurementEntries"] == 13
    assert result["recommendationWorkflowEntries"] == 109
    assert len(result["exactTextDuplicateGroups"]) == 1
    assert result["modelCalls"] == 0 and not result["algorithmChanged"]
    assert load(out / "COMPLETE.json")["inventoryDigest"] == digest(result)
    assert all(audit.sha(p) == sha for p, sha in protected.items())
    with pytest.raises(ValueError, match="must-be-new"):
        audit.audit(source, out)


@pytest.mark.parametrize("corrupt", ["status", "digest"])
def test_bad_source_never_produces_completed_audit(source, tmp_path, corrupt):
    path = source / audit.PACKS[0][1] / "state.json"
    value = load(path)
    value["status" if corrupt == "status" else "libraryDigest"] = "invalid"
    save(path, value)
    out = tmp_path / "audit"
    with pytest.raises(ValueError, match="completed-receipt"):
        audit.audit(source, out)
    assert not out.exists() and not out.with_suffix(".partial").exists()


def test_source_change_during_export_cannot_be_marked_complete(source, tmp_path, monkeypatch):
    original = audit.jsonl

    def changed(path, values):
        original(path, values)
        save(source / audit.PACKS[0][1] / "library.json", {})

    monkeypatch.setattr(audit, "jsonl", changed)
    out = tmp_path / "audit"
    with pytest.raises(ValueError, match="old-experiment-file-changed"):
        audit.audit(source, out)
    assert not out.exists() and not (out.with_suffix(".partial") / "COMPLETE.json").exists()
