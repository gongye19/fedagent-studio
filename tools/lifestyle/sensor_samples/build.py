"""One atomic local preparation run. No platform, model gateway, or network imports."""

import csv
import hashlib
import json
import shutil
from collections import Counter, defaultdict
from contextlib import ExitStack
from pathlib import Path

from . import cgmacros, lifesnaps
from .budget import estimate
from .common import digest, dump, emit, load_jsonl, verify_input
from .metrics import local_baselines
from .report import render
from .split import assignments

HERE = Path(__file__).parent
ROOT = HERE.parents[2]
DEPENDENCIES = [
    "tools/lifestyle/sensors/common.py",
    "tools/lifestyle/sensors/archives.py",
    "server/plugins/records/fedagent_records/fot.yaml",
    "tools/lifestyle/corpus/calibration.json",
]


def validate_case(domain, case, policy):
    value, spec = case["input"], policy[domain]
    if set(value) != set(spec["inputKeys"]) or set(value["profile"]) != set(
        spec["profileFields"]
    ):
        raise ValueError("model input schema or profile keys changed")
    if domain == "cgmacros":
        if (
            set(value["logged_meal"]) != set(spec["mealFields"])
            or set(value["logged_meal"]["nutrition_estimates"])
            != set(spec["nutrientFields"])
            or set(value["prior_activity"]) != set(spec["activityFields"])
        ):
            raise ValueError("unexpected CG model input fields")
    else:
        if [h["day_offset"] for h in value["history"]] != spec["historyOffsets"]:
            raise ValueError("unexpected history offsets")
        if any(
            set(h) != {"day_offset", *spec["historyFields"]} for h in value["history"]
        ):
            raise ValueError("unexpected history fields")
        if (
            max(case["provenance"]["history_dates"])
            >= case["provenance"]["target_date"]
        ):
            raise ValueError("target overlaps own history")


def population_summary(ids, cases, split, audits, stats):
    samples = Counter(c["participant_id"] for c in cases)
    roles, sites = {}, {}
    for key, values in [("role", roles), ("site", sites)]:
        for group in ["learning", "evaluation"] if key == "role" else list("ABC"):
            people = [pid for pid in ids if split[pid][key] == group]
            values[group] = {
                "assigned_people": len(people),
                "people_with_samples": sum(samples[p] > 0 for p in people),
                "samples": sum(samples[p] for p in people),
            }
    reason_counts = Counter(reason for row in audits for reason in row["reasons"])
    result = {
        **stats,
        "assigned_people": len(ids),
        "people_with_samples": len(samples),
        "roles": roles,
        "sites": sites,
        "people": {pid: {**split[pid], "samples": samples[pid]} for pid in sorted(ids)},
        "zero_sample_participants": sorted(set(ids) - set(samples)),
        "all_exclusion_reasons_nonexclusive": dict(reason_counts),
    }
    if audits and "devices" in audits[0]:
        by_person = defaultdict(lambda: defaultdict(Counter))
        for row in audits:
            for device, d in row["devices"].items():
                counts = by_person[row["participant_id"]][device]
                counts["meal_windows"] += 1
                for reason, count in d.items():
                    if reason != "valid":
                        counts["windows_with_" + reason] += int(count > 0)
        result["device_window_audit_by_person"] = by_person
        result["eligible_primary_device_counts"] = dict(
            Counter(c["observed_outcome"]["primary_device"] for c in cases)
        )
    assert result["source_records"] == result["eligible"] + result["excluded"]
    assert result["eligible"] == sum(v["samples"] for v in roles.values())
    return result


def build(source: Path, out: Path):
    source, out = source.resolve(), out.resolve()
    partial = out.with_name(out.name + ".partial")
    if (
        out.exists()
        or partial.exists()
        or source.is_relative_to(out)
        or out.is_relative_to(source)
    ):
        raise ValueError("output exists/unfinished or overlaps source")
    policy = json.loads((HERE / "policy.json").read_text())
    verified = verify_input(source, policy)
    people = {
        "cgmacros": sorted(
            r["participant_id"]
            for r in load_jsonl(source / "cgmacros/participants.jsonl")
            if r["has_sensor_data"]
        )
    }
    with (source / "lifesnaps/daily_fitbit_sema_df_unprocessed.csv").open(
        newline=""
    ) as stream:
        people["lifesnaps"] = sorted(
            {r["participant_id"] for r in csv.DictReader(stream)}
        )
    if {domain: len(ids) for domain, ids in people.items()} != {
        "cgmacros": 45,
        "lifesnaps": 71,
    }:
        raise ValueError("source participant universe changed")
    splits = {
        domain: assignments(ids, policy["splitSeed"]) for domain, ids in people.items()
    }
    domains, audit_rows, summary = {}, {}, {}
    for domain, prepare in [
        ("cgmacros", cgmacros.prepare),
        ("lifesnaps", lifesnaps.prepare),
    ]:
        cases, audits, stats = prepare(source, policy[domain])
        if len({c["id"] for c in cases}) != len(cases) or any(
            c["participant_id"] not in splits[domain] for c in cases
        ):
            raise ValueError("invalid case identity")
        for case in cases:
            validate_case(domain, case, policy)
        domains[domain], audit_rows[domain] = cases, audits
        summary[domain] = population_summary(
            people[domain], cases, splits[domain], audits, stats
        )
    budget, views = estimate(domains, splits, policy["budget"])
    baselines = {
        domain: local_baselines(cases, splits[domain], policy[domain]["primaryTarget"])
        for domain, cases in domains.items()
    }
    code = {p.name: digest(p) for p in sorted(HERE.glob("*.py"))}
    identity = {
        "sourceVersion": verified["version"],
        "sourceManifestSha256": digest(source / "manifest.json"),
        "code": code,
        "dependencyCode": {name: digest(ROOT / name) for name in DEPENDENCIES},
        "policySha256": digest(HERE / "policy.json"),
    }
    version = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    partial.mkdir(parents=True, exist_ok=False)
    with ExitStack() as stack:
        index = stack.enter_context((partial / "sample_index.jsonl").open("w"))
        for domain, cases in domains.items():
            for name in [
                f"learning/{domain}",
                f"evaluation/{domain}",
                "references",
                "audit",
            ]:
                (partial / name).mkdir(parents=True, exist_ok=True)
            learning = {
                site: stack.enter_context(
                    (partial / f"learning/{domain}/site-{site}.jsonl").open("w")
                )
                for site in "ABC"
            }
            inputs = stack.enter_context(
                (partial / f"evaluation/{domain}/inputs.jsonl").open("w")
            )
            references = stack.enter_context(
                (partial / f"references/{domain}.jsonl").open("w")
            )
            audits = stack.enter_context((partial / f"audit/{domain}.jsonl").open("w"))
            for row in audit_rows[domain]:
                emit(audits, row)
            for case in sorted(cases, key=lambda c: c["id"]):
                assignment = splits[domain][case["participant_id"]]
                emit(
                    index,
                    {
                        "id": case["id"],
                        "domain": domain,
                        "participant_id": case["participant_id"],
                        **assignment,
                        "anchor": case["provenance"]["anchor"],
                        "window_start": case["provenance"]["window_start"],
                        "window_end": case["provenance"]["window_end"],
                    },
                )
                if assignment["role"] == "learning":
                    emit(
                        learning[assignment["site"]],
                        {
                            "kind": "observational-case-not-agent-dialogue",
                            **case,
                            "site": assignment["site"],
                        },
                    )
                else:
                    emit(inputs, {"id": case["id"], "input": case["input"]})
                    emit(
                        references,
                        {key: value for key, value in case.items() if key != "input"},
                    )
    for name, value in [
        ("summary.json", summary),
        ("split.json", splits),
        ("policy.json", policy),
        ("budget.json", budget),
        ("nonoverlap_view_ids.json", views),
        ("local_baselines.json", baselines),
    ]:
        dump(partial / name, value)
    shutil.copyfile(source / "ATTRIBUTION.txt", partial / "ATTRIBUTION.txt")
    with (partial / "ATTRIBUTION.txt").open("a") as stream:
        stream.write(
            "Additional changes: participant-disjoint splits, temporal-window selection, derived observational references and local numeric baselines. No intervention labels or genuine agent dialogues.\n"
        )
    (partial / "report.md").write_text(render(summary, budget, baselines))
    files = {
        str(p.relative_to(partial)): {"bytes": p.stat().st_size, "sha256": digest(p)}
        for p in sorted(partial.rglob("*"))
        if p.is_file()
    }
    dump(partial / "manifest.json", {"version": version, **identity, "files": files})
    dump(
        partial / "COMPLETE.json",
        {"version": version, "manifestSha256": digest(partial / "manifest.json")},
    )
    partial.rename(out)
    return summary
