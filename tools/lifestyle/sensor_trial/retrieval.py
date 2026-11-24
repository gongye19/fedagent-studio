"""仅输入字符串值参与词项排序；不看参考／ID，整条保留且有总量边界。"""

import re

from ..common import digest

MAX_ENTRIES, MAX_CHARS = 4, 12000


def words(value):
    return set(re.findall(r"[a-z]{2,}|[\u4e00-\u9fff]", value.lower()))


def query_words(value):
    if isinstance(value, dict):
        return set().union(*(query_words(v) for k, v in value.items() if k != "intake_status"))
    if isinstance(value, list):
        return set().union(*(query_words(v) for v in value))
    return words(value) if isinstance(value, str) else set()


def retrieve(value, library):
    if (
        not isinstance(library, dict)
        or not library
        or not all(isinstance(k, str) and isinstance(v, str) and v.strip() for k, v in library.items())
    ):
        raise ValueError("empty-or-invalid-experience-library")
    query = query_words(value)
    ranked = sorted(((len(query & words(k + " " + text)), k, text) for k, text in library.items()), key=lambda r: (-r[0], r[1]))
    selected, scores, skipped, used = {}, {}, [], 0
    for score, key, text in ranked:
        if len(selected) == MAX_ENTRIES:
            break
        size = len(key) + len(text)
        if size > MAX_CHARS - used:
            skipped.append({"id": key, "chars": size, "reason": "complete-entry-exceeds-remaining-cap"})
        else:
            selected[key], scores[key] = text, score
            used += size
    if not selected:
        raise ValueError("no-complete-experience-fits-context")
    return selected, {
        "libraryDigest": digest(library),
        "selected": list(selected),
        "scores": scores,
        "mode": "value-token-match" if any(scores.values()) else "generic-fallback",
        "allEntriesUsed": len(selected) == len(library),
        "chars": used,
        "skipped": skipped,
    }
