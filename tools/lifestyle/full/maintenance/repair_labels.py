"""仅将已知的v1上传标签故障迁到v2；保留全部已花账本，不改数据库。"""

import fcntl
import hashlib
import json
import shutil
import sqlite3
from contextlib import ExitStack, closing
from datetime import UTC, datetime
from pathlib import Path

from fedagent.data import DatasetFiles

from ...common import digest, load, save
from ..federation import prepare as preparation
from ..federation.budget import allocate, ledger

OLD_FINGERPRINT = "d9acbac107b2396d688dc4e58b1e19176d4d3a3113b5398d399ad49bc4f8baa3"


def inputs_ok(directory):
    folder = directory / "inputs"
    manifest = load(folder / "manifest.json")
    actual = {p.name: digest(p.read_bytes().hex()) for p in folder.iterdir() if p.name != "manifest.json"}
    if manifest["manifestDigest"] != digest({k: v for k, v in manifest.items() if k != "manifestDigest"}) or actual != manifest["outputs"]:
        raise ValueError("old-inputs-corrupt")
    plan = load(folder / "plan.json")
    if digest({k: v for k, v in plan.items() if k != "fingerprint"}) != plan["fingerprint"]:
        raise ValueError("old-plan-fingerprint-corrupt")
    return plan


def paid_files(directory):
    batch = directory / "batch-01"
    paths = [batch / "attempts.json", batch / "model.json", *sorted((batch / "calls").glob("*.json"))]
    return {str(p.relative_to(directory)): digest(p.read_bytes().hex()) for p in paths}


def database_evidence(directory, plan, state):
    path = directory / "platform/fedagent.db"
    with closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        if any(db.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in ("tasks", "work_units", "messages", "artifacts", "apps")):
            raise ValueError("algorithm-already-started-no-label-repair")
        datasets = db.execute("SELECT * FROM datasets").fetchall()
        participants = db.execute("SELECT * FROM participants").fetchall()
        if len(datasets) != 1 or len(participants) != 1:
            raise ValueError("unexpected-resource-count")
        row, participant = datasets[0], participants[0]
        resource = state["sites"]["CDC"]
        raw = directory / "inputs/batch-01-CDC.jsonl"
        expected = [json.loads(v) for v in raw.read_text().splitlines() if v.strip()]
        if (
            row["id"] != resource["datasetId"]
            or row["participant_id"] != resource["participantId"]
            or participant["id"] != resource["participantId"]
            or row["count"] != len(expected)
            or row["source_hash"] != hashlib.sha256(raw.read_bytes()).hexdigest()
            or row["task_type"] != "lifestyle-records"
            or row["name"] != f"LifeStyle CDC · batch-01 · {plan['fingerprint'][:10]}"
            or participant["name"] != f"LifeStyle CDC · {plan['fingerprint'][:10]}"
        ):
            raise ValueError("retained-CDC-resource-mismatch")
        if DatasetFiles(directory / "platform/datasets").load(row["content_path"]) != expected:
            raise ValueError("retained-CDC-content-mismatch")
        return {"databaseDigest": digest("\n".join(db.iterdump())), "dataset": dict(row), "participantId": participant["id"]}


def repair(directory, *, expected_old_fingerprint=OLD_FINGERPRINT, fail_at=None):
    generation = directory.parent / "generation"
    with ExitStack() as locks:
        for folder in (directory, generation):
            handle = locks.enter_context((folder / ".lock").open("a"))
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        old = inputs_ok(directory)
        if old["protocol"] != "lifestyle-full-federation/1" or old["fingerprint"] != expected_old_fingerprint:
            raise ValueError("only-known-v1-label-failure-supported")
        if {p.name for p in directory.glob("batch-*")} != {"batch-01"}:
            raise ValueError("later-or-unknown-batch-exists")
        gp, cases = preparation.generation_prepare(generation)
        status, states = preparation.usage(generation, gp, cases)
        if (
            status["state"]["status"] != "complete"
            or any(v != "generated" for v in states.values())
            or gp["fingerprint"] != old["generationFingerprint"]
            or old["generationFiles"] != preparation.files_at(generation)
            or status["remoteAttempts"] != old["generationAttempts"]
            or old["generationAttempts"] != 447
        ):
            raise ValueError("generation-not-identical-and-complete")
        state_path, allocation_path = directory / "batch-01/state.json", directory / "batch-01/allocation.json"
        state, allocation = load(state_path), load(allocation_path)
        if (
            state["fingerprint"] != old["fingerprint"]
            or state["status"] != "failed"
            or not state.get("terminal")
            or state.get("rootError")
            or state.get("taskId")
            or state.get("appId")
            or not state.get("probePassed")
            or set(state["sites"]) != {"CDC"}
            or not all(s in state.get("error", "") for s in ("422", "string_too_long", "MedMCQA"))
        ):
            raise ValueError("not-the-pre-algorithm-upload-label-failure")
        if allocation != {"fingerprint": old["fingerprint"], "limit": 250, "priorSpent": 0, "reservedFuture": 722, "generationSpent": 447}:
            raise ValueError("unexpected-allocation")
        attempts = ledger(directory / "batch-01", old["identity"])
        if len(attempts) != 1 or attempts[0]["status"] != "ok":
            raise ValueError("only-one-completed-probe-may-be-retained")
        call = load(directory / "batch-01/calls" / (attempts[0]["requestHash"] + ".json"))
        if call["request"]["messages"] != [{"role": "user", "content": "Reply with OK."}]:
            raise ValueError("retained-call-not-the-probe")
        evidence = database_evidence(directory, old, state)
        paid = paid_files(directory)
        archive = directory / "repairs" / ("labels-v2-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ"))
        archive.mkdir(parents=True, mode=0o700)
        shutil.copytree(directory / "batch-01", archive / "batch-01")
        if (directory / "source-usage.json").exists():
            shutil.copyfile(directory / "source-usage.json", archive / "source-usage.json")
        with (
            closing(sqlite3.connect(f"file:{directory}/platform/fedagent.db?mode=ro", uri=True)) as db,
            closing(sqlite3.connect(archive / "platform-snapshot.db")) as snapshot,
        ):
            db.backup(snapshot)
        moved = False
        try:
            (directory / "inputs").rename(archive / "inputs")
            moved = True
            new = preparation._prepare_locked(
                directory, generation, resource_tag=old["fingerprint"][:10], label_overrides={"batch-01/CDC": evidence["dataset"]["name"]}
            )
            for key in (
                "generationFingerprint",
                "generationFiles",
                "generationAttempts",
                "identity",
                "modelRef",
                "counts",
                "globalCallCap",
                "batchCallCap",
                "contextCap",
                "params",
            ):
                if new[key] != old[key]:
                    raise ValueError("non-label-plan-field-changed:" + key)
            if [{k: v for k, v in b.items() if k != "labels"} for b in new["batches"]] != old["batches"]:
                raise ValueError("batch-membership-changed")
            for path in (archive / "inputs").glob("*.jsonl"):
                if path.read_bytes() != (directory / "inputs" / path.name).read_bytes():
                    raise ValueError("records-changed")
            save(
                state_path,
                {
                    **state,
                    "fingerprint": new["fingerprint"],
                    "status": "prepared",
                    "terminal": False,
                    "error": None,
                    "rootError": None,
                    "labelRepairArchive": str(archive),
                },
            )
            save(allocation_path, {**allocation, "fingerprint": new["fingerprint"]})
            if fail_at:
                fail_at("after-state")
            if preparation._prepare_locked(directory, generation) != new or allocate(directory, new, 0) != 250 or paid_files(directory) != paid:
                raise ValueError("refreeze-or-paid-budget-changed")
            updated_state = load(state_path)
            # 用旧计划核对原有显示名，因为修复对数据库完全只读。
            if database_evidence(directory, old, updated_state) != evidence:
                raise ValueError("database-was-changed")
            receipt = {
                "status": "repaired",
                "oldFingerprint": old["fingerprint"],
                "newFingerprint": new["fingerprint"],
                "scriptDigest": digest(Path(__file__).read_bytes().hex()),
                "generationFingerprint": gp["fingerprint"],
                "retainedResource": state["sites"]["CDC"],
                "retainedPaidFiles": paid,
                "generationAttempts": 447,
                "federationAttempts": 1,
                "totalAttempts": 448,
                "databaseDigest": evidence["databaseDigest"],
                "databaseWrites": 0,
                "archive": str(archive),
            }
            save(directory / "source-usage.json", {"status": "label-repaired-pending-run", "repairArchive": str(archive), "totalAttempts": 448})
            save(archive / "receipt.json", receipt)
            return receipt
        except BaseException as error:
            if moved:
                if (directory / "inputs").exists():
                    (directory / "inputs").rename(archive / "FAILED-new-inputs")
                (archive / "inputs").rename(directory / "inputs")
                shutil.copyfile(archive / "batch-01/state.json", state_path)
                shutil.copyfile(archive / "batch-01/allocation.json", allocation_path)
                if (archive / "source-usage.json").exists():
                    shutil.copyfile(archive / "source-usage.json", directory / "source-usage.json")
            save(
                archive / "failure.json",
                {"error": type(error).__name__ + ": " + str(error), "rolledBack": moved, "paidFilesUnchanged": paid_files(directory) == paid},
            )
            raise


if __name__ == "__main__":
    print(json.dumps(repair(preparation.ROOT / "data/lifestyle-prep/full/run-20261119/federation"), ensure_ascii=False, indent=2))
