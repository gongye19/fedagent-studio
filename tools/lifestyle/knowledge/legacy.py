"""固定旧实验边界；旧网址改名时仍用正文检测保留材料。"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from urllib.parse import unquote, urlsplit

from ..common import digest, load, rows
from ..corpus.screen import normalize
from .fetch import file_hash


def canonical(url):
    parsed = urlsplit(url)
    host = (parsed.hostname or "").casefold()
    if host == "www2.niddk.nih.gov":
        host = "www.niddk.nih.gov"
    return host + unquote(parsed.path).rstrip("/").casefold()


def shingles(value):
    words = normalize(value).split()
    return {tuple(words[i : i + 5]) for i in range(len(words) - 4)}


def successor_scope(url):
    value = canonical(url if "://" in url else "https://" + url)
    if value.startswith("www.nhlbi.nih.gov/health/dash"):
        return "www.nhlbi.nih.gov/dash"
    if value.startswith("www.niddk.nih.gov/"):
        parts = value.replace("/health-topics/", "/").split("/")
        if "health-information" in parts:
            start = parts.index("health-information") + 1
            if len(parts) >= start + 2:
                return "/".join([parts[0], *parts[start : start + 2]])
    return None


def focus_words(value):
    boilerplate = {"what", "i", "need", "to", "know", "about", "your", "guide", "for", "the", "and", "of", "a", "is", "are", "eating", "plan", "health"}
    return set(normalize(re.sub(r"['’]", "", value)).split()) - boilerplate


def boundary(directory, smoke_path):
    manifest_path = directory / "manifest.json"
    manifest = load(manifest_path)
    if manifest.get("manifestDigest") != digest({k: v for k, v in manifest.items() if k != "manifestDigest"}):
        raise ValueError("legacy-manifest-corrupted")
    if {p.name for p in directory.iterdir()} != set(manifest["outputs"]) | {"manifest.json"}:
        raise ValueError("legacy-output-set-changed")
    for name, expected in manifest["outputs"].items():
        if file_hash(directory / name) != expected:
            raise ValueError("legacy-output-corrupted: " + name)
    smoke = load(smoke_path)
    if smoke.get("fingerprint") != digest({k: v for k, v in smoke.items() if k != "fingerprint"}):
        raise ValueError("legacy-smoke-corrupted")
    files = {
        "corpus/" + name: file_hash(directory / name) for name in ("manifest.json", "reserved.jsonl", "generation-candidates.jsonl", "evaluation-inputs.jsonl")
    }
    files["smoke/prepared.json"] = file_hash(smoke_path)
    protected, training, cases = [], [], []
    for row in rows(directory / "reserved.jsonl") + rows(directory / "generation-candidates.jsonl"):
        if row.get("url"):
            target = training if row["purpose"] == "learn-candidate" else protected
            target.append({"id": row["id"], "url": canonical(row["url"]), "title": row.get("focus", ""), "text": row.get("reference", {}).get("answer", "")})
        elif row.get("source") == "HealthBench":
            cases.append(row["question"])
    cases.extend(row["question"] for row in rows(directory / "evaluation-inputs.jsonl"))
    for row in smoke["training"] + smoke["heldout"]:
        source = row["provenance"]["knowledge"]
        text_ = source.get("text") or "\n".join(pair["answer"] for pair in source.get("pairs", []))
        protected.append({"id": row["id"], "url": canonical(source["url"]), "title": source.get("focus", row["focus"]), "text": text_})
    for item in protected + training:
        item["shingles"] = shingles(item["text"])
    return {"files": files, "protected": protected, "training": training, "caseQuestions": sorted({normalize(q) for q in cases if len(q.split()) >= 20})}


def overlaps(article, old, thresholds):
    urls = {canonical(article["requestedUrl"]), canonical(article["finalUrl"])}
    body = shingles(article["fullText"])
    title = normalize(article["title"])
    hits = []
    for kind, items in (("protected", old["protected"]), ("training", old["training"])):
        for prior in items:
            exact = prior["url"] in urls
            shared = len(body & prior["shingles"])
            containment = shared / max(1, min(len(body), len(prior["shingles"])))
            prior_title = normalize(prior["title"])
            near_title = SequenceMatcher(None, title, prior_title, autojunk=False).ratio() >= thresholds["nearTitleRatio"]
            keywords = focus_words(prior["title"])
            source_words = focus_words(article["title"] + " " + urlsplit(article["finalUrl"]).path.replace("-", " "))
            topic_match = bool(keywords) and keywords.issubset(source_words)
            old_series = successor_scope(prior["url"])
            successor = topic_match or bool(old_series and old_series == successor_scope(article["finalUrl"]))
            near_title |= topic_match
            similar = shared >= thresholds["sharedShingles"] and containment >= thresholds["reviewContainment"] and near_title
            strong = shared >= thresholds["sharedShingles"] and containment >= thresholds["excludeContainment"]
            if exact or similar or strong or successor:
                hits.append(
                    {
                        "kind": kind,
                        "id": prior["id"],
                        "urlMatch": exact,
                        "successorOrProtectedTopic": successor,
                        "containment": round(containment, 6),
                        "reason": "protected-url-overlap"
                        if exact and kind == "protected"
                        else "protected-topic-or-successor"
                        if successor and kind == "protected"
                        else "protected-content-similar"
                        if kind == "protected"
                        else "existing-training-source",
                    }
                )
    normalized_body = normalize(article["fullText"])
    if any(q in normalized_body for q in old["caseQuestions"]):
        hits.append({"kind": "protected", "reason": "heldout-question-copied"})
    return hits
