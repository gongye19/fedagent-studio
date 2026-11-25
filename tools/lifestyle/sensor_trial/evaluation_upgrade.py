"""把原始拒答记录为拒答；不改提示、经验、样本或已付费回复，不重发请求。"""

import ast
import shutil
import subprocess
from datetime import UTC, datetime

from ..common import digest, load, rows, save
from ..full.federation.budget import ledger
from .adapter import SETTINGS, TARGET, messages, prediction
from .prepare import ROOT, implementation, validate_frozen
from .recovery import ALLOWED, checksum, completed_units, completed_values, receipt
from .retrieval import retrieve


def unchanged_prompts(plan):
    name = "tools/lifestyle/sensor_trial/adapter.py"
    current = (ROOT / name).read_bytes()
    if digest(current.hex()) == plan["implementation"]["files"][name]:
        return
    old = subprocess.check_output(["git", "show", "2c70efc:" + name], cwd=ROOT)
    if digest(old.hex()) != plan["implementation"]["files"][name]:
        raise ValueError("unsupported-original-parser-version")

    def projection(source):
        tree = ast.parse(source)
        tree.body = [node for node in tree.body if not isinstance(node, ast.FunctionDef) or node.name != "prediction"]
        return ast.dump(tree, include_attributes=False)

    if projection(old) != projection(current):
        raise ValueError("abstention-upgrade-cannot-change-prompts")


def original_abstention(directory, body, attempts):
    key = digest(body)
    ordinals = [r["ordinal"] for r in attempts if r["requestHash"] == key and r["status"] == "ok"]
    if not ordinals:
        raise ValueError("no-paid-reply-to-recover")
    candidates = [(max(ordinals), directory / "meter/calls" / (key + ".json"))]
    for path in (directory / "meter/rejected").glob(key + "-*.json"):
        replaced_at = int(path.stem.rsplit("-", 1)[1])
        prior = [n for n in ordinals if n < replaced_at]
        if prior:
            candidates.append((max(prior), path))
    for ordinal, path in sorted(candidates):
        value = load(path)
        if (
            value["request"] != body
            or value["resultDigest"] != digest(value["result"])
            or value["result"].get("finish_reason") not in (None, "stop")
        ):
            raise ValueError("original-response-invalid")
        try:
            parsed = prediction(value["result"]["text"])
        except ValueError:
            continue
        if parsed[TARGET] is None:
            return parsed, {"file": str(path.relative_to(directory)), "sha256": checksum(path), "ordinal": ordinal, "requestHash": key}
    raise ValueError("no-original-abstention; cannot-invent-a-result")


def accept_abstentions(directory):
    from .verify import verify_federation

    plan = load(directory / "inputs/plan.json")
    validate_frozen(directory, plan)
    previous = receipt(directory, plan, required=True)
    current = implementation()
    if previous.get("evaluationAcceptance"):
        return receipt(directory, plan, current=current, required=True)
    before = plan["implementation"]
    changed = {p for p in before["files"] | current["files"] if before["files"].get(p) != current["files"].get(p)}
    if changed - ALLOWED or any(before[k] != current[k] for k in before if k != "files"):
        raise ValueError("evaluation-upgrade-cannot-change-algorithm")
    unchanged_prompts(plan)
    library, state = verify_federation(directory, plan)
    attempts = ledger(directory / "meter", plan["identity"])
    changes = []
    for case in rows(directory / "inputs/evaluation.jsonl"):
        selected, _ = retrieve(case["input"], library)
        for arm in ("baseline", "shared"):
            path = directory / f"answers/{case['id']}-{arm}.json"
            if not path.exists():
                continue
            unit = load(path)
            body = {
                "ref": plan["modelRef"],
                "identity": plan["identity"],
                "messages": messages(case["input"], selected if arm == "shared" else {}),
                "settings": SETTINGS,
            }
            if unit["fingerprint"] != digest({k: body[k] for k in ("identity", "messages", "settings")}):
                raise ValueError("existing-question-or-parameters-changed")
            if "value" in unit:
                if digest(unit["value"]) != unit["valueDigest"]:
                    raise ValueError("existing-answer-changed")
                continue
            parsed, proof = original_abstention(directory, body, attempts)
            changes.append((path, unit, parsed, proof))
    if not changes:
        raise ValueError("no-abstention-checkpoint-to-recover")
    backup = ROOT / ".backups" / ("cg-abstention-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ"))
    shutil.copytree(directory, backup)
    for path, unit, parsed, proof in changes:
        unit.update(value=parsed, valueDigest=digest(parsed), acceptedCachedResponse=proof)
        save(path, unit)
    value = {
        **previous,
        "implementation": current,
        "ledgerPrefix": attempts,
        "at": datetime.now(UTC).isoformat(),
        "previousRecovery": previous["digest"],
        "backup": str(backup),
        "evaluationAcceptance": "abstention-coverage/v1",
        "acceptedResponses": {path.name: proof for path, _, _, proof in changes},
        "completedUnits": completed_units(directory, state["taskId"]),
        "completedValues": completed_values(directory, state["taskId"]),
        "successfulCacheFiles": {p.name: checksum(p) for p in (directory / "meter/calls").glob("*.json") if not load(p).get("rejected")},
    }
    value.pop("digest", None)
    value["digest"] = digest(value)
    save(directory / "recovery.json", value)
    return receipt(directory, plan, current=current, required=True)
