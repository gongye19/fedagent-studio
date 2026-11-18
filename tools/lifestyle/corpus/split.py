"""先保留评测，再排除训练近重复；保留编号与原因，绝不偷偷改标准答案。"""

from __future__ import annotations

from collections import defaultdict
from difflib import SequenceMatcher
from hashlib import sha256

from .screen import normalize


class SimilarityIndex:
    def __init__(self):
        self.rows = []
        self.postings = defaultdict(set)
        self.exact = defaultdict(set)
        self.comparisons = 0

    def add(self, row):
        text = normalize(row["question"])
        tokens = set(text.split())
        index = len(self.rows)
        self.rows.append((row, text, tokens))
        self.exact[text].add(index)
        for token in tokens:
            self.postings[token].add(index)

    def matches(self, row):
        text = normalize(row["question"])
        tokens = set(text.split())
        candidates = set(self.exact[text])
        # Union all shared-token buckets; no approximate blocking can silently miss a high-Jaccard pair.
        for token in tokens:
            candidates.update(self.postings[token])
        found = []
        for index in sorted(candidates):
            prior, other, words = self.rows[index]
            if min(len(tokens), len(words)) / max(len(tokens), len(words), 1) < 0.88:
                continue
            self.comparisons += 1
            overlap = len(tokens & words) / max(len(tokens | words), 1)
            if text == other or (overlap >= 0.88 and SequenceMatcher(None, text, other, autojunk=False).ratio() >= 0.88):
                found.append(prior)
        return found


def partition(rows: list[dict], policy: dict):
    audit, training, evaluation, reserved, review = [], [], [], [], []
    reserved_docs = set(policy["reservedDocuments"])
    reserved_focus = set(policy["reservedFocusHashes"])
    for row in sorted(rows, key=lambda x: x["id"]):
        purpose = row["purpose"]
        protected_group = None
        if row["source"] == "MedQuAD":
            focus_hash = sha256(normalize(row.get("focus", "")).encode()).hexdigest()
            if row.get("document") in reserved_docs or focus_hash in reserved_focus:
                protected_group = "reserved-smoke"
            elif int(sha256(row["group"].encode()).hexdigest(), 16) % 5 == 0:
                protected_group = "reserved-document-holdout"
            row = {**row, "protectedGroup": protected_group}
        if purpose == "learn-candidate":
            if protected_group:
                purpose = protected_group
            elif len(row["question"]) > 3000 or len(str(row["reference"])) > 20000:
                purpose = "review-oversize"
        row = {**row, "purpose": purpose}
        if purpose == "learn-candidate":
            training.append(row)
        elif purpose in ("recommendation-eval", "knowledge-eval"):
            evaluation.append(row)
        elif purpose.startswith("reserved") or purpose == "protected-eval":
            reserved.append(row)
        else:
            review.append(row)

    # All benchmark rows (including unselected HB) and reserved docs protect against learning leakage.
    protected = SimilarityIndex()
    for row in evaluation + reserved:
        protected.add(row)
    safe = []
    for row in training:
        overlaps = protected.matches(row)
        if overlaps:
            audit.append(
                {
                    "id": row["id"],
                    "reason": "overlaps-protected-evaluation",
                    "matches": [r["id"] for r in overlaps],
                }
            )
        else:
            safe.append(row)
    safe, duplicates, comparisons = deduplicate(safe)
    audit.extend(duplicates)
    evaluation, duplicates, eval_comparisons = deduplicate(evaluation)
    audit.extend(duplicates)
    # Audit exclusions must not resurrect another member of a contradictory answer family.
    final_training = []
    for row in safe:
        reviewed = policy.get("samples", {}).get(row["id"])
        if row["tier"] == "support-knowledge" and reviewed is None:
            review.append({**row, "purpose": "review-support-unreviewed", "reason": "support-unreviewed"})
        elif reviewed and not reviewed["relevant"]:
            review.append({**row, "purpose": "review-audited-exclusion", "reason": reviewed["reason"]})
        else:
            final_training.append(row)
    safe = final_training
    assert_separated(safe, evaluation + reserved)
    return (
        safe,
        evaluation,
        reserved,
        review,
        audit,
        protected.comparisons + comparisons + eval_comparisons,
    )


def deduplicate(rows):
    index = SimilarityIndex()
    parents = list(range(len(rows)))

    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    positions = {}
    for i, row in enumerate(rows):
        for prior in index.matches(row):
            parents[root(i)] = root(positions[prior["id"]])
        positions[row["id"]] = i
        index.add(row)
    clustered = defaultdict(list)
    for i, row in enumerate(rows):
        clustered[root(i)].append(row)
    kept, audit = [], []
    for members in clustered.values():
        answers = {normalize(r["reference"]["answerText"]) for r in members if "answerText" in r["reference"]}
        conflict = len(answers) > 1
        # MMLU option subsets: prefer more options, then stable ID. HealthBench remains one per independent prompt.
        members.sort(key=lambda r: (-len(r["reference"].get("options", [])), r["id"]))
        if not conflict:
            kept.append(members[0])
        for row in members if conflict else members[1:]:
            audit.append(
                {
                    "id": row["id"],
                    "reason": "conflicting-near-duplicate" if conflict else "near-duplicate",
                    "matches": [r["id"] for r in members if r["id"] != row["id"]],
                }
            )
    return sorted(kept, key=lambda r: r["id"]), audit, index.comparisons


def assert_separated(training, evaluation):
    left = {r["group"] for r in training}
    if left & {r["group"] for r in evaluation}:
        raise ValueError("训练／评测文档或主题组重叠")
    index = SimilarityIndex()
    for row in evaluation:
        index.add(row)
    if any(index.matches(row) for row in training):
        raise ValueError("训练／评测近重复未隔离")
