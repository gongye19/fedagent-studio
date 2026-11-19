"""正常平台API上传、创建与恢复；逐项核对已有资源而不重复创建。"""

import hashlib

from fedagent import models as m
from fedagent.schemas import TaskConfigIn
from sqlalchemy import select

from ...batch.federate import only
from ...common import digest, load, save
from ...runner import checked


def ensure_resources(directory, plan, batch, records, platform, client, state):
    path = directory / batch["id"] / "state.json"
    tag = plan["fingerprint"][:10]
    for source, values in records.items():
        name = f"LifeStyle {source} · {batch['id']} · {tag}"
        raw = (directory / "inputs" / (batch["id"] + "-" + source + ".jsonl")).read_bytes()
        source_name = f"LifeStyle {source} · {tag}"
        with platform.db.session() as session:
            dataset = only(session, m.Dataset, m.Dataset.name == name)
            recovered = {"participantId": dataset.participant_id, "datasetId": dataset.id} if dataset else None
            participant = only(session, m.Participant, m.Participant.name == source_name)
            source_fields = {"sourceId": participant.id} if participant else {"sourceName": source_name}
        if recovered is None:
            if state["status"] == "complete":
                raise ValueError("completed-dataset-missing")
            result = checked(
                client.post(
                    "/v1/resources/data",
                    data={
                        "name": name,
                        **source_fields,
                        "hosting": "platform",
                        "taskType": "lifestyle-records",
                        "description": f"{source}公开资料的模型生成建议过程，第{batch['id'][-2:]}批，共{len(values)}条；非患者或真实医院。",
                    },
                    files={"file": ("process.jsonl", raw, "application/jsonl")},
                ),
                201,
            )
            recovered = {"participantId": result["source"]["id"], "datasetId": result["dataset"]["id"]}
        with platform.db.session() as session:
            dataset = session.get(m.Dataset, recovered["datasetId"])
            participant = session.get(m.Participant, dataset.participant_id)
            if participant.name != source_name or participant.hosting != "platform" or participant.builtin:
                raise ValueError("data-source-binding-changed")
            if dataset.task_type != "lifestyle-records" or dataset.source_hash != hashlib.sha256(raw).hexdigest() or dataset.count != len(values):
                raise ValueError("existing-dataset-mismatch")
            if digest(platform.files.load(dataset.content_path)) != digest(values):
                raise ValueError("existing-dataset-content-changed")
        if source in state["sites"] and state["sites"][source] != recovered:
            raise ValueError("recovered-dataset-identity-changed")
        state["sites"][source] = recovered
        save(path, state)
    config = TaskConfigIn.model_validate(
        {
            "name": f"LifeStyle FoT · 第{int(batch['id'][-2:])}/{len(plan['batches'])}批 · {batch['count']}条资料 · {tag}",
            "scenario": "horizontal",
            "taskType": "lifestyle-records",
            "algorithm": "fot-records",
            "participants": list(state["sites"].values()),
            "clientModel": plan["modelRef"],
            "serverModel": plan["modelRef"],
            "rounds": 1,
            "mode": "full",
            "workers": 2,
            "params": plan["params"],
            "grader": "lifestyle-rubric",
        }
    ).model_dump(by_alias=True)
    with platform.db.session() as session:
        task = only(session, m.Task, m.Task.name == config["name"])
        task_id = task.id if task else None
    if task_id is None:
        if state["status"] == "complete":
            raise ValueError("completed-task-missing")
        task_id = checked(client.post("/v1/tasks", json=config), 201)["id"]
    if state.get("taskId", task_id) != task_id:
        raise ValueError("recovered-task-identity-changed")
    with platform.db.session() as session:
        task = session.get(m.Task, task_id)
        sites = list(session.scalars(select(m.TaskSite).where(m.TaskSite.task_id == task_id, m.TaskSite.kind == "participant")))
        if task.config != config or task.plugin_hash != platform.registry.algorithm("fot-records").code_hash():
            raise ValueError("recovered-task-config-or-code-changed")
        actual = {s.dataset_id: (s.participant_id, set(map(str, s.items))) for s in sites}
        expected = {state["sites"][s]["datasetId"]: (state["sites"][s]["participantId"], {r["id"] for r in values}) for s, values in records.items()}
        if actual != expected:
            raise ValueError("frozen-task-sites-changed")
    state["taskId"] = task_id
    save(path, state)
    return task_id


def publish(directory, plan, batch, platform, client, state):
    with platform.db.session() as session:
        artifacts = list(session.scalars(select(m.Artifact).where(m.Artifact.task_id == state["taskId"])))
        if len(artifacts) != 1:
            raise ValueError("exactly-one-original-fot-library-required")
        library = artifacts[0].content
        if not isinstance(library, dict) or not library or not all(isinstance(k, str) and isinstance(v, str) and v.strip() for k, v in library.items()):
            raise ValueError("invalid-final-library")
        name = f"LifeStyle FoT · 第{int(batch['id'][-2:])}/{len(plan['batches'])}批 · {plan['fingerprint'][:10]}"
        app = only(session, m.App, m.App.task_id == state["taskId"], m.App.name == name)
        app_id = app.id if app else None
    if app_id is None:
        if state.get("appId"):
            raise ValueError("previously-published-app-missing")
        app_id = checked(client.post("/v1/apps", json={"taskId": state["taskId"], "builtAfterRound": 1, "name": name}), 201)["id"]
    if state.get("appId", app_id) != app_id:
        raise ValueError("published-app-identity-changed")
    with platform.db.session() as session:
        app = session.get(m.App, app_id)
        if digest(app.content) != digest(library):
            raise ValueError("published-library-mismatch")
    path = directory / batch["id"] / "library.json"
    if state.get("libraryDigest") and (state["libraryDigest"] != digest(library) or not path.exists() or load(path) != library):
        raise ValueError("completed-library-file-changed")
    save(path, library)
    state.update(appId=app_id, libraryDigest=digest(library), finalEntries=len(library))
