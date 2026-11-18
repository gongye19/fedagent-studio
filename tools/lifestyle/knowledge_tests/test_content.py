import pytest

from tools.lifestyle.common import digest, jsonl, save
from tools.lifestyle.knowledge.build import apply_reviews, estimate, first_batch, section_domain
from tools.lifestyle.knowledge.extract import extract
from tools.lifestyle.knowledge.fetch import file_hash
from tools.lifestyle.knowledge.legacy import boundary, canonical, overlaps, shingles

PROSE = "Choose vegetables and whole grains. Start slowly and ask your clinician about restrictions. " * 5


def page(content, wrapper="article"):
    return f"<html><h1>Healthy activity</h1><{wrapper}>{content}</{wrapper}></html>".encode()


def test_preserves_context_hierarchy_lists_table_and_connector():
    result = extract(
        page(
            f"<p>{PROSE}</p><h2>Plan</h2><h3>Safety</h3><p>{PROSE}</p>"
            "<ul><li>Walk<ul><li>Start gently</li></ul></li></ul>AND"
            "<table><tr><th>Food</th><th>Amount</th></tr><tr><td>Beans</td><td>Half cup</td></tr></table>"
            "<nav>REMOVE-NAV</nav><!--REMOVE-COMMENT--><script>REMOVE-SCRIPT</script>"
        ),
        "NHS",
    )
    section = result["sections"][1]
    assert section["heading"] == "Plan" and "Safety" in section["text"]
    assert "  - Start gently" in section["text"] and "AND" in section["text"]
    assert "Food | Amount\nBeans | Half cup" in section["text"]
    assert PROSE.strip() in result["fullText"] and "REMOVE" not in result["fullText"]


@pytest.mark.parametrize("publisher", ["CDC", "NIDDK", "NHLBI"])
def test_no_body_fallback(publisher):
    with pytest.raises(ValueError, match="selector-missing"):
        extract(page(f"<p>{PROSE}</p>"), publisher)


def test_nhlbi_real_wrapper_and_dates():
    raw = page(
        f'<div class="field--name-field-component-sections"><p>{PROSE}</p>'
        "<h2>Walking</h2><p>Start walking daily. " + PROSE + "</p></div><p>Last updated on February 25, 2026</p>"
    )
    result = extract(raw, "NHLBI")
    assert "Last updated on February 25, 2026" in result["sourceDates"]
    assert "February" not in result["fullText"]


def test_references_short_sections_and_hubs_not_counted():
    result = extract(page(f"<p>{PROSE}</p><h2>Further information</h2><p>{PROSE}</p><h2>Small</h2><p>Try walking.</p>"), "NHS")
    assert len(result["sections"]) == 1
    assert {r["reason"] for r in result["reviewSections"]} == {"reference-or-navigation", "short-or-not-actionable"}
    with pytest.raises(ValueError, match="directory-not-guidance"):
        extract(page(f'<div class="nhsuk-hub-key-links">Links</div><p>{PROSE}</p>'), "NHS")


def test_oversize_keeps_context_but_not_learning_units():
    result = extract(page("<p>" + PROSE * 100 + "</p>"), "NHS")
    assert len(result["fullText"]) > 40000 and not result["sections"]
    assert result["reviewSections"][0]["reason"] == "full-context-oversize"


def test_renamed_document_protection_uses_body_not_only_url():
    prose = " ".join(f"word{i}" for i in range(100))
    prior = {"id": "old", "url": canonical("http://www2.niddk.nih.gov/old/"), "title": "What I need to know about diabetes", "shingles": shingles(prose)}
    article = {
        "requestedUrl": "https://www.niddk.nih.gov/new",
        "finalUrl": "https://www.niddk.nih.gov/new",
        "title": "Healthy living with diabetes",
        "fullText": prose,
    }
    hits = overlaps(
        article,
        {"protected": [prior], "training": [], "caseQuestions": []},
        {"nearTitleRatio": 0.85, "sharedShingles": 25, "reviewContainment": 0.35, "excludeContainment": 0.8},
    )
    assert hits[0]["kind"] == "protected" and not hits[0]["urlMatch"]
    assert canonical("http://www2.niddk.nih.gov/OLD/?x=1#top") == prior["url"]


@pytest.mark.parametrize(
    ("old_url", "old_title", "new_url", "new_title"),
    [
        (
            "https://www.niddk.nih.gov/health-information/health-topics/digestive-diseases/crohns-disease/Pages/facts.aspx",
            "Crohn's Disease",
            "https://www.niddk.nih.gov/health-information/digestive-diseases/crohns-disease/eating-diet-nutrition",
            "Nutrition guidance",
        ),
        ("https://www.nhlbi.nih.gov/health/dash-eating-plan", "DASH eating plan", "https://www.nhlbi.nih.gov/health/dash/living-with-dash", "Living well"),
    ],
)
def test_rewritten_successors_stay_protected_without_shared_text(old_url, old_title, new_url, new_title):
    old = {"protected": [{"id": "heldout", "url": canonical(old_url), "title": old_title, "shingles": set()}], "training": [], "caseQuestions": []}
    article = {"requestedUrl": new_url, "finalUrl": new_url, "title": new_title, "fullText": "Completely rewritten advice."}
    hits = overlaps(article, old, {"nearTitleRatio": 0.85, "sharedShingles": 25, "reviewContainment": 0.35, "excludeContainment": 0.8})
    assert hits[0]["kind"] == "protected" and hits[0]["reason"] == "protected-topic-or-successor"


def test_video_and_quiz_stubs_are_context_only():
    result = extract(page(f"<p>{PROSE}</p><h2>Video: keep fit</h2><p>{PROSE}</p><h2>Take the Healthy Choices quiz</h2><p>{PROSE}</p>"), "NHS")
    assert len(result["sections"]) == 1
    assert len(result["reviewSections"]) == 2


def legacy_fixture(tmp_path):
    old = tmp_path / "old"
    old.mkdir()
    for name in ("reserved", "generation-candidates", "evaluation-inputs"):
        jsonl(old / (name + ".jsonl"), [])
    manifest = {"outputs": {p.name: file_hash(p) for p in old.iterdir()}}
    manifest["manifestDigest"] = digest(manifest)
    save(old / "manifest.json", manifest)
    smoke = {"training": [], "heldout": []}
    smoke["fingerprint"] = digest(smoke)
    save(tmp_path / "smoke.json", smoke)
    return old, tmp_path / "smoke.json"


def test_legacy_missing_and_corrupt_fail_closed(tmp_path):
    old, smoke = legacy_fixture(tmp_path)
    assert boundary(old, smoke)["protected"] == []
    assert boundary(old, smoke)["files"] == boundary(old.resolve(), smoke.resolve())["files"]
    (old / "reserved.jsonl").write_text("bad")
    with pytest.raises(ValueError, match="legacy-output-corrupted"):
        boundary(old, smoke)
    (old / "manifest.json").unlink()
    with pytest.raises(FileNotFoundError):
        boundary(old, smoke)


def test_domain_whole_words_and_mixed_articles():
    assert section_domain("Eating a balanced diet", "diet") == "diet"
    assert section_domain("Inactive people", "diet") == "diet"
    assert section_domain("Balance exercises", "diet") == "activity"
    assert section_domain("What should I eat?", "activity") == "activity"  # only explicit headings override
    assert section_domain("Food portions", "activity") == "diet"


def test_review_decisions_guard_text_and_surviving_or_filtered_sections():
    article = {"sections": [{"ordinal": 0, "text": "choose vegetables"}], "reviewSections": [{"ordinal": 1, "text": "read more"}]}
    reviews = {
        "a:0": {"textDigest": digest("choose vegetables"), "decision": "context-only", "reason": "test"},
        "a:1": {"textDigest": digest("read more"), "decision": "topic-pass"},
    }
    seen, excluded = set(), []
    apply_reviews(article, "a", reviews, seen, excluded)
    assert seen == set(reviews) and not article["sections"] and excluded == [{"id": "a:0", "reason": "test"}]
    reviews["a:1"]["textDigest"] = "wrong"
    with pytest.raises(ValueError, match="reviewed-section-changed"):
        apply_reviews(article, "a", reviews, set(), [])


def test_first_batch_balanced_distinct_documents_and_full_context_budget():
    units = [
        {
            "id": f"{provider}-{i}",
            "documentId": f"{provider}-{i // 2}",
            "providerGroup": provider,
            "domain": "diet" if i % 2 else "activity",
            "fullArticleText": "x" * 10000,
            "text": "short",
        }
        for provider in ("NIH", "CDC", "NHS")
        for i in range(30)
    ]
    selected = first_batch(units)
    assert len(selected) == 30 and len({u["documentId"] for u in selected}) == 30
    assert all(sum(u["providerGroup"] == p for u in selected) == 10 for p in ("NIH", "CDC", "NHS"))
    assert all(sum(u["domain"] == d for u in selected) == 15 for d in ("diet", "activity"))
    budget = estimate(units, {"evaluation": {"HealthBench": 96}, "healthbenchRubrics": 1211})
    assert budget["first"]["totalBeforeRetries"] == 822
    assert budget["firstFullContextChars"] == 30 * 12005
