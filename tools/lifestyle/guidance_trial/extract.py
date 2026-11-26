"""领域反思/提取、原FoT归类修正，以及保留原卡的引用聚合。"""

import json
from collections import Counter

from fedagent_fot import prompts
from fedagent_fot.parsing import validate_profile_object
from fedagent_fot.profile_repair import ProfileRepair
from fedagent_sdk.jsonutil import extract_json_object

from ..common import digest, rows, save
from .protocol import LIBRARY, SETTINGS, extraction_messages, parse_cards, parse_groups


def text_reply(text):
    if not text.strip():
        raise ValueError("empty-reflection")
    return text.strip()


def grouped_library(directory, batch, store, calls):
    namespace = "meter-" + batch
    raw = calls.one(
        namespace,
        f"units/{batch}/profile.json",
        prompts.profiling_prompt(store),
        {"max_tokens": 8192, **SETTINGS},
        extract_json_object,
    )
    ok, reason = validate_profile_object(raw, store)
    if not ok:
        repair = ProfileRepair.from_profile(raw, store)
        if repair is None:
            raise ValueError("profile-unrepairable:" + reason)
        for attempt in range(4):
            patch = (
                calls.one(
                    namespace,
                    f"units/{batch}/profile-repair-{attempt}.json",
                    repair.prompt(store, reason),
                    {"max_tokens": 8192, **SETTINGS},
                    extract_json_object,
                )
                if repair.pending
                else None
            )
            candidate = repair.apply(patch)
            if candidate is not None and validate_profile_object(candidate, store)[0]:
                raw = candidate
                break
            reason = "Assign the requested IDs exactly once to an allowed cluster."
        else:
            raise ValueError("profile-repair-exhausted")
    message = [
        {"role": "system", "content": LIBRARY},
        {
            "role": "user",
            "content": json.dumps(
                {"TRACE CARDS": store, "PROFILE": raw}, ensure_ascii=False
            ),
        },
    ]
    return calls.one(
        namespace,
        f"units/{batch}/library.json",
        message,
        {"max_tokens": 8192, **SETTINGS},
        lambda text: parse_groups(text, store),
    )


def extract(directory, plan, calls):
    records = rows(directory / "inputs/sources.jsonl")
    cards, groups, usage = {}, [], Counter()
    for offset in range(0, len(records), plan["batchSize"]):
        batch = plan["batchIds"][offset // plan["batchSize"]]
        store = {}
        for row in records[offset : offset + plan["batchSize"]]:
            key = digest(row["id"])[:24]
            reflection = calls.one(
                "meter-" + batch,
                f"units/{batch}/{key}-reflect.json",
                extraction_messages(row),
                {"max_tokens": 900, **SETTINGS},
                text_reply,
            )
            entries = calls.one(
                "meter-" + batch,
                f"units/{batch}/{key}-extract.json",
                extraction_messages(row, reflection),
                {"max_tokens": 2600, **SETTINGS},
                lambda text, row=row: parse_cards(text, row),
            )
            for index, card in enumerate(entries.values()):
                trace = f"trace_{key}_{index}"
                wrapped = {
                    "card": card,
                    "sourceId": row["id"],
                    "publisher": row["publisher"],
                    "url": row["finalUrl"],
                    "region": row["region"],
                    "sourceDates": row["sourceDates"],
                    "domain": row["domain"],
                    "topic": row["topic"],
                }
                cards[trace] = wrapped
                store[trace] = json.dumps(wrapped, ensure_ascii=False)
            usage[row["publisher"]] += 1
            save(
                directory / "progress.json",
                {
                    "phase": "extract",
                    "sourcesCompleted": sum(usage.values()),
                    "sourcesPlanned": len(records),
                    "sourceUsage": dict(usage),
                    "calls": calls.spent(),
                },
            )
            print(
                f"extracted {sum(usage.values())}/{len(records)} {row['publisher']}; {len(entries)} cards",
                flush=True,
            )
        for group in grouped_library(directory, batch, store, calls):
            groups.append({"id": f"{batch}-group-{len(groups):04d}", **group})
        save(
            directory / "partial-library.json",
            {"cards": cards, "groups": groups, "sourceUsage": dict(usage)},
        )
    if dict(usage) != plan["counts"] or len(cards) < len(records):
        raise ValueError("incomplete-source-extraction")
    # Exact member coverage guarantees aggregation does not silently drop or rewrite a card.
    if Counter(m for g in groups for m in g["members"]) != Counter(
        {k: 1 for k in cards}
    ):
        raise ValueError("final-library-coverage-invalid")
    library = {
        "protocol": plan["protocol"],
        "cards": cards,
        "groups": groups,
        "sourceUsage": dict(usage),
        "clinicalReview": False,
        "referenceAggregation": True,
    }
    library["digest"] = digest(library)
    save(directory / "experience-package.json", library)
    return library
