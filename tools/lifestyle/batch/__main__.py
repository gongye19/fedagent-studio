"""首批真实实验入口；status完全离线，run严格按冻结预算执行。"""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from ..common import digest, hold_experiment_lock, load, save
from .prepare import prepare


def status(directory):
    state = load(directory / "run.json") if (directory / "run.json").exists() else {"status": "prepared"}
    attempts = load(directory / "attempts.json") if (directory / "attempts.json").exists() else []
    value = {
        **state,
        "attempts": len(attempts),
        "ok": sum(r["status"] == "ok" for r in attempts),
        "generated": sum("value" in load(p) for p in (directory / "generated").glob("*.json")),
        "evaluationCaseFiles": len(list((directory / "evaluation").glob("*.json"))),
    }
    database = directory / "platform/fedagent.db"
    task = load(directory / "task.json") if (directory / "task.json").exists() else {}
    if database.exists() and task.get("taskId"):
        with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
            value["task"] = connection.execute("SELECT status,cursor_step FROM tasks WHERE id=?", (task["taskId"],)).fetchone()
            value["workUnits"] = connection.execute(
                "SELECT step,status,count(*) FROM work_units WHERE task_id=? GROUP BY step,status", (task["taskId"],)
            ).fetchall()
    return value


def run(directory, manifest):
    from .report import report

    path = directory / "run.json"
    state = load(path) if path.exists() else {"status": "prepared", "startedAt": datetime.now(UTC).isoformat()}
    task_path = directory / "task.json"
    task = load(task_path) if task_path.exists() else {}
    if state.get("terminal") or task.get("terminal") or state["status"] == "complete":
        return report(directory)
    state.pop("error", None)
    from ..model import CachedModel, NotDispatchedPermanent
    from ..runner import local_platform
    from .evaluate import evaluate, paired_complete, summarize
    from .federate import federate
    from .generate import generate

    model = CachedModel(
        directory,
        manifest["modelRef"],
        manifest["callLimit"],
        ceiling=850,
        reserved=0 if state.get("evaluationStarted") else manifest["evaluationReservation"],
        context_cap=manifest["operationalContextCap"],
    )
    try:
        if not state.get("evaluationStarted"):
            state["status"] = "generating"
            save(path, state)
            records = generate(directory, manifest, model)
            state["status"] = "federating"
            save(path, state)
            platform = local_platform(directory, model)
            task, library = federate(directory, manifest, records, platform, model)
            used = len(load(directory / "attempts.json"))
            remaining = model.limit - used
            if remaining < manifest["evaluationReservation"]:
                raise ValueError("insufficient-reserved-evaluation-budget")
            state.update({"evaluationStarted": True, "generationAttempts": used, "evaluationAvailableAttempts": remaining})
            model.reserved = 0
        else:
            library = load(directory / "shared-library.json")
            if digest(library) != task.get("libraryDigest"):
                raise ValueError("published-library-corrupted")
        state["status"] = "evaluating"
        save(path, state)
        results = evaluate(directory, manifest, library, model)
        state["status"] = "complete" if summarize(results)["incompleteCases"] == 0 else "incomplete"
        recoverable = any(not paired_complete(row) and not row.get("permanentMissing") for row in results)
        permanently_done = not recoverable and any(row.get("permanentMissing") for row in results)
        if model.budget_exhausted or permanently_done:
            state["terminal"] = True
            state["error"] = "evaluation-budget-exhausted" if model.budget_exhausted else "evaluation-permanent-missing-unit"
    except Exception as error:
        state.update({"status": "failed", "error": type(error).__name__ + ": " + str(error)})
        task = load(task_path) if task_path.exists() else {}
        if task.get("terminal") or model.budget_exhausted or model.context_failure or isinstance(error, ValueError | NotDispatchedPermanent):
            state["terminal"] = True
    state.update({"updatedAt": datetime.now(UTC).isoformat(), "cacheHitsThisProcess": model.cache_hits})
    save(path, state)
    return report(directory)


def main():
    parser = argparse.ArgumentParser(description="LifeStyle 首批30文档／24题本地实验；最多850次，不部署")
    parser.add_argument("command", choices=("prepare", "run", "status", "report"))
    parser.add_argument("--directory", type=Path, default=Path("data/lifestyle-prep/experiments/first-20261118"))
    parser.add_argument("--knowledge", type=Path, default=Path("data/lifestyle-prep/knowledge/final4-20261118"))
    parser.add_argument("--corpus", type=Path, default=Path("data/lifestyle-prep/corpus/final-20261118"))
    parser.add_argument("--model", default="default:gpt-5.6-luna")
    args = parser.parse_args()
    directory = args.directory.resolve()
    if directory.parent.name != "experiments" or directory.parent.parent.name != "lifestyle-prep":
        parser.error("只允许 lifestyle-prep/experiments/<新批次>，不能覆盖旧实验或部署目录")
    if args.command == "status":
        print(json.dumps(status(directory), ensure_ascii=False, indent=2))
        return
    directory.mkdir(parents=True, exist_ok=True)
    hold_experiment_lock(directory)
    if args.command == "report":
        from .report import report

        print(report(directory)["summary"])
        return
    manifest = prepare(directory, args.knowledge, args.corpus, args.model)
    if args.command == "prepare":
        print(manifest["fingerprint"], "30 records / 24 cases; 0 model calls")
        return
    value = run(directory, manifest)
    print(value["summary"])
    print(directory / "report.html")
    if value["run"].get("status") != "complete":
        raise SystemExit("实验未完成，已保留真实结果和检查点；不增加预算、不部署。")


if __name__ == "__main__":
    main()
