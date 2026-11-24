"""Split original participant IDs before filtering any observation outcomes."""

import hashlib


def assignments(ids, seed):
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate participant IDs")
    ordered = sorted(
        ids,
        key=lambda identifier: (
            hashlib.sha256(f"{seed}|{identifier}".encode()).hexdigest(),
            identifier,
        ),
    )
    count = (len(ordered) + 2) // 5
    result = {
        identifier: {"role": "evaluation", "site": None}
        for identifier in ordered[:count]
    }
    for index, identifier in enumerate(ordered[count:]):
        result[identifier] = {"role": "learning", "site": "ABC"[index % 3]}
    return result
