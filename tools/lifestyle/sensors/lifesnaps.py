"""Clean official released aggregates, not the high-frequency BSON streams."""

from collections import Counter
from decimal import Decimal

from .common import csv_writer, emit, local_time, read_table, scaled, unique_rows

CONTEXT = [
    "ALERT",
    "HAPPY",
    "NEUTRAL",
    "RESTED/RELAXED",
    "SAD",
    "TENSE/ANXIOUS",
    "TIRED",
    "ENTERTAINMENT",
    "GYM",
    "HOME",
    "HOME_OFFICE",
    "OTHER",
    "OUTDOORS",
    "TRANSIT",
    "WORK/SCHOOL",
]
SHARED = [
    "source_index",
    "id",
    "date",
    "badgeType",
    "calories",
    "distance",
    "activityType",
    "bpm",
    "mindfulness_session",
    "scl_avg",
    "steps",
    "minutes_in_default_zone_1",
    "minutes_below_default_zone_1",
    "minutes_in_default_zone_2",
    "minutes_in_default_zone_3",
    "age",
    "gender",
    "bmi",
    "step_goal",
    "min_goal",
    "max_goal",
    "step_goal_label",
]
DAILY = [
    "nightly_temperature",
    "nremhr",
    "rmssd",
    "spo2",
    "full_sleep_breathing_rate",
    "stress_score",
    "sleep_points_percentage",
    "exertion_points_percentage",
    "responsiveness_points_percentage",
    "daily_temperature_variation",
    "filteredDemographicVO2Max",
    "lightly_active_minutes",
    "moderately_active_minutes",
    "very_active_minutes",
    "sedentary_minutes",
    "resting_hr",
    "sleep_duration",
    "minutesToFallAsleep",
    "minutesAsleep",
    "minutesAwake",
    "minutesAfterWakeup",
    "sleep_efficiency",
    "sleep_deep_ratio",
    "sleep_wake_ratio",
    "sleep_light_ratio",
    "sleep_rem_ratio",
]
SURVEYS = {
    "breq": "breq_amotivation breq_external_regulation breq_introjected_regulation breq_identified_regulation breq_intrinsic_regulation breq_self_determination",
    "panas": "positive_affect_score negative_affect_score",
    "personality": "extraversion agreeableness conscientiousness stability intellect gender ipip_extraversion_category ipip_agreeableness_category ipip_conscientiousness_category ipip_stability_category ipip_intellect_category",
    "stai": "stai_stress stai_stress_category",
    "ttm": "stage ttm_consciousness_raising ttm_dramatic_relief ttm_environmental_reevaluation ttm_self_reevaluation ttm_social_liberation ttm_counterconditioning ttm_helping_relationships ttm_reinforcement_management ttm_self_liberation ttm_stimulus_control",
}
CATEGORIES = {
    "source_index",
    "id",
    "user_id",
    "date",
    "submitdate",
    "type",
    "badgeType",
    "activityType",
    "mindfulness_session",
    "age",
    "gender",
    "bmi",
    "step_goal",
    "step_goal_label",
    "breq_self_determination",
    "stai_stress_category",
    "stage",
}
ACTIVITY_MINUTES = [
    "lightly_active_minutes",
    "moderately_active_minutes",
    "very_active_minutes",
    "sedentary_minutes",
]


def row_key(row):
    identity = row.data.get("id", row.data.get("user_id", "")).strip()
    if len(identity) != 24 or any(c not in "0123456789abcdef" for c in identity):
        raise ValueError("invalid participant ID")
    date = local_time(
        row.data.get("date", row.data.get("submitdate", "")), date_only=True
    )
    if "hour" in row.data:
        hour = Decimal(row.data["hour"])
        if (
            not hour.is_finite()
            or hour != hour.to_integral_value()
            or not 0 <= hour <= 23
        ):
            raise ValueError("invalid hour")
        return identity, date, int(hour)
    return identity, date


def clean_values(row, audit, bounds) -> dict:
    values = {}
    for field, raw in row.data.items():
        if field in CATEGORIES or field.endswith("_category"):
            values[field] = raw
        else:
            floor = None if field in bounds["negativeAllowed"] else 0
            ceiling = 100 if field in bounds["max100"] else None
            if field in bounds["max1"]:
                ceiling = 1
            values[field] = audit.number(row, field, minimum=floor, maximum=ceiling)
    # A zero's meaning is uncertain; retain it instead of silently inferring missingness.
    if values.get("stress_score") and Decimal(values["stress_score"]) == 0:
        audit.issue(
            row,
            "stress_score",
            "zero_stress_score_unverified_retained",
            row.data["stress_score"],
        )
    return values


def candidates(values) -> tuple[bool, bool, list[str]]:
    flags = []
    minutes = [values.get(field, "") for field in ACTIVITY_MINUTES]
    total = sum(Decimal(v) for v in minutes) if all(minutes) else None
    if total is not None and total > 1440:
        flags.append("activity_minutes_exceed_day")
    steps, hr = values.get("steps", ""), values.get("bpm", "")
    activity = bool(
        steps and hr and Decimal(hr) > 0 and total is not None and total <= 1440
    )
    duration, asleep = values.get("sleep_duration", ""), values.get("minutesAsleep", "")
    sleep = bool(
        duration
        and asleep
        and Decimal(duration) > 0
        and 0 < Decimal(asleep) <= Decimal(duration) / 60000
    )
    if duration and asleep and Decimal(asleep) > Decimal(duration) / 60000:
        flags.append("asleep_minutes_exceed_duration")
    return activity, sleep, flags


def nominal_campaign(date):
    return "2021-05-24" <= date <= "2021-07-26" or "2021-11-15" <= date <= "2022-01-17"


def prepare(archive, out, audit, quarantine, policy) -> dict:
    summary, participant_ids = {}, set()
    csv_members = sorted(n for n in archive.namelist() if n.endswith(".csv"))
    expected = {f"scored_surveys/{name}.csv" for name in SURVEYS} | {
        "csv_rais_anonymized/daily_fitbit_sema_df_unprocessed.csv",
        "csv_rais_anonymized/hourly_fitbit_sema_df_unprocessed.csv",
    }
    if set(csv_members) != expected:
        raise ValueError("unrecognized LifeSnaps CSV members")
    with (out / "user_days.jsonl").open("w") as days:
        for member in csv_members:
            headers, rows = read_table(archive, member, audit)
            daily, hourly = "daily_" in member, "hourly_" in member
            table = member.split("/")[-1].removesuffix(".csv")
            if daily or hourly:
                expected_headers = set(
                    SHARED + CONTEXT + (DAILY if daily else ["hour", "temperature"])
                )
            else:
                expected_headers = {
                    "source_index",
                    "user_id",
                    "type",
                    "submitdate",
                    *SURVEYS[table].split(),
                }
            if set(headers) != expected_headers:
                raise ValueError(
                    f"unrecognized LifeSnaps schema: {member}: {set(headers) ^ expected_headers}"
                )
            rows = unique_rows(rows, row_key, audit, quarantine)
            extras = [
                "participant_id",
                "source_rows",
                "energy_burned_kcal",
                "distance_raw_unverified_unit",
            ]
            if daily:
                extras += [
                    "sleep_duration_minutes",
                    "activity_candidate",
                    "sleep_candidate",
                    "quality_flags",
                ]
            stream, writer = csv_writer(out / f"{table}.csv", headers + extras)
            counts = Counter(retainedRows=len(rows))
            ids = set()
            try:
                for row in rows:
                    identity, date, *_ = row_key(row)
                    ids.add(identity)
                    values = clean_values(row, audit, policy["lifeNumericBounds"])
                    output = {
                        **values,
                        "participant_id": f"lifesnaps:{identity}",
                        "source_rows": ";".join(map(str, row.lines)),
                        "energy_burned_kcal": values.get("calories", ""),
                        "distance_raw_unverified_unit": row.data.get("distance", ""),
                    }
                    if daily:
                        participant_ids.add(identity)
                        activity, sleep, flags = candidates(values)
                        if not nominal_campaign(date):
                            flags.append("outside_nominal_campaign")
                            counts["outsideNominalCampaignDays"] += 1
                        for flag in flags:
                            audit.issue(row, "user_day", flag)
                        duration = values.get("sleep_duration", "")
                        output.update(
                            sleep_duration_minutes=scaled(
                                duration, str(Decimal(1) / 60000)
                            )
                            if duration
                            else "",
                            activity_candidate=activity,
                            sleep_candidate=sleep,
                            quality_flags=";".join(flags),
                        )
                        counts["activityCandidateDays"] += int(activity)
                        counts["sleepCandidateDays"] += int(sleep)
                        counts["bothCandidateDays"] += int(activity and sleep)
                        emit(
                            days,
                            {
                                "participant_id": output["participant_id"],
                                "local_date": date,
                                "source": row.origin(),
                                "activity_candidate": activity,
                                "sleep_candidate": sleep,
                                "quality_flags": flags,
                                "steps": values.get("steps", ""),
                                "energy_burned_kcal": values.get("calories", ""),
                                "minutes_asleep": values.get("minutesAsleep", ""),
                                "sleep_duration_minutes": output[
                                    "sleep_duration_minutes"
                                ],
                            },
                        )
                    writer.writerow(output)
            finally:
                stream.close()
            counts["participants"] = len(ids)
            summary[table] = dict(counts)
    return {
        "tables": summary,
        "participants": len(participant_ids),
        "scope": "All seven released CSVs; six BSON/metadata members preserved, not converted.",
        "warnings": [
            "Calories are energy burned, not food intake.",
            "Hourly heart-rate-zone minutes repeat daily values; do not sum across hours.",
            "Sleep-stage ratios compare the night with its 30-day average, not stage fractions.",
            "Candidate days do not establish full-day wear or intervention benefit; local dates have no timezone.",
        ],
    }
