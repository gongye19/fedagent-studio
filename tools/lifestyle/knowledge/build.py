"""冻结来源明确的完整知识小节；不生成案例、经验或效果分数。"""

from __future__ import annotations

import importlib.metadata
import re
import shutil
import sys
import tempfile
from collections import Counter
from pathlib import Path
from urllib.robotparser import RobotFileParser

from ..common import digest, jsonl, load, rows, save
from ..corpus.screen import normalize
from .extract import extract
from .fetch import PACKAGE, file_hash, valid_url, verify
from .legacy import boundary, canonical, overlaps


def section_domain(heading, fallback):
    if re.search(r"\b(diet|eating|food|nutrition|drink|sugar|salt|portion)\w*\b", heading, re.I):
        return "diet"
    if re.search(r"\b(physical activity|exercis\w*|strength|walk\w*|active|aerobic|balance exercises?)\b", heading, re.I):
        return "activity"
    return fallback


def apply_reviews(article, document_id, reviews, seen, excluded):
    for section in article["sections"] + article["reviewSections"]:
        identity = document_id + ":" + str(section["ordinal"])
        if identity in reviews:
            review = reviews[identity]
            if digest(section["text"]) != review["textDigest"]:
                raise ValueError("reviewed-section-changed: " + identity)
            if review["decision"] not in {"topic-pass", "context-only"}:
                raise ValueError("invalid-review-decision: " + identity)
            seen.add(identity)
            section["reviewDecision"] = review["decision"]
            if review["decision"] == "context-only":
                excluded.append({"id": identity, "reason": review["reason"]})
    article["sections"] = [s for s in article["sections"] if s.get("reviewDecision") != "context-only"]


def first_batch(units):
    selected = []
    for provider in ("NIH", "CDC", "NHS"):
        by_domain = {
            k: sorted((u for u in units if u["providerGroup"] == provider and u["domain"] == k), key=lambda u: digest(u["id"])) for k in ("diet", "activity")
        }
        used, picked = set(), []
        while any(by_domain.values()) and len(picked) < 10:
            for domain in ("diet", "activity"):
                while by_domain[domain]:
                    row = by_domain[domain].pop(0)
                    if row["documentId"] not in used:
                        used.add(row["documentId"])
                        picked.append(row)
                        break
                if len(picked) == 10:
                    break
        selected.extend(picked)
    return selected


def estimate(units, old_inventory):
    selected = first_batch(units)
    # Full source article is required for EACH selected section, not just its paragraph.
    context = sum(len(u["fullArticleText"]) + len(u["text"]) + 2000 for u in selected)
    cases, rubrics = 24, 341  # same fixed first 24 HB cases from T146, checked below by caller
    counts = {"firstUnits": len(selected), "generation": 3 * len(selected) + 2, "recommendationAnswers": 2 * cases, "individualRubricGrades": 2 * rubrics}
    counts["totalBeforeRetries"] = counts["generation"] + counts["recommendationAnswers"] + counts["individualRubricGrades"]
    return {
        "status": "estimate-only-no-budget-approval",
        "first": counts,
        "selectedUnitIds": [u["id"] for u in selected],
        "firstFullContextChars": context,
        "firstGenerationInputTokenPlanningRange": [round(3 * context * 0.2), 3 * context],
        "allUnitsGenerationArithmeticOnly": 3 * len(units) + 2,
        "fullHealthbenchEvaluationCalls": 2 * (old_inventory["evaluation"]["HealthBench"] + old_inventory["healthbenchRubrics"]),
        "notes": [
            "Full article + selected section repeated for each learning unit; token range is scenario only, not a bill or hard cap.",
            "3N+2 normal shared FoT path. Full pool is NOT one task; 30-record operational first-task cap, real context preflight still required.",
            "Existing 50-call single-record runner and new HB rubric evaluator remain pending. No business model calls.",
            "Different countries/versions/conditions kept separate, not automatically merged into universal numerical advice.",
        ],
    }


def build(directory: Path, legacy: Path, smoke: Path):
    registry = load(PACKAGE / "registry.json")
    reviews = load(PACKAGE / "review-policy.json")
    python_version = ".".join(map(str, sys.version_info[:3]))
    versions = {name: importlib.metadata.version(name) for name in registry["dependencies"]}
    if versions != registry["dependencies"] or python_version != registry["python"]:
        raise ValueError("knowledge-dependency-version-mismatch")
    old = boundary(legacy, smoke)
    paths = (
        sorted(PACKAGE.glob("*.py"))
        + sorted(PACKAGE.glob("*.json*"))
        + [PACKAGE / "requirements.txt", PACKAGE.parent / "common.py", PACKAGE.parent / "corpus" / "screen.py"]
    )
    code = {str(p.relative_to(PACKAGE.parent)): file_hash(p) for p in paths}
    sources = rows(PACKAGE / "sources.jsonl")
    robots = {}
    for policy in registry["policies"]:
        path = directory / "raw" / policy["file"]
        verify(path, policy)
        if policy["kind"] == "robots":
            robot = RobotFileParser()
            robot.parse(path.read_text().splitlines())
            robots[policy["host"]] = robot
    for source in sources:
        verify(directory / "raw" / source["file"], source)
        valid_url(source["requestedUrl"], source["host"])
        valid_url(source["finalUrl"], source["host"])
        if not all(robots[source["host"]].can_fetch("FedAgentStudio-Research", url) for url in (source["requestedUrl"], source["finalUrl"])):
            raise ValueError("source-disallowed-by-archived-robots")
    fingerprint = digest({"code": code, "versions": versions, "python": python_version, "legacyInputs": old["files"]})
    target = directory / "prepared"
    if target.exists():
        manifest = load(target / "manifest.json")
        if digest({k: v for k, v in manifest.items() if k != "manifestDigest"}) != manifest.get("manifestDigest"):
            raise ValueError("knowledge-manifest-corrupted")
        if manifest["fingerprint"] != fingerprint:
            raise ValueError("knowledge-input-changed; use a new directory")
        if {p.name for p in target.iterdir()} != set(manifest["outputs"]) | {"manifest.json"}:
            raise ValueError("knowledge-output-set-changed")
        for name, expected in manifest["outputs"].items():
            if file_hash(target / name) != expected:
                raise ValueError("knowledge-output-corrupted")
        return manifest
    articles, units, excluded, audit = [], [], [], []
    seen_reviews = set()
    seen_urls, seen_bodies, seen_passages = set(), set(), {}
    for source in sources:
        if source["id"] in registry.get("exclusions", {}):
            excluded.append({"id": source["id"], "url": source["requestedUrl"], "reason": registry["exclusions"][source["id"]]})
            continue
        try:
            parsed = extract((directory / "raw" / source["file"]).read_bytes(), source["publisher"])
        except ValueError as error:
            excluded.append({"id": source["id"], "url": source["requestedUrl"], "reason": str(error)})
            continue
        article = {**source, **parsed}
        apply_reviews(article, source["id"], reviews, seen_reviews, excluded)
        url, body_hash = canonical(source["finalUrl"]), digest(normalize(article["fullText"]))
        if url in seen_urls or body_hash in seen_bodies:
            excluded.append({"id": source["id"], "reason": "duplicate-document"})
            continue
        matches = overlaps(article, old, registry["similarity"])
        audit.extend({"documentId": source["id"], **hit} for hit in matches)
        if any(hit["kind"] == "protected" for hit in matches):
            excluded.append({"id": source["id"], "reason": "protected-legacy-overlap"})
            continue
        if not article["sections"]:
            excluded.append({"id": source["id"], "reason": "no-qualified-sections"})
            continue
        seen_urls.add(url)
        seen_bodies.add(body_hash)
        article["overlapsExistingKnowledge"] = bool(matches)
        article["bodySha256"] = body_hash
        article["reuse"] = registry["reuse"][source["publisher"]]
        articles.append(article)
        for section in article["sections"]:
            identity = source["id"] + ":" + str(section["ordinal"])
            passage = digest(normalize(section["text"]))
            if passage in seen_passages:
                audit.append({"documentId": source["id"], "reason": "shared-section-text", "with": seen_passages[passage]})
            seen_passages[passage] = identity
            units.append(
                {
                    **{
                        k: source[k]
                        for k in ("publisher", "providerGroup", "region", "topic", "population", "retrievedAt", "requestedUrl", "finalUrl", "policyIds")
                    },
                    **section,
                    "id": identity,
                    "documentId": source["id"],
                    "domain": section_domain(section["heading"], source["domain"]),
                    "fullArticleText": article["fullText"],
                    "sourceTitle": article["title"],
                    "bodySha256": body_hash,
                    "cautions": article["cautions"],
                    "sourceDates": article["sourceDates"],
                    "reuse": article["reuse"],
                    "reviewStatus": "rule-screened-candidate-not-clinically-reviewed",
                    "uploadableProcessRecord": False,
                }
            )
        excluded.extend({"documentId": source["id"], **row} for row in article["reviewSections"])
    if set(reviews) != seen_reviews:
        raise ValueError("review-policy-unmatched: " + ",".join(sorted(set(reviews) - seen_reviews)))
    inventory = {
        "registeredSnapshots": len(sources),
        "usableArticles": len(articles),
        "logicalSections": len(units),
        "distinctSectionTexts": len(seen_passages),
        "updatedExistingKnowledgeArticles": sum(a["overlapsExistingKnowledge"] for a in articles),
        "articlesByPublisher": dict(sorted(Counter(a["publisher"] for a in articles).items())),
        "sectionsByPublisher": dict(sorted(Counter(u["publisher"] for u in units).items())),
        "sectionsByRegion": dict(sorted(Counter(u["region"] for u in units).items())),
        "sectionsByDomain": dict(sorted(Counter(u["domain"] for u in units).items())),
        "sectionsByTopic": dict(sorted(Counter(u["topic"] for u in units).items())),
        "excludedReasons": dict(sorted(Counter(r["reason"] for r in excluded).items())),
    }
    minimums = registry["minimums"]
    inventory["initialDemoKnowledgeTargetMet"] = (
        len(articles) >= minimums["articles"]
        and len(inventory["sectionsByTopic"]) >= minimums["topics"]
        and len(seen_passages) >= minimums["sections"]
        and all(inventory["sectionsByDomain"].get(domain, 0) >= minimums["eachDomain"] for domain in ("diet", "activity"))
    )
    samples = []
    for publisher in sorted(inventory["sectionsByPublisher"]):
        samples.extend(sorted((u for u in units if u["publisher"] == publisher), key=lambda u: digest(u["id"]))[:5])
    old_inventory = load(legacy / "inventory.json")
    old_calls = load(legacy / "call-estimates.json")["proposals"]["first-recommendation-batch"]["baseCallsWithoutRetriesOrProbe"]
    if old_calls["recommendationAnswers"] != 48 or old_calls["individualRubricGrades"] != 682:
        raise ValueError("legacy-first-evaluation-counts-changed")
    budget = estimate(units, old_inventory)
    with tempfile.TemporaryDirectory(dir=directory, prefix=".knowledge-") as temporary:
        output = Path(temporary)
        for name, value in (
            ("articles", articles),
            ("knowledge-units", units),
            ("excluded", excluded),
            ("overlap-audit", audit),
            ("samples-to-review", samples),
        ):
            jsonl(output / (name + ".jsonl"), value)
        save(output / "inventory.json", inventory)
        save(output / "call-estimates.json", budget)
        manifest = {
            "schema": "lifestyle-guidance/1",
            "fingerprint": fingerprint,
            "code": code,
            "legacyInputs": old["files"],
            "dependencies": versions,
            "registry": registry,
            "inventory": inventory,
            "outputs": {p.name: file_hash(p) for p in sorted(output.iterdir())},
        }
        manifest["manifestDigest"] = digest(manifest)
        save(output / "manifest.json", manifest)
        shutil.move(str(output), str(target))
    return manifest
