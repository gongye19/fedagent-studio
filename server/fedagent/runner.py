"""runner：常驻进程，管理任务进程。

- 领取排队的任务（同时运行的任务数不超过配置），每个任务起一个子进程（python -m fedagent.taskproc）；
- 任务进程正常结束时，任务状态已经由进程自己写好（完成、暂停、取消）；
- 意外退出（状态还是运行中）时从检查点自动重启，连续超过上限就暂停并写明原因；
- 发了暂停 / 取消命令、进程 60 秒还没停下的，直接结束进程（下次续跑时正在执行的单元重新排队）。
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass

from sqlalchemy import select

from . import models as m
from .platform import Platform
from .units import add_event

log = logging.getLogger("fedagent.runner")
STOP_GRACE_SECONDS = 60


@dataclass
class Child:
    process: subprocess.Popen[bytes]
    started: float
    command_seen: float | None = None


class Runner:
    def __init__(self, platform: Platform) -> None:
        self.platform = platform
        self.children: dict[str, Child] = {}

    def _spawn(self, task_id: str) -> subprocess.Popen[bytes]:
        run_dir = self.platform.settings.runs_dir / task_id
        run_dir.mkdir(parents=True, exist_ok=True)
        log_file = (run_dir / "task.log").open("ab")
        env = dict(os.environ)
        settings = self.platform.settings
        env["FEDAGENT_DATA_DIR"] = str(settings.data_dir.resolve())
        if settings.database_url:
            env["FEDAGENT_DATABASE_URL"] = settings.database_url
        if settings.secret_key:
            env["FEDAGENT_SECRET_KEY"] = settings.secret_key
        try:
            return subprocess.Popen(
                [sys.executable, "-m", "fedagent.taskproc", task_id],
                stdout=log_file,
                stderr=subprocess.STDOUT,
                env=env,
                start_new_session=True,
            )
        finally:
            log_file.close()

    def tick(self) -> None:
        db = self.platform.db
        settings = self.platform.settings
        with db.session() as session:
            # 标为运行中、却没有本 runner 管的进程（例如 runner 重启过）：重新排队，从检查点继续
            for task in session.scalars(select(m.Task).where(m.Task.status == "running")):
                if task.id not in self.children:
                    task.status = "queued"
                    add_event(session, task.id, "requeue", "运行进程不在了，重新排队，从检查点继续")
            slots = settings.max_running_tasks - len(self.children)
            if slots > 0:
                queued = session.scalars(select(m.Task).where(m.Task.status == "queued").order_by(m.Task.created_at).limit(slots)).all()
                for task in queued:
                    task.status = "running"
                    task.command = None
                    process = self._spawn(task.id)
                    task.pid = process.pid
                    self.children[task.id] = Child(process, time.monotonic())
                    log.info("started task %s (pid %s)", task.id, process.pid)
        for task_id, child in list(self.children.items()):
            code = child.process.poll()
            if code is None:
                self._watch_command(task_id, child)
                continue
            del self.children[task_id]
            with db.session() as session:
                task = session.get(m.Task, task_id)
                if task is None:
                    continue
                task.pid = None
                if task.status != "running":
                    continue
                task.restarts += 1
                if task.restarts > settings.task_restart_limit:
                    task.status = "paused"
                    reason = f"任务进程连续 {settings.task_restart_limit} 次意外退出，已暂停；日志在运行目录的 task.log"
                    task.error = reason
                    add_event(session, task_id, "pause", reason)
                else:
                    task.status = "queued"
                    add_event(session, task_id, "restart", f"任务进程意外退出（退出码 {code}），从检查点重启")

    def _watch_command(self, task_id: str, child: Child) -> None:
        with self.platform.db.session() as session:
            task = session.get(m.Task, task_id)
            pending = task is not None and task.command is not None
        if not pending:
            child.command_seen = None
            return
        if child.command_seen is None:
            child.command_seen = time.monotonic()
        elif time.monotonic() - child.command_seen > STOP_GRACE_SECONDS:
            child.process.terminate()

    def run(self, stop: threading.Event | None = None, interval: float = 1.0) -> None:
        log.info("runner started")
        while stop is None or not stop.is_set():
            try:
                self.tick()
            except Exception:
                log.exception("runner tick failed")
            time.sleep(interval)
        for child in self.children.values():
            child.process.terminate()
