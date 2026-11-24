"""Atomic, reproducible dataset preparation; never contacts a model or platform."""

import hashlib
import json
import zipfile
from contextlib import ExitStack
from pathlib import Path

from . import cgmacros, lifesnaps
from .archives import check_supplement_headers, digest, inventory, verify_sources
from .common import Audit, dump

HERE = Path(__file__).parent


def build(raw: Path, out: Path) -> dict:
    raw, out = raw.resolve(), out.resolve()
    partial = out.with_name(out.name + ".partial")
    if (
        out.exists()
        or partial.exists()
        or out.is_relative_to(raw)
        or raw.is_relative_to(out)
    ):
        raise ValueError(
            "output already exists/unfinished or overlaps original directory"
        )
    policy = json.loads((HERE / "policy.json").read_text())
    sources, evidence = verify_sources(raw)
    code = {p.name: digest(p) for p in sorted(HERE.glob("*.py"))}
    identity = {
        "sources": sources,
        "evidence": evidence,
        "code": code,
        "policySha256": digest(HERE / "policy.json"),
    }
    version = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    partial.mkdir(parents=True, exist_ok=False)
    # A failure deliberately leaves .partial for inspection; it is never a complete dataset.
    with ExitStack() as stack:
        audit_stream = stack.enter_context((partial / "issues.jsonl").open("w"))
        quarantine = stack.enter_context((partial / "quarantine.jsonl").open("w"))
        audit = Audit(audit_stream)
        cg = stack.enter_context(zipfile.ZipFile(raw / "CGMacros_dateshifted365.zip"))
        life = stack.enter_context(zipfile.ZipFile(raw / "rais_anonymized.zip"))
        members = {
            "cgmacros": inventory(cg, policy),
            "lifesnaps": inventory(life, policy),
        }
        check_supplement_headers(cg, raw)
        cg_out, life_out = partial / "cgmacros", partial / "lifesnaps"
        cg_out.mkdir()
        life_out.mkdir()
        summary = {
            "cgmacros": cgmacros.prepare(cg, cg_out, audit, quarantine, policy),
            "lifesnaps": lifesnaps.prepare(life, life_out, audit, quarantine, policy),
        }
        # Fixed source versions make these explicit fail-closed reconciliation checks.
        if (
            summary["cgmacros"]["participants"],
            summary["cgmacros"]["sensorRows"],
            summary["cgmacros"]["loggedMeals"],
        ) != (45, 687580, 1706):
            raise ValueError("CGMacros source population/count changed")
        daily = summary["lifesnaps"]["tables"]["daily_fitbit_sema_df_unprocessed"]
        if (summary["lifesnaps"]["participants"], daily["retainedRows"]) != (71, 7410):
            raise ValueError("LifeSnaps source population/count changed")
        dump(partial / "summary.json", summary)
        dump(partial / "source_rows.json", audit.tables)
        dump(partial / "field_mapping.json", audit.headers)
        dump(
            partial / "quality.json",
            {
                "eventsByMemberFieldReason": audit.events,
                "emptyCellsByMemberField": audit.empty,
                "absentColumnCellsByMemberField": audit.absent,
            },
        )
        dump(partial / "archive_members.json", members)
        dump(partial / "policy.json", policy)
    (partial / "ATTRIBUTION.txt").write_text(
        "CGMacros 1.0.0, "
        + "; ".join(sources["CGMacros_dateshifted365.zip"]["creators"])
        + ", doi:10.13026/3z8q-x658.\n"
        "https://physionet.org/content/cgmacros/1.0.0/ ; CC BY-NC-SA 4.0.\n"
        "CGMacros-derived cleaned data retain CC BY-NC-SA 4.0; noncommercial research preparation, not public platform resources.\n"
        "https://creativecommons.org/licenses/by-nc-sa/4.0/\n"
        "LifeSnaps, " + "; ".join(sources["rais_anonymized.zip"]["creators"]) + ".\n"
        "https://zenodo.org/records/6832242 , CC BY 4.0.\n"
        "https://creativecommons.org/licenses/by/4.0/\n"
        "Changes: conservative numeric cleaning, documented units, exact deduplication, conflict quarantine, candidate flags.\n"
        "Original anonymous IDs remain source-namespaced. No new data, clinical labels, interventions, or recommendation outcomes.\n"
    )
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
