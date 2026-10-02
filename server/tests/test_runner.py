"""runner 用真实的子进程运行任务：排队 → 运行 → 完成；进程意外退出时从检查点重启。"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from fedagent import models as m
from fedagent.platform import Platform
from fedagent.runner import Runner


def test_runner_spawns_task_process(client: TestClient, platform: Platform, monkeypatch) -> None:
    monkeypatch.setenv("FEDAGENT_DATA_DIR", str(platform.settings.data_dir))
    body = {
        "scenario": "horizontal",
        "taskType": "math-reasoning",
        "algorithm": "fot",
        "participants": [{"participantId": "p-a", "datasetId": "ds-aime24"}, {"participantId": "p-b", "datasetId": "ds-aime25"}],
        "clientModel": "fake:fake",
        "serverModel": "fake:fake",
        "rounds": 2,
        "mode": "trial",
        "trialCap": 1,
    }
    task_id = client.post("/v1/tasks", json=body).json()["id"]
    runner = Runner(platform)
    deadline = time.monotonic() + 120
    status = "queued"
    while time.monotonic() < deadline:
        runner.tick()
        with platform.db.session() as session:
            status = session.get(m.Task, task_id).status
        if status in ("completed", "paused", "canceled") and not runner.children:
            break
        time.sleep(0.2)
    log = (platform.settings.runs_dir / task_id / "task.log").read_text(encoding="utf-8")
    assert status == "completed", log
    assert "finished with status completed" in log
    assert client.get(f"/v1/tasks/{task_id}").json()["rounds"][1]["output"]["items"]
