"""独立资源共享、任务内配对与测试失效的业务边界。"""
from sqlalchemy import select
from test_medical import medical_config, medical_dataset

from fedagent import models as m
from fedagent.engine import TaskEngine


def setup_groups(platform, client, remote):
    first = remote[0]
    second = client.post("/v1/agents", json={"name": "协作 Agent", "baseUrl": "https://collaborator.test"}).json()["id"]
    assert client.post("/v1/agents/" + second + "/check").status_code == 200
    datasets = [medical_dataset(client, p) for p in ("p-a", "p-b")]
    with platform.db.session() as session:
        for row in (session.get(m.Dataset, datasets[1]), session.get(m.AgentEndpoint, second)):
            row.resource_space, row.owner_id, row.owner_name, row.shared = "public", "peer-b", "团队协作系统 B", True
    body = medical_config([{"participantId": p, "datasetId": d} for p, d in zip(("p-a", "p-b"), datasets, strict=True)])
    body.update(execution="agent", agentId=None, agentOverrides={"p-a": first, "p-b": second})
    return datasets, [first, second], body


def test_task_pairs_independent_resources_and_freezes_original_endpoints(platform, client, remote):
    datasets, agents, body = setup_groups(platform, client, remote)
    assert client.post("/v1/tasks/validate", json=body).json()["issues"] == []
    check = client.post("/v1/task-checks", json=body).json()["id"]
    assert client.get("/v1/task-checks/" + check).json()["status"] == "passed"
    made = client.post("/v1/tasks", json={**body, "checkId": check})
    assert made.status_code == 201, made.text
    task_id = made.json()["id"]
    with platform.db.session() as session:
        sites = list(session.scalars(select(m.TaskSite).where(m.TaskSite.task_id == task_id, m.TaskSite.kind == "participant").order_by(m.TaskSite.id)))
        assert [s.model_ref for s in sites] == ["agent:" + a for a in agents]
        session.get(m.Task, task_id).status = "running"
        # 撤回共享约束新配置，不回溯终止已经开始的授权运行。
        session.get(m.Dataset, datasets[1]).shared = False
        session.get(m.AgentEndpoint, agents[1]).shared = False
    assert TaskEngine(platform, task_id, poll=0.01).run() == "completed"
    assert client.delete("/v1/agents/" + agents[0]).status_code == 204
    frozen = client.get("/v1/tasks/" + task_id).json()
    assert {r["model"] for r in frozen["members"]} == {"agent:" + a for a in agents}
    assert all("agentId" not in row for row in client.get("/v1/datasets").json())
    assert client.patch(f"/v1/resources/data/{datasets[0]}/agent", json={"agentId": agents[1]}).status_code == 404


def test_owner_mismatch_duplicate_system_and_withdrawn_data_are_rejected(platform, client, remote):
    datasets, agents, body = setup_groups(platform, client, remote)
    wrong = {**body, "agentOverrides": {"p-a": agents[0], "p-b": agents[0]}}
    assert any("不属于同一方" in i["message"] for i in client.post("/v1/tasks/validate", json=wrong).json()["issues"])
    with platform.db.session() as session:
        session.get(m.AgentEndpoint, agents[1]).owner_id = "workspace"
        session.get(m.Dataset, datasets[1]).owner_id = "workspace"
    assert any("不同的 Agent" in i["message"] for i in client.post("/v1/tasks/validate", json=wrong).json()["issues"])
    with platform.db.session() as session:
        session.get(m.Dataset, datasets[1]).shared = False
    assert client.post("/v1/task-checks", json=body).status_code == 422
    assert client.put("/v1/agents/" + agents[1], json={"name": "替换", "baseUrl": "https://wrong.test"}).status_code == 409
    assert client.delete("/v1/agents/" + agents[1]).status_code == 409
    assert client.patch(f"/v1/resources/agent/{agents[1]}/sharing", json={"shared": False}).status_code == 403


def test_shared_resources_keep_ownership_and_share_independently(platform, client, remote):
    datasets, agents, body = setup_groups(platform, client, remote)
    def sharing(kind, id, value):
        result = client.patch(f"/v1/resources/{kind}/{id}/sharing", json={"shared": value})
        assert result.status_code == 200, result.text
        return result.json()
    check = client.post("/v1/task-checks", json=body).json()["id"]
    own = sharing("agent", agents[0], True)
    assert own["resourceSpace"] == "workspace" and own["shared"] and own["ownerId"] == "workspace"
    assert not next(d for d in client.get("/v1/datasets").json() if d["id"] == datasets[0])["shared"]
    assert client.post("/v1/tasks", json={**body, "checkId": check}).status_code == 422
    sharing("data", datasets[0], True)
    sharing("agent", agents[0], False)
    assert next(d for d in client.get("/v1/datasets").json() if d["id"] == datasets[0])["shared"]
    llm = client.post("/v1/endpoints", json={"name": "仅测试LLM", "baseUrl": "https://llm.test/v1", "models": ["m"]}).json()["id"]
    assert sharing("llm", llm, True)["shared"]


def test_all_shared_groups_support_formal_configuration_but_unchecked_agent_is_rejected(platform, client, remote):
    datasets, agents, body = setup_groups(platform, client, remote)
    with platform.db.session() as session:
        for row in (session.get(m.Dataset, datasets[0]), session.get(m.AgentEndpoint, agents[0])):
            row.resource_space, row.owner_id, row.owner_name, row.shared = "public", "peer-a", "团队协作系统 A", True
    body["mode"] = "full"
    assert client.post("/v1/tasks/validate", json=body).json()["issues"] == []
    with platform.db.session() as session:
        session.get(m.AgentEndpoint, agents[0]).capabilities = None
    issues = client.post("/v1/tasks/validate", json=body).json()["issues"]
    assert any("尚未完成能力检查" in row["message"] for row in issues)
    before = len(remote[1])
    assert client.post("/v1/task-checks", json=body).status_code == 422
    assert len(remote[1]) == before
