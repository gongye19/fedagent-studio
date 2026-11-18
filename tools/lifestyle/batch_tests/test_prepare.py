import hashlib
import importlib
import io

import pytest

from tools.lifestyle.common import digest, jsonl, load, save

subject = importlib.import_module("tools.lifestyle.batch.prepare")


def seal(directory):
    manifest = {"outputs": {p.name: subject.sha(p) for p in directory.iterdir()}}
    manifest["manifestDigest"] = digest(manifest)
    save(directory / "manifest.json", manifest)


def fixture(tmp_path, monkeypatch):
    package = tmp_path / "tools/lifestyle/batch"
    package.mkdir(parents=True)
    knowledge, corpus, run = (tmp_path / n for n in ("knowledge", "corpus", "run"))
    for p in (knowledge / "prepared", knowledge / "raw", corpus / "prepared", run):
        p.mkdir(parents=True)
    units = []
    sources = []
    for group in ("NIH", "CDC", "NHS"):
        for i in range(10):
            id_ = f"{group}-{i}"
            units.append(
                {
                    "id": id_,
                    "documentId": id_,
                    "providerGroup": group,
                    "domain": "diet",
                    "sourceTitle": "source " + id_,
                    "heading": "Eat well",
                    "fullArticleText": "Whole context including limitations.",
                    "text": "Practical recommendation.",
                    "population": "adults",
                    "region": "US",
                }
            )
            raw = id_.encode()
            (knowledge / "raw" / id_).write_bytes(raw)
            sources.append({"id": id_, "file": id_, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
    jsonl(package.parent / "knowledge/sources.jsonl", sources)
    jsonl(knowledge / "prepared/knowledge-units.jsonl", units)
    save(knowledge / "prepared/call-estimates.json", {"selectedUnitIds": [u["id"] for u in units]})
    seal(knowledge / "prepared")
    path = knowledge / "prepared/manifest.json"
    manifest = load(path)
    manifest.update({"registry": {"policies": []}, "legacyInputs": {}})
    manifest["manifestDigest"] = digest({k: v for k, v in manifest.items() if k != "manifestDigest"})
    save(path, manifest)
    cases = [{"id": f"case-{i}", "question": f"Question {i}", "messages": [{"role": "user", "content": f"Diet {i}"}]} for i in range(24)]
    references = [
        {"id": case["id"], "rubrics": [{"criterion": "kept only for grading", "points": 1} for _ in range(14 if i < 23 else 19)]}
        for i, case in enumerate(cases)
    ]
    jsonl(corpus / "prepared/evaluation-inputs.jsonl", cases)
    jsonl(corpus / "prepared/evaluation-references.jsonl", references)
    save(corpus / "prepared/call-estimates.json", {"proposals": {"first-recommendation-batch": {"selectedEvaluationIds": [c["id"] for c in cases]}}})
    seal(corpus / "prepared")
    code = b'GRADER_TEMPLATE = """Test <<conversation>> <<rubric_item>>""".strip()'
    license_ = b"MIT license fixture"
    save(
        package / "upstream.json",
        {
            "url": "https://test.invalid/code",
            "sha256": hashlib.sha256(code).hexdigest(),
            "licenseUrl": "https://test.invalid/license",
            "licenseSha256": hashlib.sha256(license_).hexdigest(),
            "templateDigest": digest("Test <<conversation>> <<rubric_item>>"),
        },
    )
    monkeypatch.setattr(subject, "PACKAGE", package)
    monkeypatch.setattr(subject, "implementation", lambda: {"fixed": "source"})
    monkeypatch.setattr(subject.urllib.request, "urlopen", lambda url, **kw: io.BytesIO(code if url.endswith("code") else license_))
    return knowledge, corpus, run


def test_freeze_fixed_selection_and_keep_rubrics_out_of_generation(tmp_path, monkeypatch):
    knowledge, corpus, run = fixture(tmp_path, monkeypatch)
    prepared = subject.prepare(run, knowledge, corpus, "test:test")
    assert len(prepared["training"]) == 30 and len(prepared["evaluationIds"]) == 24
    assert "kept only for grading" not in str(prepared["training"])
    assert all("未提供个人健康资料" in x["input"]["profile"] for x in prepared["training"])
    monkeypatch.setattr(subject.urllib.request, "urlopen", lambda *a, **kw: pytest.fail("cached prepare used network"))
    assert subject.prepare(run, knowledge, corpus, "test:test") == prepared
    with pytest.raises(ValueError, match="input-or-code-changed"):
        subject.prepare(run, knowledge, corpus, "other:model")
    (run / "inputs/extra.txt").write_text("unexpected")
    with pytest.raises(ValueError, match="output-set-changed"):
        subject.prepare(run, knowledge, corpus, "test:test")


def test_corrupt_source_or_missing_manifest_fails_before_model_use(tmp_path, monkeypatch):
    knowledge, corpus, run = fixture(tmp_path, monkeypatch)
    (knowledge / "raw/NIH-0").write_bytes(b"changed")
    with pytest.raises(ValueError, match="source-snapshot-corrupted"):
        subject.prepare(run, knowledge, corpus, "test:test")
    (knowledge / "prepared/manifest.json").unlink()
    with pytest.raises(FileNotFoundError):
        subject.prepare(run, knowledge, corpus, "test:test")
