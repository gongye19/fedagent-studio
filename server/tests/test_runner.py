"""runner 用真实的子进程运行任务：排队 → 运行 → 完成；进程意外退出、runner 重启时从检查点继续，不会同时跑两个进程。"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time

from fastapi.testclient import TestClient

from fedagent import models as m
from fedagent.platform import Platform
from fedagent.runner import Runner, leftover_process

BODY = {
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


def run_until_done(runner: Runner, platform: Platform, task_id: str) -> str:
    deadline = time.monotonic() + 120
    status = "queued"
    while time.monotonic() < deadline:
        runner.tick()
        with platform.db.session() as session:
            status = session.get(m.Task, task_id).status
        if status in ("completed", "paused", "canceled") and not runner.children:
            break
        time.sleep(0.2)
    return status


def test_runner_spawns_task_process(client: TestClient, platform: Platform, monkeypatch) -> None:
    monkeypatch.setenv("FEDAGENT_DATA_DIR", str(platform.settings.data_dir))
    task_id = client.post("/v1/tasks", json=BODY).json()["id"]
    status = run_until_done(Runner(platform), platform, task_id)
    log = (platform.settings.runs_dir / task_id / "task.log").read_text(encoding="utf-8")
    assert status == "completed", log
    assert "finished with status completed" in log
    assert client.get(f"/v1/tasks/{task_id}").json()["rounds"][1]["output"]["items"]


def test_runner_restart_continues_without_duplicate_process(client: TestClient, platform: Platform, monkeypatch) -> None:
    monkeypatch.setenv("FEDAGENT_DATA_DIR", str(platform.settings.data_dir))
    task_id = client.post("/v1/tasks", json=BODY).json()["id"]
    # 上一个 runner 被强行结束，留下一个还在跑的任务进程
    leftover = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)", "fedagent.taskproc", task_id])
    try:
        assert leftover_process(leftover.pid, task_id)
        assert not leftover_process(leftover.pid, "task-other")
        assert not leftover_process(os.getpid(), task_id)
        with platform.db.session() as session:
            task = session.get(m.Task, task_id)
            task.status = "running"
            task.pid = leftover.pid

        runner = Runner(platform)
        runner.tick()
        # 先叫遗留进程停下，它还在时不另起进程
        assert not runner.children
        assert leftover.wait(timeout=10) == -signal.SIGTERM
        runner.tick()
        assert task_id in runner.children

        # 部署时 runner 收到 SIGTERM：结束任务进程，任务保持运行中，下一个 runner 从检查点继续
        child = runner.children[task_id].process
        runner.shutdown()
        assert child.poll() is not None
        with platform.db.session() as session:
            assert session.get(m.Task, task_id).status == "running"
        status = run_until_done(Runner(platform), platform, task_id)
    finally:
        if leftover.poll() is None:
            leftover.kill()
    assert status == "completed", (platform.settings.runs_dir / task_id / "task.log").read_text(encoding="utf-8")
    events = [event["kind"] for event in client.get(f"/v1/tasks/{task_id}/events").json()]
    assert events.count("requeue") == 2
