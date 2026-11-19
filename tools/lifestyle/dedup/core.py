"""444条固定学习候选的离线查重；相似不等于可删，旧产物只读。"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import unicodedata
from collections import Counter
from itertools import combinations
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

POLICY = Path(__file__).with_name("policy.json")
STOP = set(
    [
        "the",
        "and",
        "to",
        "of",
        "a",
        "in",
        "for",
        "is",
        "you",
        "your",
        "it",
        "with",
        "as",
        "or",
        "be",
        "on",
        "are",
        "that",
        "have",
        "from",
        "this",
        "an",
        "at",
        "by",
        "more",
        "do",
        "when",
        "but",
        "also",
        "these",
        "which",
        "than",
        "they",
        "about",
        "such",
        "their",
        "has",
        "into",
        "some",
        "how",
        "what",
    ]
)
TOKEN = re.compile(r"\d+(?:[.,]\d+)*|[^\W\d_]+|[^\w\s]", re.UNICODE)
CONTEXT_ONLY = {"ddb5559333e68cf90e7f:1", "9dc1b1a54a3cb61795ff:2", "28e75ea6a6a29a05f472:6"}


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def verified(directory):
    manifest = load(directory / "manifest.json")
    # 上游旧清单使用默认JSON分隔符；不能改用本模块的紧凑编码核验它。
    legacy = {k: v for k, v in manifest.items() if k != "manifestDigest"}
    if sha(json.dumps(legacy, ensure_ascii=False, sort_keys=True).encode("utf-8")) != manifest.get("manifestDigest"):
        raise ValueError("upstream-manifest-corrupted")
    outputs = manifest["outputs"]
    if any(Path(name).name != name for name in outputs):
        raise ValueError("invalid-upstream-filename")
    if {p.name for p in directory.iterdir()} != set(outputs) | {"manifest.json"}:
        raise ValueError("upstream-output-set-changed")
    for name, expected in outputs.items():
        if sha((directory / name).read_bytes()) != expected:
            raise ValueError("upstream-output-corrupted: " + name)
    return sha((directory / "manifest.json").read_bytes())


def normalize(text):
    # 精确比对保留大小写，避免mM等单位与mm混同；不删除数字、符号或否定词。
    return " ".join(unicodedata.normalize("NFC", text).split())


def url_key(url):
    parsed = urlsplit(url)
    return (parsed.netloc.casefold() + parsed.path.rstrip("/")) if parsed.netloc else ""


def adapt(knowledge, corpus):
    items = []
    guidance = rows(knowledge / "knowledge-units.jsonl")
    candidates = rows(corpus / "generation-candidates.jsonl")
    expected = Counter({"MedQuAD": 85, "MedMCQA": 14})
    if len(guidance) != 345 or Counter(r["source"] for r in candidates) != expected:
        raise ValueError("unexpected-input-counts")
    excluded = {r.get("id") for r in rows(knowledge / "excluded.jsonl")}
    if not excluded >= CONTEXT_ONLY or CONTEXT_ONLY & {r["id"] for r in guidance}:
        raise ValueError("context-only-section-boundary-changed")
    for row in guidance:
        items.append(
            {
                "id": "guidance:" + row["id"],
                "source": row["publisher"],
                "layer": "guidance",
                "title": row["sourceTitle"] + " / " + row["heading"],
                "body": row["text"],
                "url": row["finalUrl"],
                "scope": {k: row[k] for k in ("population", "region", "sourceDates", "sourceTitle")},
                "original": row,
            }
        )
    for row in candidates:
        source = row["source"]
        if row["purpose"] != "learn-candidate" or row["tier"] != ("recommendation-evidence" if source == "MedQuAD" else "support-knowledge"):
            raise ValueError("unexpected-candidate-purpose")
        if source == "MedMCQA" and row["originalSplit"] != "train":
            raise ValueError("evaluation-not-allowed")
        reference = row["reference"]
        body = reference["answer"] if source == "MedQuAD" else row["question"] + "\n" + encoded(reference).decode("utf-8")
        items.append(
            {
                "id": row["id"],
                "source": source,
                "layer": "evidence" if source == "MedQuAD" else "optional-support",
                "title": row["question"],
                "body": body,
                "url": row.get("url", ""),
                "scope": {k: row.get(k) for k in ("question", "focus", "originalSplit", "tier")},
                "original": row,
            }
        )
    ids = [r["id"] for r in items]
    if len(ids) != len(set(ids)) or any(not normalize(r["body"]) for r in items):
        raise ValueError("duplicate-id-or-empty-body")
    for row in items:
        row["payloadDigest"] = sha(encoded(row["original"]))
    return sorted(items, key=lambda r: r["id"])


def features(items):
    result = {}
    for row in items:
        text = normalize(row["body"])
        tokens = TOKEN.findall(text.casefold())  # 仅候选检索忽略大小写，不能据此合并。
        result[row["id"]] = {
            "text": text,
            "words": set(tokens) - STOP,
            "shingles": {tuple(tokens[i : i + 5]) for i in range(len(tokens) - 4)},
        }
    counts = Counter(word for f in result.values() for word in f["words"])
    idf = {word: math.log((1 + len(items)) / (1 + count)) + 1 for word, count in counts.items()}
    for f in result.values():
        f["norm"] = math.sqrt(sum(idf[word] ** 2 for word in sorted(f["words"])))
    return result, idf


def compare(a, b, fs, idf, thresholds):
    left, right = fs[a["id"]], fs[b["id"]]
    shared = left["words"] & right["words"]
    cosine = sum(idf[w] ** 2 for w in sorted(shared)) / max(1, left["norm"] * right["norm"])
    jaccard = len(shared) / max(1, len(left["words"] | right["words"]))
    shingles = len(left["shingles"] & right["shingles"])
    containment = shingles / max(1, min(len(left["shingles"]), len(right["shingles"])))
    same_url = bool(url_key(a["url"])) and url_key(a["url"]) == url_key(b["url"])
    exact = left["text"] == right["text"]
    candidate = (
        exact
        or cosine >= thresholds["cosine"]
        or jaccard >= thresholds["jaccard"]
        or (shingles >= thresholds["sharedShingles"] and containment >= thresholds["containment"])
        or (same_url and shingles >= thresholds["sameUrlShingles"])
    )
    return {
        "ids": sorted([a["id"], b["id"]]),
        "exactBody": exact,
        "cosine": round(cosine, 6),
        "jaccard": round(jaccard, 6),
        "sharedShingles": shingles,
        "containment": round(containment, 6),
        "sameUrl": same_url,
        "candidate": bool(candidate),
        "crossLayer": a["layer"] != b["layer"],
        "scopeMetadataDiffers": a["scope"] != b["scope"],
        "status": "retained-unconfirmed-overlap" if candidate else "below-lexical-threshold",
    }


def analyze(items, thresholds):
    fs, idf = features(items)
    pairs = []
    for a, b in combinations(items, 2):
        pair = compare(a, b, fs, idf, thresholds)
        if pair["candidate"]:
            pairs.append(pair)
    return pairs, fs, idf


def reconcile(knowledge, items, fs, idf, thresholds):
    by_id = {r["id"]: r for r in items}
    by_document = {}
    for row in items:
        if row["layer"] == "guidance":
            by_document.setdefault(row["original"]["documentId"], []).append(row)
    result = []
    for old in rows(knowledge / "overlap-audit.jsonl"):
        sections = by_document.get(old["documentId"], [])
        prior = by_id.get(old.get("id"))
        comparisons = [compare(section, prior, fs, idf, thresholds) for section in sections] if prior else []
        result.append(
            {
                "priorFinding": old,
                "documentIncluded": bool(sections),
                "priorRowIncluded": prior is not None,
                "sectionComparisons": comparisons,
                "note": "旧记录是文章/主题层重叠；新记录是小节/答案正文层阈值，不可相互替代或据此声称独立新增知识。",
            }
        )
    return result


def build(directory, knowledge, corpus, policy_path=None):
    policy_path = policy_path or POLICY
    if directory.exists():
        raise FileExistsError("只写新目录，不覆盖任何已有产物")
    upstream = {"knowledge": verified(knowledge), "corpus": verified(corpus)}
    policy = load(policy_path)
    if policy.get("schema") != "lifestyle-unified-dedup/1" or policy.get("mergeApprovals") != []:
        raise ValueError("merging-not-supported-without-separate-equivalence-review")
    if upstream != policy.get("expectedUpstream"):
        raise ValueError("upstream-is-not-pinned-batch")
    items = adapt(knowledge, corpus)
    pairs, fs, idf = analyze(items, policy["thresholds"])
    prior = reconcile(knowledge, items, fs, idf, policy["thresholds"])
    inventory = {
        "inputRecords": len(items),
        "comparedPairs": len(items) * (len(items) - 1) // 2,
        "exactBodyPairs": sum(p["exactBody"] for p in pairs),
        "confirmedRemovals": 0,
        "retainedRecords": len(items),
        "similarPairsRetained": len(pairs),
        "crossLayerPairsRetained": sum(p["crossLayer"] for p in pairs),
        "bySource": dict(sorted(Counter(r["source"] for r in items).items())),
        "byLayer": dict(sorted(Counter(r["layer"] for r in items).items())),
        "priorAuditFindings": len(prior),
        "priorIncludedTrainingOverlapArticles": len(
            {p["priorFinding"]["documentId"] for p in prior if p["documentIncluded"] and p["priorFinding"].get("kind") == "training"}
        ),
        "limitations": [
            "仅字面查重与相关性审计，不是完整语义去重或医学审核；相似对全部保留，不等于已确认重复。",
            "三层粒度不同，跨层不能合并；14条支持知识仍是可选层。不是444条互不相关的独立知识。",
            "选择题错误选项可能抬高相似度，不据此删除。不同人群/疾病/剂量/条件/地区/版本不合并。",
            "同篇文章各小节不因携带相同完整原文而合并；原文/来源/条件/许可原样保留。",
        ],
    }
    payloads = {
        "records.jsonl": b"".join(encoded(r) + b"\n" for r in items),
        "pairs.jsonl": b"".join(encoded(p) + b"\n" for p in pairs),
        "legacy-overlap.jsonl": b"".join(encoded(p) + b"\n" for p in prior),
        "mapping.json": encoded({r["id"]: r["id"] for r in items}) + b"\n",
        "inventory.json": encoded(inventory) + b"\n",
    }
    identity = {
        "upstream": upstream,
        "code": {p.name: sha(p.read_bytes()) for p in sorted(Path(__file__).parent.glob("*.py"))},
        "policy": sha(policy_path.read_bytes()),
        "policyValue": policy,
    }
    manifest = {"schema": policy["schema"], **identity, "fingerprint": sha(encoded(identity)), "outputs": {n: sha(v) for n, v in payloads.items()}}
    manifest["manifestDigest"] = sha(encoded(manifest))
    directory.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".dedup-building-", dir=directory.parent) as name:
        staging = Path(name)
        for filename, value in payloads.items():
            (staging / filename).write_bytes(value)
        (staging / "manifest.json").write_bytes(encoded(manifest) + b"\n")
        if directory.exists():
            raise FileExistsError("目标目录已存在")
        staging.rename(directory)
    return inventory


def main():
    parser = argparse.ArgumentParser(description="444候选统一离线查重，不调用模型或覆盖旧数据")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--knowledge", type=Path, default=Path("data/lifestyle-prep/knowledge/final4-20261118/prepared"))
    parser.add_argument("--corpus", type=Path, default=Path("data/lifestyle-prep/corpus/final-20261118/prepared"))
    args = parser.parse_args()
    root = Path("data/lifestyle-prep/dedup").resolve()
    output = args.output.resolve()
    if output.parent != root:
        parser.error("只允许新的data/lifestyle-prep/dedup/<批次>目录")
    print(json.dumps(build(output, args.knowledge.resolve(), args.corpus.resolve()), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
