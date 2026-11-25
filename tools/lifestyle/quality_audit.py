"""离线盘点现有七包经验；只报告可观察属性，不自动判定医学正确或语义重复。"""

import argparse
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

from .common import digest, jsonl, load, save

ROOT = Path(__file__).resolve().parents[2]
PACKS = [
    (f"public-{i:02}", f"full/run-20261119/federation/batch-{i:02}", count, "建议流程策略")
    for i, count in enumerate((18, 19, 16, 19, 27), 1)
] + [
    ("diet-10", "diet-trial/run-20261125/batch-01", 10, "建议流程策略"),
    ("sensor-13", "sensor-trial/run-20261124/batch-01", 13, "测量与计算方法"),
]


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def inventory(root):
    packs, entries = [], []
    for name, relative, expected, role in PACKS:
        folder = root / relative
        library, state = load(folder / "library.json"), load(folder / "state.json")
        if (
            state["status"] != "complete"
            or state["libraryDigest"] != digest(library)
            or len(library) != expected
            or state["finalEntries"] != expected
            or any(not isinstance(v, str) or not v.strip() for v in library.values())
        ):
            raise ValueError("library-does-not-match-completed-receipt: " + name)
        packs.append({"id": name, "path": relative, "count": len(library), "role": role, "libraryDigest": digest(library)})
        for key, value in library.items():
            entries.append(
                {
                    "pack": name,
                    "id": key,
                    "text": value,
                    "contentDigest": digest(value),
                    "role": role,
                    "disposition": "保留原文作为辅助策略；不当已验证个性化推荐"
                    if role == "建议流程策略"
                    else "限计算／数据校验任务，不用于推荐增益声明",
                    "literalUrls": re.findall(r"https?://[^\s]+", value),
                    "arabicNumbers": re.findall(r"\d+(?:\.\d+)?", value),
                    "structuredEvidenceFields": False,
                    "perEntrySourceMapping": "最终字符串未提供；只有包／任务及原轨迹可以追溯",
                    "healthBenefitValidated": False,
                }
            )
    clusters = defaultdict(list)
    for entry in entries:
        normalized = " ".join(entry["text"].casefold().split())
        clusters[normalized].append({"pack": entry["pack"], "id": entry["id"]})
    return packs, entries, [v for v in clusters.values() if len(v) > 1]


def audit(root, out):
    root, out = root.resolve(), out.resolve()
    if out.exists() or out.with_suffix(".partial").exists():
        raise ValueError("audit-output-must-be-new")
    protected = {str(p.relative_to(root)): sha(p) for p in sorted(root.rglob("*")) if p.is_file() and p.name != ".lock"}
    packs, entries, duplicates = inventory(root)
    stage = out.with_suffix(".partial")
    stage.mkdir(parents=True)
    jsonl(stage / "entries.jsonl", entries)
    summary = {
        "protocol": "offline-experience-inventory/1",
        "packs": packs,
        "entries": len(entries),
        "recommendationWorkflowEntries": sum(e["role"] == "建议流程策略" for e in entries),
        "measurementEntries": sum(e["role"] == "测量与计算方法" for e in entries),
        "entriesWithLiteralUrls": sum(bool(e["literalUrls"]) for e in entries),
        "entriesWithArabicNumbers": sum(bool(e["arabicNumbers"]) for e in entries),
        "exactTextDuplicateGroups": duplicates,
        "classification": "用途为人工按本批任务与正文判读；URL／数字／精确重复为字面统计，不是医学质量或语义查重分数。",
        "modelCalls": 0,
        "algorithmChanged": False,
        "oldScoresChanged": False,
        "protectedFiles": len(protected),
    }
    save(stage / "inventory.json", summary)
    save(stage / "protected-before.json", protected)
    lines = [
        "# 现有经验用途盘点",
        "",
        "本报告不是医学正确性认证；不删除、不重写经验或历史评分。",
        "",
        "|经验包|条数|用途判断|",
        "|---|---:|---|",
    ]
    lines += [f"|{p['id']}|{p['count']}|{p['role']}|" for p in packs]
    for entry in entries:
        lines += ["", f"## {entry['pack']} · {entry['id']}", "", entry["disposition"], "", entry["text"]]
    (stage / "entries.md").write_text("\n".join(lines) + "\n")
    if any(sha(root / name) != value for name, value in protected.items()):
        raise ValueError("old-experiment-file-changed-during-audit")
    save(stage / "COMPLETE.json", {"inventoryDigest": digest(summary), "oldFilesUnchanged": len(protected), "modelCalls": 0})
    stage.rename(out)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT / "data/lifestyle-prep")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    value = audit(args.root, args.out)
    print(json.dumps({k: v for k, v in value.items() if k != "packs"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
