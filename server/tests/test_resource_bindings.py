"""成组接入的真实任务绑定、公共边界及配置测试失效。"""

from sqlalchemy import select
from test_medical import medical_config, medical_dataset

from fedagent import models as m
from fedagent.engine import TaskEngine


def setup_groups(platform, client, remote):
    first = remote[0]
    second = client.post("/v1/agents", json={"name": "协作 Agent", "baseUrl": "https://collaborator.test"}).json()["id"]
    datasets = [medical_dataset(client, p) for p in ("p-a", "p-b")]
    for dataset, agent in zip(datasets, [first, second], strict=True):
        r = client.patch(f"/v1/resources/data/{dataset}/agent", json={"agentId": agent})
        assert r.status_code == 200, r.text
    with platform.db.session() as session:
        session.get(m.Dataset, datasets[1]).resource_space = "public"
        session.get(m.AgentEndpoint, second).resource_space = "public"
    body = medical_config([{"participantId": p, "datasetId": d} for p, d in zip(("p-a", "p-b"), datasets, strict=True)])
    body.update(execution="agent", agentId=None, agentOverrides={})
    return datasets, [first, second], body


def test_groups_use_bound_agents_without_global_default_and_preserve_frozen_task(platform, client, remote):
    datasets, agents, body = setup_groups(platform, client, remote)
    assert client.post("/v1/tasks/validate", json=body).json()["issues"] == []
    check = client.post("/v1/task-checks", json=body).json()["id"]
    assert client.get("/v1/task-checks/" + check).json()["status"] == "passed"
    body["checkId"] = check
    made = client.post("/v1/tasks", json=body)
    assert made.status_code == 201, made.text
    task_id = made.json()["id"]
    with platform.db.session() as session:
        sites = list(session.scalars(select(m.TaskSite).where(m.TaskSite.task_id == task_id, m.TaskSite.kind == "participant").order_by(m.TaskSite.id)))
        assert [s.model_ref for s in sites] == ["agent:" + a for a in agents]
        session.get(m.Task, task_id).status = "running"
    assert client.patch(f"/v1/resources/data/{datasets[0]}/agent", json={"agentId": None}).status_code == 409
    assert TaskEngine(platform, task_id, poll=0.01).run() == "completed"
    assert client.patch(f"/v1/resources/data/{datasets[0]}/agent", json={"agentId": agents[1]}).status_code == 200
    frozen = client.get("/v1/tasks/" + task_id).json()
    assert {r["model"] for r in frozen["members"]} == {"agent:" + a for a in agents}


def test_public_group_cannot_be_rebound_or_overridden_and_binding_prevents_deletion(platform, client, remote):
    datasets, agents, body = setup_groups(platform, client, remote)
    assert client.patch(f"/v1/resources/data/{datasets[1]}/agent", json={"agentId": agents[0]}).status_code == 409
    body["agentOverrides"] = {"p-b": agents[0]}
    issues = client.post("/v1/tasks/validate", json=body).json()["issues"]
    assert any("公用协作组" in i["message"] for i in issues)
    assert client.post("/v1/task-checks", json=body).status_code == 422
    assert client.put("/v1/agents/" + agents[1], json={"name": "替换", "baseUrl": "https://wrong.test"}).status_code == 409
    assert client.delete("/v1/agents/" + agents[1]).status_code == 409
    assert client.patch(f"/v1/resources/data/{datasets[0]}/agent", json={"agentId": ""}).status_code == 422
    assert client.delete("/v1/agents/" + agents[0]).status_code == 409
    assert client.patch(f"/v1/resources/data/{datasets[0]}/agent", json={"agentId": None}).status_code == 200
    assert client.delete("/v1/agents/" + agents[0]).status_code == 204


def test_binding_change_invalidates_passed_check_and_wrong_algorithm_is_rejected(platform, client, remote):
    datasets, agents, body = setup_groups(platform, client, remote)
    check = client.post("/v1/task-checks", json=body).json()["id"]
    assert client.get("/v1/task-checks/" + check).json()["status"] == "passed"
    assert client.patch(f"/v1/resources/data/{datasets[0]}/agent", json={"agentId": agents[1]}).status_code == 200
    body["checkId"] = check
    assert client.post("/v1/tasks", json=body).status_code == 422
    with platform.db.session() as session:
        agent = session.get(m.AgentEndpoint, agents[0])
        agent.capabilities = {"protocol": "fedagent-agent/1", "algorithms": {"fot": {"version": "1.0.0", "steps": ["solve", "reflect", "extract"]}}}
    assert client.patch(f"/v1/resources/data/{datasets[0]}/agent", json={"agentId": agents[0]}).status_code == 422
