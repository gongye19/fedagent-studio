"""Pinned original archives and checked, non-extracting ZIP access."""

import csv
import hashlib
import io
import json
import re
import stat
from pathlib import Path, PurePosixPath

from .common import normalized_headers

SOURCES = {
    "CGMacros_dateshifted365.zip": {
        "url": "https://physionet-open.s3.amazonaws.com/cgmacros/1.0.0/CGMacros_dateshifted365.zip",
        "page": "https://physionet.org/content/cgmacros/1.0.0/",
        "bytes": 657187340,
        "algorithm": "sha256",
        "checksum": "05c8b0e6f1a2757050aced55ce4bf6ab2ac9b30f2fd8ca193056812d9c621d4d",
        "license": "CC-BY-NC-SA-4.0",
    },
    "rais_anonymized.zip": {
        "url": "https://zenodo.org/records/6832242/files/rais_anonymized.zip?download=1",
        "page": "https://zenodo.org/records/6832242",
        "bytes": 642961582,
        "algorithm": "md5",
        "checksum": "ada6e54d6b75845ed066122725643ef6",
        "license": "CC-BY-4.0",
    },
}

# Only named research/units/license snapshots bind the version; Finder metadata does not.
EVIDENCE_FILES = (
    "CGMacros-SHA256SUMS.txt",
    "CGMacros-LICENSE.txt",
    "CGMacros-page.html",
    "CGMacros-license-page.html",
    "DataDictionary_Bio.csv",
    "DataDictionary_CGMacros-00X.csv",
    "DataDictionary_Gut_Health_Test.csv",
    "DataDictionary_Microbes.csv",
    "LifeSnaps-record.json",
    "LifeSnaps-README.md",
    "LifeSnaps-repo-tree.json",
    "visualization_df_creation.ipynb",
    "visualization_df_creation_hourly.ipynb",
)


def digest(path: Path, algorithm="sha256") -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, algorithm).hexdigest()


def evidence_files(raw: Path) -> dict:
    evidence = {}
    for name in sorted(EVIDENCE_FILES):
        path = raw / name
        if not path.is_file():
            raise ValueError(f"required evidence missing: {name}")
        evidence[name] = {"bytes": path.stat().st_size, "sha256": digest(path)}
    return evidence


def inventory(archive, policy) -> list[dict]:
    names, entries, total = set(), [], 0
    for info in archive.infolist():
        name = info.filename
        path = PurePosixPath(name)
        mode = info.external_attr >> 16
        if (
            name in names
            or path.is_absolute()
            or ".." in path.parts
            or "\\" in name
            or ":" in name
            or stat.S_ISLNK(mode)
        ):
            raise ValueError(f"unsafe or duplicate ZIP member: {name}")
        names.add(name)
        total += info.file_size
        if (
            info.file_size > policy["maxMemberBytes"]
            or total > policy["maxArchiveBytes"]
        ):
            raise ValueError("ZIP expansion limit exceeded")
        if info.file_size / max(1, info.compress_size) > policy[
            "maxCompressionRatio"
        ] or name.lower().endswith(".zip"):
            raise ValueError("unexpected compressed/nested member")
        entries.append(
            {
                "member": name,
                "bytes": info.file_size,
                "crc32": f"{info.CRC:08x}",
                "directory": info.is_dir(),
                "conversion": "csv"
                if name.endswith(".csv")
                else "preserved_in_original_zip",
            }
        )
    if archive.testzip() is not None:
        raise ValueError("ZIP CRC failure")
    return sorted(entries, key=lambda item: item["member"])


def official_cg_files(raw: Path) -> list[dict]:
    names = {
        name: name
        for name in [
            "CGMacros_dateshifted365.zip",
            "DataDictionary.pdf",
            "DataDictionary_Bio.csv",
            "DataDictionary_CGMacros-00X.csv",
            "DataDictionary_Gut_Health_Test.csv",
            "DataDictionary_Microbes.csv",
        ]
    }
    names["LICENSE.txt"] = "CGMacros-LICENSE.txt"
    checks, seen = [], set()
    for line in (raw / "CGMacros-SHA256SUMS.txt").read_text().splitlines():
        checksum, name = line.split()
        if name not in names or name in seen:
            raise ValueError(f"unexpected CGMacros checksum entry: {name}")
        seen.add(name)
        target = raw / names[name]
        record = {"officialName": name, "localName": names[name], "sha256": checksum}
        if not target.exists():
            if name != "DataDictionary.pdf":
                raise ValueError(f"missing CGMacros official file: {name}")
            checks.append(
                {
                    **record,
                    "status": "not_downloaded",
                    "reason": "All four CSV dictionaries downloaded instead of PDF.",
                }
            )
            continue
        if digest(target) != checksum:
            raise ValueError(f"CGMacros metadata checksum mismatch: {name}")
        checks.append({**record, "status": "verified"})
    if seen != set(names):
        raise ValueError("incomplete CGMacros checksum listing")
    return checks


def verify_sources(raw: Path) -> tuple[dict, dict]:
    verified = {}
    for name, source in SOURCES.items():
        path = raw / name
        actual = digest(path, source["algorithm"])
        if path.stat().st_size != source["bytes"] or actual != source["checksum"]:
            raise ValueError(f"original source checksum/size mismatch: {name}")
        verified[name] = {**source, "sha256": digest(path), "verifiedChecksum": actual}
    verified["CGMacros_dateshifted365.zip"]["officialFileChecks"] = official_cg_files(
        raw
    )
    page = (raw / "CGMacros-page.html").read_text()
    if "Creative Commons Attribution-NonCommercial-ShareAlike 4.0" not in page:
        raise ValueError("CGMacros license evidence changed")
    life = json.loads((raw / "LifeSnaps-record.json").read_text())
    if life["metadata"]["license"]["id"] != "cc-by-4.0" or not any(
        file["key"] == "rais_anonymized.zip"
        and file["checksum"] == "md5:ada6e54d6b75845ed066122725643ef6"
        for file in life["files"]
    ):
        raise ValueError("LifeSnaps metadata identity/license mismatch")
    cg_metadata = json.loads(
        re.search(
            r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',
            page,
            re.DOTALL,
        )[1]
    )
    verified["CGMacros_dateshifted365.zip"]["creators"] = [
        item["name"] for item in cg_metadata["creator"]
    ]
    verified["rais_anonymized.zip"]["creators"] = [
        item["name"] for item in life["metadata"]["creators"]
    ]
    for name, fragments in {
        "DataDictionary_CGMacros-00X.csv": ["multiplied by 10"],
        "DataDictionary_Bio.csv": [
            "pounds",
            "inches",
            "800 is an error",
            "400 indicates an erroneous",
        ],
    }.items():
        text = (raw / name).read_text()
        if any(fragment not in text for fragment in fragments):
            raise ValueError(f"unit/error evidence missing: {name}")
    notebook = json.loads((raw / "visualization_df_creation.ipynb").read_text())
    text = "\n".join("".join(cell.get("source", [])) for cell in notebook["cells"])
    if (
        'd["duration"]' not in text
        or 'd["minutesAsleep"]' not in text
        or 'get("thirtyDayAvgMinutes")' not in text
    ):
        raise ValueError("LifeSnaps unit/ratio evidence missing")
    return verified, evidence_files(raw)


def check_supplement_headers(archive, raw):
    for table, dictionary in [
        ("bio", "Bio"),
        ("gut_health_test", "Gut_Health_Test"),
        ("microbes", "Microbes"),
    ]:
        with (raw / f"DataDictionary_{dictionary}.csv").open(
            encoding="utf-8-sig", newline=""
        ) as stream:
            expected = normalized_headers(
                ["subject", *[row[0] for row in list(csv.reader(stream))[1:]]]
            )
        with archive.open(f"CGMacros/{table}.csv") as stream:
            actual = normalized_headers(
                next(csv.reader(io.TextIOWrapper(stream, encoding="utf-8-sig")))
            )
        if actual != expected:
            raise ValueError(f"supplement dictionary/header mismatch: {table}")
