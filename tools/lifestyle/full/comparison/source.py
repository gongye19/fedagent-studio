"""只读接收已完成五批的成果；运行期间仅观察进展，不拍不一致快照。"""

import fcntl
import sqlite3
from contextlib import closing

from ...common import digest, load
from ..federation.budget import ledger
from ..federation.prepare import prepare as federation_prepare

FEDERATION_FP = "2f4bc5b1a476865a5844352a7f33ec95fb4ca9276c1843afa528cf7f6a6f0e90"
STALL_SECONDS = 45 * 60


class Waiting(RuntimeError):
    """学习进程仍持锁，尚不允许评测。"""


def progress(directory, now):
    files = list(directory.glob("batch-*/attempts.json"))
    if not files:
        raise ValueError("federation-no-ledger-needs-attention")
    age = now - max(p.stat().st_mtime for p in files)
    if age > STALL_SECONDS:
        raise ValueError("federation-no-progress-over-45-minutes")
    return {p.parent.name: len(load(p)) for p in sorted(files)}


def bundle(directory, now):
    with (directory / ".lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise Waiting(str(progress(directory, now))) from error
        plan = federation_prepare(directory)
        if plan["fingerprint"] != FEDERATION_FP or len(plan["batches"]) != 5:
            raise ValueError("not-the-approved-five-batch-run")
        states = {b["id"]: load(directory / b["id"] / "state.json") for b in plan["batches"] if (directory / b["id"] / "state.json").exists()}
        if any(states.get(b["id"], {}).get("status") != "complete" for b in plan["batches"]):
            raise ValueError("federation-stopped-before-all-five-complete")
        usage = load(directory / "source-usage.json")
        if usage["status"] != "complete" or not usage["countsVerified"] or usage.get("combinedLibrary"):
            raise ValueError("source-usage-not-complete")
        if {s: v["extractedUnits"] for s, v in usage["sources"].items()} != plan["counts"] or {s: v["uploaded"] for s, v in usage["sources"].items()} != plan[
            "counts"
        ]:
            raise ValueError("source-usage-coverage-changed")
        collection, libraries, origin = {}, {}, []
        with closing(sqlite3.connect(f"file:{directory}/platform/fedagent.db?mode=ro", uri=True)) as db:
            db.row_factory = sqlite3.Row
            for b in plan["batches"]:
                name, state = b["id"], states[b["id"]]
                ledger(directory / name, plan["identity"])
                library = load(directory / name / "library.json")
                if not library or not all(isinstance(k, str) and isinstance(v, str) and v.strip() for k, v in library.items()):
                    raise ValueError("invalid-source-library")
                if state["fingerprint"] != plan["fingerprint"] or digest(library) != state["libraryDigest"] or len(library) != state["finalEntries"]:
                    raise ValueError("source-library-changed")
                task = db.execute("SELECT status,audit FROM tasks WHERE id=?", (state["taskId"],)).fetchone()
                app = db.execute("SELECT task_id,content FROM apps WHERE id=?", (state["appId"],)).fetchone()
                artifacts = db.execute("SELECT content FROM artifacts WHERE task_id=?", (state["taskId"],)).fetchall()
                recorded = next(v for v in usage["batches"] if v["batch"] == name)
                if not task or task["status"] != "completed" or recorded["status"] != "complete" or recorded["error"]:
                    raise ValueError("source-task-not-complete")
                if json_value(task["audit"])["lifestyleSourceUsage"] != recorded["sources"]:
                    raise ValueError("source-audit-changed")
                if not app or app["task_id"] != state["taskId"] or digest(json_value(app["content"])) != digest(library):
                    raise ValueError("source-app-changed")
                if len(artifacts) != 1 or digest(json_value(artifacts[0]["content"])) != digest(library):
                    raise ValueError("source-artifact-changed")
                libraries[name] = library
                origin.append(
                    {
                        "batch": name,
                        "taskId": state["taskId"],
                        "appId": state["appId"],
                        "digest": digest(library),
                        "entries": len(library),
                        "records": b["count"],
                    }
                )
                for key, text in sorted(library.items()):
                    collection[name + "::" + key] = text
        if len(collection) != sum(len(v) for v in libraries.values()):
            raise ValueError("collection-key-collision")
        return plan, libraries, collection, origin


def json_value(value):
    import json

    return json.loads(value)
