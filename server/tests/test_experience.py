import json

import pytest
from fedagent_sdk import ApplyResult, ChatResult, ModelError
from sqlalchemy import select
from test_api import config, run
from test_process_records import record

from fedagent import models as m
from fedagent.experience import evaluation
from fedagent.model_runtime import GatewayModel


def completed(platform, client, algorithm):
    sites = []
    for source in ("a", "b"):
        value = record(True)
        value["id"] = f"training-{source}"
        value["input"]["patient"] += f" {source}"
        created = client.post("/v1/resources/data", data={
            "name": f"records-{source}", "sourceName": source, "hosting": "platform", "taskType": "medical-records",
        }, files={"file": ("records.jsonl", json.dumps(value))})
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
