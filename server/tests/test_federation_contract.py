"""算法资源契约、单方接入、共享协作和服务私有状态边界。"""
import json
import sqlite3

from fastapi.testclient import TestClient
from fedagent_sdk import Artifact
from intake_helpers import verify_one, verify_resources
from test_api import run
from test_medical import cases, medical_agents, medical_config, medical_dataset

from fedagent import models as m
from fedagent.agents.medical import create_medical_app
from fedagent.agents.protocol import AgentRequest
from fedagent.agents.service import _work
from fedagent.agents.store import AgentStore
from fedagent.data import to_item


def test_one_user_can_verify_one_group_before_joining_federation(client, remote):
    config = medical_config([{"participantId": "p-a", "datasetId": medical_dataset(client, "p-a")}])
    config.update(execution="agent", agentId=remote[0])
    assert verify_one(client, config)["status"] == "passed"
    issues = client.post("/v1/tasks/validate", json=config).json()["issues"]
    assert any("任务合计至少" in row["message"] for row in issues)
    assert len(client.get("/v1/agents").json()) == 1


def test_own_group_combines_with_shared_group_without_private_trajectories(platform, client, remote):
    config = medical_config([{"participantId": p, "datasetId": medical_dataset(client, p)} for p in ("p-a", "p-b")])
    config.update(execution="agent", agentId=remote[0])
    medical_agents(client, config, remote[0])
    other = config["agentOverrides"]["p-b"]
    with platform.db.session() as db:
        for row in (db.get(m.AgentEndpoint, other), db.get(m.Dataset, config["participants"][1]["datasetId"])):
            row.resource_space, row.shared = "public", True
            row.owner_id, row.owner_name = "other-user", "其他共享方"
    verify_resources(client, config)
    checked = client.post("/v1/task-checks", json=config).json()
    assert client.get("/v1/task-checks/"+checked["id"]).json()["status"] == "passed"
    config["checkId"] = checked["id"]
    made = client.post("/v1/tasks", json=config)
    assert made.status_code == 201, made.text
    task_id = made.json()["id"]
    assert run(platform, task_id) == "completed"
    view = client.get("/v1/tasks/"+task_id).json()
    assert view["plan"] == {"1": ["diagnose", "learn", "aggregate"], "2": ["load_memory", "diagnose"]}
    assert view["rounds"][0]["output"] and view["rounds"][1]["output"] is None
    with platform.db.session() as db:
        from sqlalchemy import select
        state = list(db.scalars(select(m.SiteState).where(m.SiteState.task_id == task_id)))
        assert state and all(row.key == "memory_receipt" for row in state)
    used = [r for r in remote[1] if r.task_id == task_id]
    assert all(not r.state for r in used if r.step == "learn")
    assert {r.artifact.version for r in used if r.round == 2} == {1}


def test_contract_is_specific_to_algorithm_and_has_no_registered_resources(client):
    fot = client.get("/v1/algorithms/fot/contract").json()
    evo = client.get("/v1/algorithms/evomedclaw/contract").json()
    assert fot["agentProtocol"] is None
    assert fot["manifest"]["params"][0]["default"] == "paper-auto"
    assert set(fot["dataContracts"]) == {"math-reasoning"}
    assert set(evo["dataContracts"]) == {"medical-diagnosis"}
    assert set(evo["outputContract"]) == {"diagnose", "learn", "load_memory"}
    assert "单个用户" in evo["resourcesNote"]
    assert "base_url" not in json.dumps(evo) and "api_key_enc" not in json.dumps(evo)
    assert client.get("/v1/algorithms/missing/contract").status_code == 404


def test_historical_task_uses_legacy_stages_instead_of_new_plan(platform, client, remote):
    config = medical_config([{"participantId": p, "datasetId": medical_dataset(client, p)} for p in ("p-a", "p-b")])
    config.update(execution="agent", agentId=remote[0])
    medical_agents(client, config, remote[0])
    verify_resources(client, config)
    check = client.post("/v1/task-checks", json=config).json()
    config["checkId"] = check["id"]
    made = client.post("/v1/tasks", json=config).json()
    with platform.db.session() as db:
        task = db.get(m.Task, made["id"])
        task.plugin_version = "1.0.0"
        task.audit = {k: v for k, v in task.audit.items() if k not in ("manifest", "plan")}
    view = client.get("/v1/tasks/"+made["id"]).json()
    assert [s["id"] for s in view["stages"]] == ["diagnose", "learn", "aggregate"]
    assert view["plan"]["2"] == ["diagnose", "learn", "aggregate"]


def test_provider_keeps_trajectories_local_and_requires_loaded_version(platform, tmp_path):
    root = tmp_path / "independent"
    task_type = platform.registry.task_type("medical-diagnosis")
    app = create_medical_app(platform, root, "fake:fake")
    with TestClient(app) as api:
        def execute(body):
            with sqlite3.connect(root / "runs.sqlite") as db:
                db.execute("INSERT INTO runs VALUES(?,?,?)", (body.run_id, "test", '{}'))
            _work(platform.settings.model_dump(), root / "runs.sqlite", body, "fake:fake")
            return api.get("/runs/"+body.run_id).json()

        base = dict(algorithm="evomedclaw", version="1.2.0", task_type="medical-diagnosis", task_id="real-task",
                    site_id="site", role="participant", rounds=2, params={"maxTurns": 4})
        item = to_item(task_type, cases()[1], labels=False)
        first = execute(AgentRequest(**base, run_id="baseline", round=1, step="diagnose", unit_key=item.id, items=[item]))
        assert first["status"] == "succeeded", first
        assert first["result"]["kept"] == [] and "dialogue_history" not in json.dumps(first)
        with AgentStore(root).connect() as db:
            assert "dialogue_history" in db.execute("SELECT output FROM private_state").fetchone()[0]
        artifact = Artifact(1, 1, "clinical-memory", {"memory": {"entries": []}, "cards": []})
        missing = execute(AgentRequest(**base, run_id="no-load", round=2, step="diagnose", unit_key=item.id, items=[item], artifact=artifact))
        assert missing["status"] == "failed"
        loaded = execute(AgentRequest(**base, run_id="load", round=2, step="load_memory", unit_key="_", artifact=artifact))
        assert loaded["status"] == "succeeded", loaded
        from fedagent.agents.protocol import SavedValue
        key, item_id, value = loaded["result"]["kept"][0]
        evaluated = execute(AgentRequest(**base, run_id="evaluated", round=2, step="diagnose", unit_key=item.id, items=[item], artifact=artifact,
                                        state=[SavedValue(key=key, item_id=item_id, round=2, value=value)]))
        assert evaluated["status"] == "succeeded", evaluated
        assert evaluated["result"]["reports"]["experience"] == {"version": 1, "retrieved": []}
        assert AgentStore(root).memory("real-task", "site").version == 1
