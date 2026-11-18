import hashlib
import importlib
import subprocess
import sys

import httpx
import pytest

from tools.lifestyle.common import load, save
from tools.lifestyle.corpus import build as builder
from tools.lifestyle.corpus.adapters import choice, mcqa
from tools.lifestyle.corpus.budget import diverse_first_batch
from tools.lifestyle.corpus.split import partition
from tools.lifestyle.corpus_tests.test_corpus import EMPTY_POLICY, fixtures, item


def quad(identifier, **kwargs):
    return {**item(identifier, "Dietary advice " + identifier, source="MedQuAD"), "document": "5_NIDDK_QA/one.xml", "focus": "Nutrition", **kwargs}


@pytest.mark.parametrize("by_focus", [False, True])
def test_reserved_smoke_and_review_group_flags(by_focus):
    row = quad("a")
    policy = {
        **EMPTY_POLICY,
        "reservedDocuments": [] if by_focus else [row["document"]],
        "reservedFocusHashes": [hashlib.sha256(b"nutrition").hexdigest()] if by_focus else [],
    }
    training, _, reserved, review, _, _ = partition([row, {**row, "id": "b", "purpose": "review"}], policy)
    assert not training and reserved[0]["purpose"] == "reserved-smoke"
    assert review[0]["protectedGroup"] == "reserved-smoke"


def test_holdout_is_group_deterministic_even_for_review():
    group = next(str(i) for i in range(100) if int(hashlib.sha256(str(i).encode()).hexdigest(), 16) % 5 == 0)
    train, _, reserved, review, _, _ = partition([quad("a", group=group), quad("b", group=group, purpose="review")], EMPTY_POLICY)
    assert not train and reserved[0]["purpose"] == "reserved-document-holdout"
    assert review[0]["protectedGroup"] == "reserved-document-holdout"


def test_audit_exclusion_does_not_resurrect_conflicting_partner():
    rows = [item("a", "Which foods to eat?", "one"), item("b", "Which foods to eat ?", "two")]
    policy = {**EMPTY_POLICY, "samples": {"a": {"relevant": False, "reason": "ambiguous"}}}
    train, _, _, _, audit, _ = partition(rows, policy)
    assert not train and len(audit) == 2
    train, _, _, review, _, _ = partition([rows[0]], policy)
    assert not train and review[0]["reason"] == "ambiguous"


def test_new_support_matches_require_explicit_review():
    row = item("new-match", "Which dietary source supports health?")
    train, _, _, review, _, _ = partition([row], EMPTY_POLICY)
    assert not train and review[0]["reason"] == "support-unreviewed"
    approved = {**EMPTY_POLICY, "samples": {row["id"]: {"relevant": True, "reason": "reviewed-support"}}}
    train, _, _, review, _, _ = partition([row], approved)
    assert [r["id"] for r in train] == [row["id"]] and not review


def test_oversize_and_missing_explanation_cannot_enter_learning(tmp_path, monkeypatch):
    train, _, _, review, _, _ = partition([item("long", "diet " * 1000)], EMPTY_POLICY)
    assert not train and review[0]["purpose"] == "review-oversize"
    directory, sources, _ = fixtures(tmp_path, monkeypatch)
    from tools.lifestyle.corpus import adapters

    original = adapters.parquet

    def without_explanation(path):
        for row in original(path):
            yield {**row, "exp": ""}

    monkeypatch.setattr(adapters, "parquet", without_explanation)
    assert all(r["purpose"] != "learn-candidate" for r in mcqa(sources, {}))
    assert directory.exists()


def test_distinct_questions_and_diverse_first_batch():
    a = builder.candidate({**quad("a"), "question": "How to prevent diabetes?"})
    b = builder.candidate({**quad("b"), "question": "How to manage diabetes?"})
    assert a["generationInput"] != b["generationInput"]
    selected = diverse_first_batch([{**a, "site": "A", "group": "one"}, {**b, "site": "A", "group": "one"}, {**a, "id": "c", "site": "A", "group": "two"}])
    assert len(selected) == 2 and len({r["group"] for r in selected}) == 2


def test_support_question_is_complete_and_explicitly_hypothetical():
    row = builder.candidate(item("support", "Which of the following is appropriate EXCEPT?"))
    assert "A. meat" in row["generationInput"]["question"] and "B. vegetables" in row["generationInput"]["question"]
    assert "假设情境" in row["generationInput"]["profile"] and "不是提问者" in row["generationInput"]["profile"]


def test_audit_artifact_uses_the_actual_reviewed_cohort():
    raw = [item("included", "diet"), item("excluded", "exercise")]
    policy = {"samples": {"excluded": {"relevant": False, "reason": "off-target"}}}
    audited = builder.audit_samples(raw, policy)
    assert [r["id"] for r in audited] == ["excluded"]
    assert not audited[0]["topicalAudit"]["relevant"]
    assert builder.eval_input({**raw[0], "purpose": "knowledge-eval"})["contentReview"] == "rule-screened-unreviewed"


def test_repeated_options_are_not_valid_answers():
    with pytest.raises(ValueError, match="选项重复"):
        choice(["Protein", "Calcium", " calcium ", "All"], 1)


@pytest.mark.parametrize("extra_file", [False, True])
def test_manifest_or_extra_file_corruption_is_detected(tmp_path, monkeypatch, extra_file):
    directory, _, _ = fixtures(tmp_path, monkeypatch)
    builder.build(directory)
    if extra_file:
        (directory / "prepared/untracked.json").write_text("{}")
    else:
        path = directory / "prepared/manifest.json"
        j = load(path)
        j["inventory"]["generationCandidates"] = {"fake": 999}
        save(path, j)
    with pytest.raises(ValueError, match="冻结"):
        builder.build(directory)


def test_fetch_size_reuse_and_partial_cleanup(tmp_path, monkeypatch):
    fetcher = importlib.import_module("tools.lifestyle.corpus.fetch")
    raw = b"valid"
    source = {"file": "public.data", "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "url": "https://example.org/file"}
    path = tmp_path / "catalog.json"
    save(path, {"files": [source]})
    monkeypatch.setattr(fetcher, "CATALOG", path)
    original = httpx.Client
    monkeypatch.setattr(fetcher.httpx, "Client", lambda **kw: original(transport=httpx.MockTransport(lambda req: httpx.Response(200, content=raw + b"extra"))))
    with pytest.raises(ValueError, match="超过"):
        fetcher.fetch(tmp_path / "output", [])
    assert not list((tmp_path / "output").iterdir())
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / source["file"]).write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="摘要"):
        fetcher.fetch(tmp_path / "output", [cache])
    (cache / source["file"]).write_bytes(raw)
    fetcher.fetch(tmp_path / "output", [cache])
    assert (tmp_path / "output" / source["file"]).read_bytes() == raw


def test_cli_refuses_smoke_root():
    result = subprocess.run([sys.executable, "-m", "tools.lifestyle.corpus", "build", "--directory", "data/lifestyle-prep"], capture_output=True, text=True)
    assert result.returncode == 2 and "不能覆盖" in result.stderr
