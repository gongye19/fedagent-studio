"""复用真实平台的上传／运行／发布流程，不构建额外本站库。"""

from __future__ import annotations

import hashlib
from collections import Counter

from fastapi.testclient import TestClient
from fedagent import models as m
from fedagent.api import create_app
from fedagent.engine import TaskEngine
from fedagent.resource_services.endpoint_checks import check_endpoint
from sqlalchemy import select

from ..common import digest, load, save
from ..runner import checked


def only(session, table, *conditions):
    values = list(session.scalars(select(table).where(*conditions)))
    if len(values) > 1:
        raise ValueError("ambiguous-isolated-resource-recovery")
    return values[0] if values else None


def terminate(directory, state, reason, detail=None):
    state["terminal"] = {"reason": reason, "detail": detail}
    save(directory / "task.json", state)
    raise ValueError("terminal-experiment: " + reason)


def federate(directory, manifest, records, platform, model):
    fingerprint = digest({"prepared": manifest["fingerprint"], "records": records, "plugin": platform.registry.algorithm("fot-records").code_hash()})
    path = directory / "task.json"
    state = load(path) if path.exists() else {"fingerprint": fingerprint, "sites": {}}
    if state["fingerprint"] != fingerprint:
        raise ValueError("federation-checkpoint-changed")
    if state.get("terminal"):
        raise ValueError("terminal-experiment; not resumed")
    tag = manifest["fingerprint"][:12]
    task_name, app_name = "LifeStyle 首批 FoT · " + tag, "LifeStyle 首批经验包 · " + tag
    ref = "default:" + model.name
    with TestClient(create_app(platform)) as client:
        if not state.get("probePassed"):
            if not check_endpoint(platform, "default", verify_platform=True).ok:
                terminate(directory, state, "model-probe-failed")
            state["probePassed"] = True
            save(path, state)
        for site, values in records.items():
            raw = (directory / "upload" / (site + ".jsonl")).read_bytes()
            source_hash = hashlib.sha256(raw).hexdigest()
            name = f"LifeStyle {site} · {tag}"
            with platform.db.session() as session:
                row = only(session, m.Dataset, m.Dataset.name == name, m.Dataset.task_type == "lifestyle-records")
                recovered = {"participantId": row.participant_id, "datasetId": row.id} if row else None
                if row and (row.source_hash != source_hash or row.count != len(values)):
                    raise ValueError("uploaded-records-changed")
            if recovered is None:
                data = checked(
                    client.post(
                        "/v1/resources/data",
                        data={
                            "name": name,
                            "sourceName": name,
                            "hosting": "platform",
                            "taskType": "lifestyle-records",
                            "description": "公开指导资料生成的合成建议过程；模拟来源分组，非真实医院或私人报告。",
                        },
                        files={"file": ("process.jsonl", raw, "application/jsonl")},
                    ),
                    201,
                )
                recovered = {"participantId": data["source"]["id"], "datasetId": data["dataset"]["id"]}
            if site in state["sites"] and state["sites"][site] != recovered:
                raise ValueError("dataset-identity-changed")
            state["sites"][site] = recovered
            save(path, state)
        if "taskId" not in state:
            with platform.db.session() as session:
                task = only(session, m.Task, m.Task.name == task_name, m.Task.algorithm == "fot-records")
                task_id = task.id if task else None
            if task_id is None:
                task_id = checked(
                    client.post(
                        "/v1/tasks",
                        json={
                            "name": task_name,
                            "scenario": "horizontal",
                            "taskType": "lifestyle-records",
                            "algorithm": "fot-records",
                            "participants": list(state["sites"].values()),
                            "clientModel": ref,
                            "serverModel": ref,
                            "rounds": 1,
                            "mode": "full",
                            "workers": 2,
                            "params": {"insightTarget": "paper-auto", "maxTracesPerItem": 3},
                        },
                    ),
                    201,
                )["id"]
            state["taskId"] = task_id
            save(path, state)
        task_id = state["taskId"]
        with platform.db.session() as session:
            task = session.get(m.Task, task_id)
            if task.status in ("paused", "canceled"):
                terminate(directory, state, "algorithm-" + task.status, task.error)
            if task.status != "completed":
                task.status, task.command, task.error = "running", None, None
        result = TaskEngine(platform, task_id, poll=0.05).run()
        if result != "completed":
            with platform.db.session() as session:
                task = session.get(m.Task, task_id)
                detail = task.error
            terminate(directory, state, "generation-call-cap" if model.budget_exhausted else "algorithm-" + result, detail)
        with platform.db.session() as session:
            traces = list(session.scalars(select(m.Message).where(m.Message.task_id == task_id, m.Message.channel == "trace")))
            coverage = Counter(str(t.item_id) for t in traces)
            expected = {str(r["id"]) for rs in records.values() for r in rs}
            events = list(session.scalars(select(m.Event).where(m.Event.task_id == task_id).order_by(m.Event.id)))
            state["traceCoverage"] = dict(sorted(coverage.items()))
            state["algorithmLogs"] = [e.message for e in events if e.kind in ("log", "error")]
            save(path, state)
            if set(coverage) != expected or any(not 1 <= n <= 3 for n in coverage.values()):
                terminate(directory, state, "incomplete-trace-coverage-after-task-completed")
            artifact = session.scalars(select(m.Artifact).where(m.Artifact.task_id == task_id).order_by(m.Artifact.version.desc())).first()
            library = artifact.content if artifact else None
            if not isinstance(library, dict) or not library or not all(isinstance(k, str) and isinstance(v, str) and v.strip() for k, v in library.items()):
                terminate(directory, state, "invalid-library-before-publish")
            app = only(session, m.App, m.App.task_id == task_id, m.App.name == app_name)
            app_id = app.id if app else None
        if app_id is None:
            app_id = checked(client.post("/v1/apps", json={"taskId": task_id, "builtAfterRound": 1, "name": app_name}), 201)["id"]
        with platform.db.session() as session:
            published = session.get(m.App, app_id).content
        if digest(published) != digest(library):
            terminate(directory, state, "published-content-mismatch")
        state.update({"appId": app_id, "libraryDigest": digest(library)})
        save(directory / "shared-library.json", library)
        save(path, state)
        return state, library
