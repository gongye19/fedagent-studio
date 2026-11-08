import json

import pytest
from fedagent_sdk import ApplyResult, ChatResult, ModelError
from sqlalchemy import select
from test_api import config, run
from test_process_records import record

from fedagent import models as m
from fedagent.experience import evaluation
from fedagent.model_runtime import GatewayModel


def completed(platform, client, algorithm, *, sources=("a", "b"), cases_per_site=1):
    sites = []
    for source in sources:
        rows = []
        for i in range(cases_per_site):
            value = record(True)
            value["id"] = f"training-{source}" if i == 0 else f"{source}-{i}"
            value["input"]["patient"] += f" {source}" if i == 0 else f" {source} case {i}"
            rows.append(json.dumps(value))
        created = client.post("/v1/resources/data", data={
            "name": f"records-{source}", "sourceName": source, "hosting": "platform", "taskType": "medical-records",
        }, files={"file": ("records.jsonl", "\n".join(rows))})
        assert created.status_code == 201, created.text
        data = created.json()
        sites.append({"participantId": data["source"]["id"], "datasetId": data["dataset"]["id"]})
    created = client.post("/v1/tasks", json=config(sites, algorithm=algorithm, taskType="medical-records", rounds=1, trialCap=1))
    assert created.status_code == 201, created.text
    task = created.json()["id"]
    assert run(platform, task) == "completed"
    return task, [site["participantId"] for site in sites]


def evaluation_body(sites):
    return {"model": "fake:fake", "sources": [
        {"siteId": site, "jsonl": json.dumps({"id": f"new-{index}", "patient": {"history": f"case {index}", "answer": "nested label"},
                                            "objective": "identify diagnosis", "answer": f"reference-{index}"})}
        for index, site in enumerate(sites)
    ]}


def run_evaluation(platform, task):
    with platform.db.session() as session:
        job = evaluation.find_job(session, task)
        assert job is not None
        job.status = "running"
    return evaluation.run(platform, job)


@pytest.mark.parametrize("algorithm_id", ["fot-records", "evomedclaw-records"])
def test_independent_paired_evaluation_and_resume(platform, client, monkeypatch, algorithm_id):
    task, sites = completed(platform, client, algorithm_id)
    url = f"/v1/tasks/{task}/experience-evaluation"
    body = evaluation_body(sites)
    copied = record(True)["input"]
    copied["patient"] += " a"
    copied.update(id="different-id", objective="changed objective", answer="Pneumonia")
    collision = {"model": "fake:fake", "sources": [dict(body["sources"][0], jsonl=json.dumps(copied)), body["sources"][1]]}
    assert client.post(url, json=collision).status_code == 422
    response = client.post(url, json=body)
    assert response.status_code == 201, response.text
    assert client.post(url, json=body).status_code == 409
    assert [row["id"] for row in client.get("/v1/tasks").json()] == [task]
    assert client.delete(f"/v1/tasks/{task}").status_code == 409

    algorithm = platform.registry.algorithm(algorithm_id)
    original = algorithm.run_step
    senders = []

    def inspect_step(ctx):
        for channel in ctx.step.reads:
            senders.append({message.sender for message in ctx.inbox(channel)})
        return original(ctx)

    responses = []
    interrupted = False

    def reply(artifact, request, model):
        nonlocal interrupted
        assert "answer" not in json.dumps(request.input)
        case_id = request.input["id"]
        responses.append(case_id)
        if case_id == "new-1" and not interrupted:
            interrupted = True
            raise ModelError("temporary test failure")
        return ApplyResult("matched" if artifact is not None else "unmatched")

    grader = platform.registry.grader("diagnosis-clinical")
    monkeypatch.setattr(algorithm, "run_step", inspect_step)
    monkeypatch.setattr(algorithm, "apply", reply)
    monkeypatch.setattr(grader, "evaluate", lambda prediction, item, model: prediction == "matched")
    assert run_evaluation(platform, task) == "paused"
    partial = client.get(url).json()
    assert partial["score"]["paired"] == 1
    assert partial["cases"][1]["change"] == "incomplete"
    assert client.post(f"{url}/resume").status_code == 200
    assert run_evaluation(platform, task) == "completed"
    result = client.get(url).json()
    assert result["score"] == {"total": 2, "paired": 2, "attempted": 6, "none": 0, "local": 2, "federated": 2,
                                "improved": 0, "worsened": 0, "unchanged": 2}
    assert all(case["caseId"].startswith("病例 ") and not case["reference"] and
               all(arm["output"] is None for arm in case["arms"].values()) for case in result["cases"])
    assert len(responses) == 7
    assert senders == [{sites[0]}, {sites[1]}]
    assert client.get(f"/v1/tasks/{task}").json()["status"] == "completed"
    assert client.delete(f"/v1/tasks/{task}").status_code == 204
    with platform.db.session() as session:
        assert not session.scalars(select(m.Task).where(m.Task.source_task_id == task)).all()


def test_consultation_uses_history_and_fixed_package(platform, client, monkeypatch):
    task, _ = completed(platform, client, "fot-records")
    response = client.post("/v1/apps", json={"taskId": task, "builtAfterRound": 1, "name": "medical"})
    assert response.status_code == 201, response.text
    app = response.json()

    def reply(self, messages, **kwargs):
        payload = json.loads(messages[-1]["content"])
        assert payload["dialogue"][0] == {"role": "user", "content": "I am 42"}
        assert payload["dialogue"][1]["content"] == "How long?"
        assert payload["dialogue"][2]["content"] == "Three days"
        assert payload["experience"]
        return ChatResult("Follow-up response", model=self.name)

    monkeypatch.setattr(GatewayModel, "chat", reply)
    url = f"/v1/apps/{app['id']}/chat"
    body = {"model": "fake:fake", "messages": [{"role": "user", "content": "I am 42"},
            {"role": "assistant", "content": "How long?"}, {"role": "user", "content": "Three days"}]}
    response = client.post(url, json=body)
    assert response.status_code == 200, response.text
    assert response.json()["output"] == "Follow-up response"
    body["messages"].pop()
    assert client.post(url, json=body).status_code == 422


@pytest.mark.parametrize("algorithm_id", ["fot-records", "evomedclaw-records"])
def test_consultation_routes_baseline_and_package_with_same_prompt(platform, client, monkeypatch, algorithm_id):
    task, _ = completed(platform, client, algorithm_id)
    published = client.post("/v1/apps", json={"taskId": task, "builtAfterRound": 1, "name": "medical"})
    assert published.status_code == 201, published.text
    package_id = published.json()["id"]
    if algorithm_id == "evomedclaw-records":
        with platform.db.session() as session:
            session.get(m.App, package_id).content = {"memory": {"entries": [{
                "entry_id": "card-1", "department": "pediatrics", "owner_role": "local_doctor",
                "stage": "synthesis", "summary": "Two clinical clues", "guidance": "Review the findings together.",
                "required_evidence": ["prematurity", "chorioamnionitis"],
            }]}}
    calls = []

    def reply(self, messages, **kwargs):
        payload = json.loads(messages[-1]["content"])
        calls.append((messages[0], payload))
        if payload["dialogue"][-1]["content"] == "bad response":
            return ChatResult('{"department":"invented department","output":"text","suggestions":[]}', model=self.name)
        return ChatResult(json.dumps({
            "department": "呼吸内科", "output": "咳嗽多久了？", "suggestions": ["三天。", "一周。"],
        }), model=self.name)

    monkeypatch.setattr(GatewayModel, "chat", reply)
    url = "/v1/consultation/chat"
    question = "宝宝早产，我产前有绒毛膜羊膜炎。" if algorithm_id == "evomedclaw-records" else "晚上咳嗽"
    body = {"model": "fake:fake", "messages": [{"role": "user", "content": question}]}
    baseline = client.post(url, json=body)
    augmented = client.post(url, json={**body, "packageId": package_id})
    assert baseline.status_code == augmented.status_code == 200
    assert baseline.json() == {"department": "呼吸内科", "output": "咳嗽多久了？",
                               "suggestions": ["三天。", "一周。"], "experienceEntries": 0}
    assert augmented.json()["experienceEntries"] > 0
    assert calls[0][0] == calls[1][0]
    assert calls[0][1]["dialogue"] == calls[1][1]["dialogue"] == body["messages"]
    assert not calls[0][1]["experience"] and calls[1][1]["experience"]
    if algorithm_id == "evomedclaw-records":
        assert [item["id"] for item in calls[1][1]["experience"]] == ["card-1"]
    assert client.post(url, json={**body, "packageId": "missing"}).status_code == 404
    assert client.post(url, json={**body, "model": "missing:missing"}).status_code == 422
    assert len(calls) == 2
    if algorithm_id == "evomedclaw-records":
        unrelated = {**body, "packageId": package_id, "messages": [{"role": "user", "content": "晚上咳嗽"}]}
        assert client.post(url, json=unrelated).json()["experienceEntries"] == 0
    body["messages"][0]["content"] = "bad response"
    assert client.post(url, json=body).status_code == 502


def test_published_package_evaluation_keeps_pairs_separate_and_legacy_intact(platform, client, monkeypatch):
    from fedagent.experience import package_evaluation

    source, sites = completed(platform, client, "fot-records")
    published = client.post("/v1/apps", json={"taskId": source, "builtAfterRound": 1, "name": "FoT"})
    app = published.json()["id"]
    legacy = f"/v1/tasks/{source}/experience-evaluation"
    assert client.post(legacy, json=evaluation_body(sites)).status_code == 201
    dataset_ids = []
    for name in ("a", "b"):
        rows = []
        for i in range(54):
            value = record(True)
            value["id"] = f"training-{name}" if i == 0 else f"eval-{name}-{i}"
            value["input"]["patient"] += f" {name}" if i == 0 else f" {name} unique {i} Pneumonia"
            rows.append(json.dumps(value))
        created = client.post("/v1/resources/data", data={
            "name": f"eval-{name}", "sourceName": name, "hosting": "platform", "taskType": "medical-records",
        }, files={"file": ("records.jsonl", "\n".join(rows))})
        assert created.status_code == 201, created.text
        dataset_ids.append(created.json()["dataset"]["id"])

    with platform.db.session() as session:
        first_path = session.get(m.Dataset, dataset_ids[0]).content_path
    load = platform.files.load

    def with_unlabeled(path):
        rows = load(path)
        if path != first_path:
            return rows
        # 兼容历史上少量未标注的记录，同时保留结果对应的原始行号。
        return [{"id": "unlabeled", "input": {}}, *rows]

    monkeypatch.setattr(platform.files, "load", with_unlabeled)
    url = "/v1/evaluations"
    payload = {"packageId": app, "model": "fake:fake", "datasetIds": dataset_ids}
    assert client.post(url, json={**payload, "datasetIds": dataset_ids[:1] * 2}).status_code == 422
    started = client.post(url, json=payload)
    assert started.status_code == 201, started.text
    job_id = started.json()["id"]
    assert started.json()["total"] == 108 and started.json()["usage"] == "mixed"
    assert client.post(url, json=payload).status_code == 409
    assert client.get(legacy).json()["score"]["total"] == 2
    assert client.get(f"/v1/tasks/{job_id}").status_code == 404
    assert client.post(f"/v1/tasks/{job_id}/cancel").status_code == 404
    assert client.get(f"/v1/tasks/{job_id}/messages").status_code == 404
    assert client.delete(f"/v1/tasks/{source}").status_code == 409

    algorithm = platform.registry.algorithm("fot-records")
    grader = platform.registry.grader("diagnosis-clinical")
    inputs = []
    fail = True

    def reply(artifact, request, model):
        evidence = request.input
        assert set(evidence) <= {"patient", "objective", "examination", "tests"}
        assert "Pneumonia" not in json.dumps(evidence)
        inputs.append((artifact is not None, evidence["patient"]))
        if artifact is not None and evidence["patient"].endswith(" a") and fail:
            raise ModelError("temporary test failure")
        if evidence["patient"].endswith(" b"):
            return ApplyResult("wrong" if artifact is not None else "correct")
        return ApplyResult("correct" if artifact is not None else "wrong")

    monkeypatch.setattr(algorithm, "apply", reply)
    monkeypatch.setattr(grader, "evaluate", lambda prediction, item, model: prediction == "correct")

    def run_job():
        with platform.db.session() as session:
            job = package_evaluation.get(session, job_id)
            job.status = "running"
        return package_evaluation.run(platform, job)

    assert client.delete(f"/v1/apps/{app}").status_code == 204
    assert run_job() == "paused"
    partial = client.get(f"{url}/{job_id}").json()
    assert partial["paired"] == 107
    assert partial["cases"][0]["change"] == "incomplete"
    assert client.post(f"{url}/{job_id}/resume").status_code == 200
    fail = False
    assert run_job() == "completed"
    result = client.get(f"{url}/{job_id}").json()
    assert result["paired"] == 108 and len(inputs) == 217
    assert [(item["usage"], item["paired"], item["improved"], item["worsened"]) for item in result["sites"]] == [
        ("backtest", 1, 1, 0), ("heldout", 53, 53, 0), ("backtest", 1, 0, 1), ("heldout", 53, 53, 0),
    ]
    assert result["cases"][0]["caseId"] == "病例 2"
    assert result["cases"][54]["caseId"] == "病例 1"
    assert result["cases"][0]["change"] == "improved"
    assert result["cases"][54]["change"] == "worsened"
    assert not any(value in json.dumps(result) for value in ("Pneumonia", "training-a", "reference", "unique 1"))
    assert client.get(url).json()[0]["id"] == job_id

    second_app = client.post("/v1/apps", json={"taskId": source, "builtAfterRound": 1, "name": "FoT"}).json()["id"]
    second = client.post(url, json={**payload, "packageId": second_app, "limit": 1}).json()["id"]
    assert client.post(f"{url}/{second}/cancel").status_code == 200
    with platform.db.session() as session:
        legacy_id = evaluation.find_job(session, source).id
    assert client.post(f"{legacy}/cancel").status_code == 200
    for id_ in (legacy_id, job_id, second):
        (platform.settings.runs_dir / id_).mkdir(exist_ok=True, parents=True)
    assert client.delete(f"/v1/tasks/{source}").status_code == 204
    assert client.get(url).json() == []
    with platform.db.session() as session:
        assert not session.scalars(select(m.Event).where(m.Event.task_id.in_([legacy_id, job_id, second]))).all()
    assert all(not (platform.settings.runs_dir / id_).exists() for id_ in (legacy_id, job_id, second))



def test_package_evaluation_defaults_to_all_source_cases(platform, client):
    source, _ = completed(platform, client, "fot-records", sources=("a", "b", "c"), cases_per_site=101)
    app = client.post("/v1/apps", json={"taskId": source, "builtAfterRound": 1, "name": "FoT"}).json()["id"]
    payload = {"packageId": app, "model": "fake:fake"}

    assert client.post("/v1/evaluations", json={**payload, "limit": 1}).status_code == 422
    response = client.post("/v1/evaluations", json=payload)
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["total"] == 303
    assert result["usage"] == "mixed"
    assert [(site["name"], site["usage"], site["total"]) for site in result["sites"]] == [
        (f"records-{source_name}", usage, total)
        for source_name in ("a", "b", "c")
        for usage, total in (("backtest", 1), ("heldout", 100))
    ]
