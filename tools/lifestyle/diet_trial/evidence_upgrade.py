"""只离线接受最早的真实评分响应；保留两次格式拒绝和全部回答，不重问。"""

import shutil

from ..common import digest, load, save
from ..full.federation.budget import ledger
from .evidence import judge_reply, normalize
from .prepare import ROOT, file_hash, implementation, validate_frozen
from .protocol import JUDGE_SETTINGS, judge_messages, public
from .recovery import receipt


def upgrade(directory):
    from .run import answers

    raw = load(directory / "inputs/plan.json")
    validate_frozen(directory, raw)
    old = load(directory / "recovery.json")
    receipt(directory, raw, old["implementation"])
    current = implementation()
    if old.get("acceptedResponses"):
        return receipt(directory, raw, current)
    changed = {
        p for p in old["implementation"]["files"] | current["files"] if old["implementation"]["files"].get(p) != current["files"].get(p)
    }
    allowed = {"tools/lifestyle/diet_trial/" + name for name in ("evidence.py", "evidence_upgrade.py", "run.py", "units.py", "__main__.py")}
    if changed - allowed or any(old["implementation"][k] != current[k] for k in current if k != "files"):
        raise ValueError("evidence-upgrade-cannot-change-prompts-scoring-or-algorithm")
    if load(directory / "recovery/STOP.json")["type"] != "UnitExhausted":
        raise ValueError("only-first-judge-format-stop-can-upgrade")
    values = ledger(directory / "meter", raw["identity"])
    cases, replies = answers(directory, {**raw, "globalCallCap": 60, "recovery": old}, load(directory / "batch-01/library.json"))
    blinded = [
        {
            "id": c["id"],
            "input": public(c["input"]),
            "answers": {label: replies[c["id"]][arm] for label, arm in raw["blindMaps"][c["id"]].items()},
        }
        for c in cases[:2]
    ]
    messages = judge_messages(blinded)
    body = {"ref": raw["modelRef"], "identity": raw["identity"], "messages": messages, "settings": JUDGE_SETTINGS}
    key = digest(body)
    attempts = [r for r in values if r["requestHash"] == key]
    unit = load(directory / "judging/batch-1.json")
    if len(attempts) != 2 or any(r["status"] != "ok" for r in attempts) or unit["failures"] != ["InvalidFormat", "InvalidFormat"]:
        raise ValueError("only-two-original-completed-format-rejections-accepted")
    candidates = sorted((directory / "meter/rejected").glob(key + "-*.json"), key=lambda p: int(p.stem.rsplit("-", 1)[1]))
    candidates.append(directory / f"meter/calls/{key}.json")
    chosen = None
    for path in candidates:
        cache = load(path)
        if (
            cache["request"] != body
            or cache["resultDigest"] != digest(cache["result"])
            or cache["result"].get("finish_reason") not in (None, "stop")
        ):
            raise ValueError("original-judge-cache-changed")
        try:
            parsed = judge_reply(cache["result"]["text"], blinded)
        except (ValueError, TypeError, KeyError):
            continue
        chosen = path, parsed, normalize(cache["result"]["text"], blinded)[1]
        break
    if chosen is None:
        raise ValueError("no-original-scoring-response-has-verifiable-verbatim-evidence")
    path, parsed, corrections = chosen
    backup = ROOT / ".backups" / ("diet-evidence-" + old["digest"][:12])
    if backup.exists():
        raise ValueError("existing-evidence-backup-not-overwritten")
    shutil.copytree(directory, backup)
    save(directory / "recovery-before-evidence.json", old)
    proof = {"file": str(path.relative_to(directory)), "sha256": file_hash(path), "valueDigest": digest(parsed), "corrections": corrections}
    revised = {
        **old,
        "implementation": current,
        "previousRecovery": old["digest"],
        "evidenceChangedFiles": sorted(changed),
        "ledgerPrefix": values,
        "acceptedResponses": {"judging/batch-1.json": proof},
        "evidenceBackup": str(backup),
    }
    revised["protectedJobFiles"] = {
        **old["protectedJobFiles"],
        "recovery/STOP.json": file_hash(directory / "recovery/STOP.json"),
        "judging/batch-1.json": file_hash(directory / "judging/batch-1.json"),
        "recovery-before-evidence.json": file_hash(directory / "recovery-before-evidence.json"),
        proof["file"]: proof["sha256"],
    }
    for folder in ("answers", "generation", "meter/calls"):
        revised["protectedJobFiles"].update({str(p.relative_to(directory)): file_hash(p) for p in (directory / folder).glob("*.json")})
    revised.pop("digest")
    revised["digest"] = digest(revised)
    save(
        directory / "recovery/units/judging/batch-1.json",
        {
            "fingerprint": unit["fingerprint"],
            "failures": [],
            "value": parsed,
            "valueDigest": digest(parsed),
            "acceptedOriginalResponse": proof["file"],
        },
    )
    save(directory / "recovery.json", revised)
    return receipt(directory, raw, current)
