import json
from pathlib import Path

import pytest

from tools.lifestyle.dedup import core as d


def freeze(path, files):
    path.mkdir(parents=True, exist_ok=True)
    for name, value in files.items():
        (path / name).write_text(value)
    manifest = {"outputs": {n: d.sha((path / n).read_bytes()) for n in files}}
    manifest["manifestDigest"] = d.sha(json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode())
    (path / "manifest.json").write_text(json.dumps(manifest))


def lines(values):
    return "".join(json.dumps(v) + "\n" for v in values)


@pytest.fixture
def upstream(tmp_path, monkeypatch):
    guidance = [
        {
            "id": f"g{i}",
            "documentId": f"doc{i}",
            "publisher": "NHS",
            "sourceTitle": f"Title{i}",
            "heading": "Heading",
            "text": f"GuidanceWord{i}",
            "fullArticleText": "same full article across all sections must not drive similarity",
            "finalUrl": f"https://example.test/{i}",
            "population": "adults",
            "region": "England",
            "sourceDates": ["2026"],
        }
        for i in range(345)
    ]
    candidates = []
    for source, count in [("MedQuAD", 85), ("MedMCQA", 14)]:
        for i in range(count):
            candidates.append(
                {
                    "id": f"{source}:{i}",
                    "source": source,
                    "question": f"QuestionTemplate{i}",
                    "originalSplit": "train",
                    "purpose": "learn-candidate",
                    "tier": "recommendation-evidence" if source == "MedQuAD" else "support-knowledge",
                    "reference": {"answer": f"EvidenceWord{i}"}
                    if source == "MedQuAD"
                    else {"options": [f"OptionA{i}", f"OptionB{i}"], "answerIndex": 0, "answerText": f"OptionA{i}", "explanation": f"Explanation{i}"},
                }
            )
    k, c = tmp_path / "knowledge", tmp_path / "corpus"
    audit = [{"documentId": "doc0", "kind": "training", "id": "MedQuAD:0", "reason": "existing-training-source"}]
    freeze(
        k, {"knowledge-units.jsonl": lines(guidance), "excluded.jsonl": lines([{"id": i} for i in sorted(d.CONTEXT_ONLY)]), "overlap-audit.jsonl": lines(audit)}
    )
    freeze(c, {"generation-candidates.jsonl": lines(candidates)})
    policy = d.load(d.POLICY)
    policy["expectedUpstream"] = {"knowledge": d.verified(k), "corpus": d.verified(c)}
    path = tmp_path / "fixture-policy.json"
    path.write_bytes(d.encoded(policy))
    monkeypatch.setattr(d, "POLICY", path)
    return k, c, guidance, candidates


@pytest.mark.parametrize(
    "left,right",
    [
        ("1.5 g", "15 g"),
        ("-5 g", "5 g"),
        ("<5 g", "≥5 g"),
        ("1–2 g", "12 g"),
        ("do not increase", "do increase"),
        ("5 mM", "5 mm"),
        ("10⁵", "105"),
        ("m²", "m2"),
        ("½", "12"),
    ],
)
def test_normalization_preserves_medical_meaning(left, right):
    assert d.normalize(left) != d.normalize(right)
    assert d.TOKEN.findall(d.normalize(left)) != d.TOKEN.findall(d.normalize(right))


def test_scope_and_punctuation_are_not_deletion_triggers():
    items = [
        {"id": name, "body": text, "url": "https://example.test/same", "layer": layer, "scope": scope}
        for name, text, layer, scope in [
            ("a", "take 1.5 g; do not increase", "guidance", "adults"),
            ("b", "take 15 g; do not increase", "guidance", "adults"),
            ("c", "take 1.5 g; do not increase", "guidance", "older-adults"),
            ("d", "take 1.5 g; do not increase", "evidence", "adults"),
        ]
    ]
    pairs, _, _ = d.analyze(items, d.load(d.POLICY)["thresholds"])
    exact = [p for p in pairs if p["exactBody"]]
    assert exact and all(p["scopeMetadataDiffers"] or p["crossLayer"] for p in exact)
    assert all(p["status"] == "retained-unconfirmed-overlap" for p in pairs)


def test_adapters_use_sections_and_answers_and_keep_all_payloads(upstream):
    k, c, guidance, candidates = upstream
    items = d.adapt(k, c)
    assert len(items) == 444
    originals = {r["id"]: r for r in guidance + candidates}
    for row in items:
        assert row["original"] == originals[row["original"]["id"]]
    a = next(r for r in items if r["id"] == "guidance:g0")
    b = next(r for r in items if r["id"] == "guidance:g1")
    fs, idf = d.features(items)
    assert not d.compare(a, b, fs, idf, d.load(d.POLICY)["thresholds"])["candidate"]
    assert next(r for r in items if r["id"] == "MedQuAD:0")["body"] == "EvidenceWord0"
    mcq = next(r for r in items if r["id"] == "MedMCQA:0")
    assert all(t in mcq["body"] for t in ["QuestionTemplate0", "OptionA0", "OptionB0", "Explanation0"])


def test_mixed_exclusion_records_need_not_have_section_id(upstream):
    k, c, _, _ = upstream
    files = {p.name: p.read_text() for p in k.iterdir() if p.name != "manifest.json"}
    files["excluded.jsonl"] += lines([{"documentId": "excluded-page", "reason": "directory-not-guidance"}])
    freeze(k, files)
    assert len(d.adapt(k, c)) == 444


@pytest.mark.parametrize("change", ["content", "extra", "manifest"])
def test_upstream_tamper_fails(upstream, change):
    k, _, _, _ = upstream
    if change == "content":
        (k / "knowledge-units.jsonl").write_text("{}\n")
    elif change == "extra":
        (k / "unexpected").write_text("x")
    else:
        value = d.load(k / "manifest.json")
        value["extra"] = "changed"
        (k / "manifest.json").write_text(json.dumps(value))
    with pytest.raises(ValueError):
        d.verified(k)


def test_reject_changed_purpose_counts_and_duplicate_ids(upstream):
    k, c, _, candidates = upstream
    candidates[0]["purpose"] = "evaluation"
    freeze(c, {"generation-candidates.jsonl": lines(candidates)})
    with pytest.raises(ValueError, match="purpose"):
        d.adapt(k, c)
    candidates[0]["purpose"] = "learn-candidate"
    candidates[1]["id"] = candidates[0]["id"]
    freeze(c, {"generation-candidates.jsonl": lines(candidates)})
    with pytest.raises(ValueError, match="duplicate-id"):
        d.adapt(k, c)
    freeze(c, {"generation-candidates.jsonl": lines(candidates[:-1])})
    with pytest.raises(ValueError, match="counts"):
        d.adapt(k, c)


def test_no_implicit_or_cross_layer_merging(upstream, tmp_path):
    k, c, _, _ = upstream
    policy = d.load(d.POLICY)
    policy["mergeApprovals"] = [{"from": "MedMCQA:0", "to": "guidance:g0"}]
    path = tmp_path / "policy.json"
    path.write_text(json.dumps(policy))
    with pytest.raises(ValueError, match="merging-not-supported"):
        d.build(tmp_path / "result", k, c, path)


def test_self_consistent_but_different_batch_is_rejected(upstream, tmp_path):
    k, c, guidance, _ = upstream
    guidance[0]["text"] = "a changed but internally consistent upstream"
    files = {p.name: p.read_text() for p in k.iterdir() if p.name != "manifest.json"}
    files["knowledge-units.jsonl"] = lines(guidance)
    freeze(k, files)
    with pytest.raises(ValueError, match="not-pinned"):
        d.build(tmp_path / "result", k, c)


def test_protected_and_absent_old_findings_are_preserved(upstream):
    k, c, _, _ = upstream
    audit = [
        {"documentId": "doc0", "kind": "training", "id": "MedQuAD:0"},
        {"documentId": "doc1", "kind": "protected", "id": "outside"},
        {"documentId": "excluded-doc", "kind": "training", "id": "MedQuAD:1"},
        {"documentId": "doc2", "kind": "training", "id": "outside"},
    ]
    (k / "overlap-audit.jsonl").write_text(lines(audit))
    items = d.adapt(k, c)
    fs, idf = d.features(items)
    result = d.reconcile(k, items, fs, idf, d.load(d.POLICY)["thresholds"])
    assert len(result) == 4
    assert result[1]["documentIncluded"] and not result[1]["priorRowIncluded"] and not result[1]["sectionComparisons"]
    assert not result[2]["documentIncluded"] and result[2]["priorRowIncluded"] and not result[2]["sectionComparisons"]
    assert result[3]["documentIncluded"] and not result[3]["priorRowIncluded"]
    counted = {r["priorFinding"]["documentId"] for r in result if r["documentIncluded"] and r["priorFinding"]["kind"] == "training"}
    assert counted == {"doc0", "doc2"}


def test_interrupted_write_does_not_publish_partial_directory(upstream, tmp_path, monkeypatch):
    k, c, _, _ = upstream
    write = Path.write_bytes

    def interrupted(path, value):
        if path.name == "inventory.json":
            raise OSError("simulated disk failure")
        return write(path, value)

    monkeypatch.setattr(Path, "write_bytes", interrupted)
    out = tmp_path / "never-published"
    with pytest.raises(OSError, match="disk failure"):
        d.build(out, k, c)
    assert not out.exists() and not list(tmp_path.glob(".dedup-building-*"))


def test_shared_section_audit_without_kind_is_preserved(upstream, tmp_path):
    k, c, _, _ = upstream
    files = {p.name: p.read_text() for p in k.iterdir() if p.name != "manifest.json"}
    audit = {"documentId": "doc0", "reason": "shared-section-text", "with": "another-section"}
    files["overlap-audit.jsonl"] = lines([audit])
    freeze(k, files)
    policy = d.load(d.POLICY)
    policy["expectedUpstream"]["knowledge"] = d.verified(k)
    d.POLICY.write_bytes(d.encoded(policy))
    out = tmp_path / "shared-section-audit"
    result = d.build(out, k, c)
    assert result["priorIncludedTrainingOverlapArticles"] == 0
    assert d.rows(out / "legacy-overlap.jsonl")[0]["priorFinding"] == audit


def test_build_complete_reproducible_and_reconciles_old_audit(upstream, tmp_path):
    k, c, _, _ = upstream
    out1, out2 = tmp_path / "out1", tmp_path / "out2"
    result = d.build(out1, k, c)
    assert result["inputRecords"] == result["retainedRecords"] == 444
    assert result["comparedPairs"] == 98346 and result["confirmedRemovals"] == 0
    assert result["priorIncludedTrainingOverlapArticles"] == 1
    assert len(d.rows(out1 / "records.jsonl")) == 444
    assert all(k == v for k, v in d.load(out1 / "mapping.json").items())
    assert d.rows(out1 / "legacy-overlap.jsonl")[0]["sectionComparisons"]
    d.build(out2, k, c)
    assert {p.name: p.read_bytes() for p in out1.iterdir()} == {p.name: p.read_bytes() for p in out2.iterdir()}
    with pytest.raises(FileExistsError):
        d.build(out1, k, c)
