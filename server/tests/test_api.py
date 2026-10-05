"""API 从头到尾：注册表、参与方与数据、模型接口、新建任务、运行、任务详情、通信记录、发布应用、试用、导出。"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path

from fastapi.testclient import TestClient
from fedagent_client.worker import ClientConfig, Worker

from fedagent import models as m
from fedagent.engine import TaskEngine
from fedagent.platform import Platform
from fedagent.seed import BUILTIN_DIR


def config(participants: list[dict], **extra) -> dict:
    return {
        "name": "测试任务",
        "scenario": "horizontal",
        "taskType": "math-reasoning",
        "algorithm": "fot",
        "participants": participants,
        "clientModel": "fake:fake",
        "serverModel": "fake:fake",
        "rounds": 2,
        "mode": "trial",
        "trialCap": 2,
        **extra,
    }


def run(platform: Platform, task_id: str) -> str:
    with platform.db.session() as session:
        session.get(m.Task, task_id).status = "running"
    return TaskEngine(platform, task_id, poll=0.01).run()


def test_registry_describes_plugins(client: TestClient) -> None:
    data = client.get("/v1/registry").json()
    assert [item["status"] for item in data["scenarios"]] == ["available", "planned", "planned"]
    fot = next(item for item in data["algorithms"] if item["id"] == "fot")
    assert [stage["id"] for stage in fot["stages"]] == ["solve", "reflect", "extract", "collect", "profile", "library"]
    assert fot["output"] == {"name": "经验库", "unit": "条经验"} and fot["minParticipants"] == 2
    assert data["taskTypes"][0]["grader"] == "math-answer"


def test_seed_and_participants(client: TestClient) -> None:
    participants = client.get("/v1/participants").json()
    assert [item["name"] for item in participants][:2] == ["示例合作方", "参与方 A"]
    assert participants[0]["status"] == "waiting"
    datasets = {item["id"]: item for item in client.get("/v1/datasets").json()}
    assert datasets["ds-aime24"]["ready"] and not datasets["ds-amc"]["ready"]


def test_fake_endpoint_only_when_enabled(tmp_path: Path) -> None:
    from fedagent.seed import seed
    from fedagent.settings import Settings

    # 本地开发、测试时开启；部署的平台不开，已有的也会删掉，只留真实接口
    seed(Platform.create(Settings(data_dir=tmp_path, fake_endpoint=True)))
    with Platform.create(Settings(data_dir=tmp_path, fake_endpoint=True)).db.session() as session:
        assert session.get(m.Endpoint, "fake") is not None
    deployed = Platform.create(Settings(data_dir=tmp_path))
    seed(deployed)
    with deployed.db.session() as session:
        assert session.get(m.Endpoint, "fake") is None
        assert session.get(m.Endpoint, "default") is not None


def test_upload_check_and_create(client: TestClient) -> None:
    bad = client.post("/v1/datasets/check", data={"taskType": "math-reasoning"}, files={"file": ("d.jsonl", b'{"id": 1}\n')}).json()
    assert not bad["ok"] and bad["problems"][0]["message"] == "缺少 question，或 question 不是文本"
    created = client.post(
        "/v1/participants",
        data={"name": "实验室", "hosting": "platform", "datasetName": "习题", "scenario": "horizontal", "taskType": "math-reasoning"},
        files={"file": ("d.jsonl", b'{"id": 1, "question": "1+1?", "answer": "2"}\n{"id": 2, "question": "2+2?"}\n')},
    )
    assert created.status_code == 201, created.text
    participant = created.json()
    datasets = client.get("/v1/datasets", params={"participant": participant["id"]}).json()
    assert datasets[0]["count"] == 2 and datasets[0]["answered"] == 1 and datasets[0]["ready"]
    rejected = client.post(
        "/v1/participants",
        data={"name": "坏数据", "hosting": "platform", "datasetName": "x", "scenario": "horizontal", "taskType": "math-reasoning"},
        files={"file": ("d.jsonl", b"not json\n")},
    )
    assert rejected.status_code == 422
    assert all(item["name"] != "坏数据" for item in client.get("/v1/participants").json())


def test_endpoint_key_is_write_only(client: TestClient) -> None:
    base = {"name": "DeepSeek", "baseUrl": "https://api.deepseek.com/v1", "models": ["deepseek-chat"]}
    created = client.post("/v1/endpoints", json={**base, "apiKey": "sk-secret"}).json()
    assert created["hasKey"] and created["configured"] and "apiKey" not in created
    listed = client.get("/v1/endpoints").text
    assert "sk-secret" not in listed
    kept = client.put(f"/v1/endpoints/{created['id']}", json=base).json()
    assert kept["hasKey"]
    cleared = client.put(f"/v1/endpoints/{created['id']}", json={**base, "apiKey": ""}).json()
    assert not cleared["hasKey"]


def test_validation_issues(client: TestClient) -> None:
    chosen = [{"participantId": "p-a", "datasetId": "ds-aime24"}, {"participantId": "p-c", "datasetId": "ds-amc"}]
    result = client.post("/v1/tasks/validate", json=config(chosen, clientModel="default")).json()
    messages = [issue["message"] for issue in result["issues"]]
    assert "AMC 还没有样本（题目文件待导入）" in messages
    assert any("至少要选 2 个" in message for message in messages)
    assert any("默认 LLM 接口" in message and "还没有配置" in message for message in messages)


def test_full_flow_with_fake_model(client: TestClient, platform: Platform) -> None:
    body = config([{"participantId": "p-a", "datasetId": "ds-aime24"}, {"participantId": "p-b", "datasetId": "ds-aime25"}])
    validated = client.post("/v1/tasks/validate", json=body).json()
    assert validated["issues"] == []
    assert validated["estimate"]["problems"] == 4 and validated["estimate"]["participantCalls"] == 4 * 3 * 2
    created = client.post("/v1/tasks", json=body)
    assert created.status_code == 201, created.text
    task_id = created.json()["id"]
    assert created.json()["status"] == "queued"
    assert run(platform, task_id) == "completed"

    task = client.get(f"/v1/tasks/{task_id}").json()
    assert task["status"] == "completed" and task["cursor"] is None and task["fake"]
    assert [member["problems"] for member in task["members"]] == [2, 2]
    first, second = task["rounds"]
    assert set(first["correct"]) == {"p-a", "p-b"} and first["uploads"] == {"p-a": 4, "p-b": 4}
    assert first["groups"] and first["output"]["builtAfterRound"] == 1 and first["output"]["uploadCount"] == 8
    assert second["output"]["items"]

    messages = client.get(f"/v1/tasks/{task_id}/messages", params={"round": 1, "site": "p-a"}).json()
    assert len(messages) == 4 and messages[0]["key"].startswith("insight_trace_")

    app = client.post("/v1/apps", json={"taskId": task_id, "builtAfterRound": 2, "name": "测试经验库"})
    assert app.status_code == 201, app.text
    app_id = app.json()["id"]
    assert client.post("/v1/apps", json={"taskId": task_id, "builtAfterRound": 2, "name": "重复"}).status_code == 409
    tried = client.post(f"/v1/apps/{app_id}/apply", json={"input": "What is 1+1?", "answer": "2", "model": "fake:fake"}).json()
    assert set(tried) == {"with", "without"} and "\\boxed" in tried["with"]["output"]
    exported = client.get(f"/v1/apps/{app_id}/export")
    assert exported.headers["content-disposition"].endswith('library_r3.json"')
    assert json.loads(exported.content) == {item["key"]: item["text"] for item in app.json()["items"]}
    events = [event["kind"] for event in client.get(f"/v1/tasks/{task_id}/events").json()]
    assert events[0] == "create" and events[-1] == "complete"


def test_pause_resume_cancel(client: TestClient, platform: Platform) -> None:
    body = config([{"participantId": "p-a", "datasetId": "ds-aime24"}, {"participantId": "p-b", "datasetId": "ds-aime25"}])
    task_id = client.post("/v1/tasks", json=body).json()["id"]
    assert client.post(f"/v1/tasks/{task_id}/pause").json()["status"] == "paused"
    assert client.post(f"/v1/tasks/{task_id}/resume").json()["status"] == "queued"
    assert client.post(f"/v1/tasks/{task_id}/cancel").json()["status"] == "canceled"
    assert client.post(f"/v1/tasks/{task_id}/resume").status_code == 409


def test_local_participant_runs_through_client(client: TestClient, platform: Platform, tmp_path: Path) -> None:
    """一方平台托管、一方本地客户端：客户端只提交消息和判分汇总，私有结果不上平台。"""
    created = client.post(
        "/v1/participants",
        data={"name": "合作医院", "hosting": "local", "datasetName": "院内题库", "scenario": "horizontal", "taskType": "math-reasoning"},
    ).json()
    participant_id = created["id"]
    dataset_id = client.get("/v1/datasets", params={"participant": participant_id}).json()[0]["id"]
    token = client.post(f"/v1/participants/{participant_id}/client-tokens").json()["token"]
    local_file = tmp_path / "local.jsonl"
    local_file.write_text((BUILTIN_DIR / "AIME25.jsonl").read_text(encoding="utf-8"), encoding="utf-8")
    worker = Worker(
        ClientConfig(server="http://testserver", token=token, datasets={dataset_id: local_file}, state_path=tmp_path / "client.db", fake_model=True),
        transport=client._transport,
    )
    hello = worker.hello()
    assert hello["datasets"] == [dataset_id]
    assert next(item for item in client.get("/v1/participants").json() if item["id"] == participant_id)["status"] == "online"

    body = config([{"participantId": "p-a", "datasetId": "ds-aime24"}, {"participantId": participant_id, "datasetId": dataset_id}])
    task_id = client.post("/v1/tasks", json=body).json()["id"]
    result: dict[str, str] = {}
    with platform.db.session() as session:
        session.get(m.Task, task_id).status = "running"
    engine = threading.Thread(target=lambda: result.setdefault("status", TaskEngine(platform, task_id, poll=0.01).run()))
    engine.start()
    deadline = time.monotonic() + 60
    while engine.is_alive() and time.monotonic() < deadline:
        if worker.run_once() == 0:
            time.sleep(0.02)
    engine.join(timeout=5)
    assert result.get("status") == "completed"

    task = client.get(f"/v1/tasks/{task_id}").json()
    assert task["members"][1]["hosting"] == "local"
    assert all(participant_id in record["correct"] for record in task["rounds"])
    assert task["rounds"][0]["uploads"][participant_id] > 0
    with platform.db.session() as session:
        private_rows = session.query(m.SiteState).filter_by(task_id=task_id, site_id=participant_id).count()
    assert private_rows == 0


def test_token_frontend_and_client_packages(tmp_path: Path) -> None:
    from fedagent.api import create_app
    from fedagent.settings import Settings

    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>FedAgent Studio</title>", encoding="utf-8")
    (dist / "assets").mkdir()
    (dist / "assets" / "index-abc123.js").write_text("console.log('fedagent');" * 100, encoding="utf-8")
    packages = tmp_path / "client"
    packages.mkdir()
    wheel = "fedagent_client-0.1.0-py3-none-any.whl"
    (packages / wheel).write_bytes(b"wheel")
    settings = Settings(data_dir=tmp_path / "data", admin_token="secret-token", frontend_dist=dist, client_dist=packages)
    with TestClient(create_app(Platform.create(settings))) as client:
        meta = client.get("/v1/meta").json()
        assert meta["authRequired"] is True
        assert meta["clientPackages"] == [wheel]
        assert client.get("/v1/registry").status_code == 401
        assert client.get("/v1/registry", headers={"Authorization": "Bearer wrong"}).status_code == 401
        assert client.get("/v1/registry", headers={"Authorization": "Bearer secret-token"}).status_code == 200
        # 页面和安装包不需要令牌
        page = client.get("/")
        assert "FedAgent Studio" in page.text
        assert page.headers["cache-control"] == "no-cache"
        assert client.get(f"/client/{wheel}").content == b"wheel"
        assert client.get("/healthz").json() == {"ok": True}
        # 带哈希的脚本长期缓存，并且压缩后发送
        script = client.get("/assets/index-abc123.js", headers={"Accept-Encoding": "gzip"})
        assert script.headers["cache-control"] == "public, max-age=31536000, immutable"
        assert script.headers["content-encoding"] == "gzip"
        assert script.text == "console.log('fedagent');" * 100
