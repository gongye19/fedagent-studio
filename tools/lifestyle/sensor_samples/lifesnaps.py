"""Calendar-relative history with a full intervening day before the sleep reference."""

import csv
from collections import Counter
from datetime import date, timedelta

from .common import number, sample_id


def profile_consensus(history, fields):
    profile, flags = {}, []
    for alias, field in fields.items():
        values = [row.get(field, "").strip() for row in history]
        if not all(values):
            profile[alias] = None
            flags.append("missing_profile:" + alias)
        elif len(set(values)) != 1:
            profile[alias] = None
            flags.append("conflicting_profile:" + alias)
        else:
            profile[alias] = values[0]
    return profile, flags


def prepare(root, policy):
    with (root / "lifesnaps/daily_fitbit_sema_df_unprocessed.csv").open(
        newline=""
    ) as stream:
        rows = list(csv.DictReader(stream))
    index = {(row["participant_id"], row["date"]): row for row in rows}
    if len(index) != len(rows):
        raise ValueError("unexpected duplicate cleaned daily keys")
    cases, audits, counts = [], [], Counter()
    for row in rows:
        pid, day = row["participant_id"], date.fromisoformat(row["date"])
        history_dates = [
            (day + timedelta(days=i)).isoformat() for i in policy["historyOffsets"]
        ]
        target_date = (day + timedelta(days=policy["targetDayOffset"])).isoformat()
        history = [index.get((pid, d)) for d in history_dates]
        target = index.get((pid, target_date))
        reasons = []
        if any(h is None for h in history):
            reasons.append("history_missing_days")
        if any(
            h and (h["activity_candidate"] != "True" or h["sleep_candidate"] != "True")
            for h in history
        ):
            reasons.append("history_ineligible_days")
        if target is None:
            reasons.append("target_missing_day")
        else:
            asleep, duration = (
                number(target["minutesAsleep"]),
                number(target["sleep_duration_minutes"]),
            )
            if (
                target["sleep_candidate"] != "True"
                or asleep is None
                or duration is None
                or not 0 < asleep <= duration <= policy["maxTargetDurationMinutes"]
            ):
                reasons.append("target_ineligible_sleep")
        identifier = sample_id("lifesnaps", pid, row["date"])
        audits.append(
            {
                "id": identifier,
                "participant_id": pid,
                "anchor": row["date"],
                "eligible": not reasons,
                "reasons": reasons,
                "primary_reason": reasons[0] if reasons else None,
                "source_rows": row["source_rows"],
            }
        )
        if reasons:
            counts[reasons[0]] += 1
            continue
        profile, flags = profile_consensus(history, policy["profileFields"])
        input_history = []
        for offset, h in zip(policy["historyOffsets"], history, strict=True):
            input_history.append(
                {
                    "day_offset": offset,
                    **{
                        alias: h[field] if number(h[field]) is not None else None
                        for alias, field in policy["historyFields"].items()
                    },
                }
            )
        cases.append(
            {
                "id": identifier,
                "participant_id": pid,
                "input": {"profile": profile, "history": input_history},
                "observed_outcome": {
                    "minutes_asleep": target["minutesAsleep"],
                    "sleep_duration_minutes": target["sleep_duration_minutes"],
                },
                "provenance": {
                    "anchor": row["date"],
                    "window_start": history_dates[0],
                    "window_end": target_date,
                    "history_dates": history_dates,
                    "target_date": target_date,
                    "history_source_rows": [h["source_rows"] for h in history],
                    "target_source_rows": target["source_rows"],
                    "source_member": "csv_rais_anonymized/daily_fitbit_sema_df_unprocessed.csv",
                    "profile_flags": flags,
                    "historical_source_flags": [h["quality_flags"] for h in history],
                    "reference_status": "mainSleep/dateOfSleep released aggregate, exact sleep start/end unavailable, observational only",
                },
            }
        )
    return (
        cases,
        audits,
        {
            "source_records": len(rows),
            "eligible": len(cases),
            "excluded": len(rows) - len(cases),
            "first_exclusion_reason": dict(counts),
        },
    )
