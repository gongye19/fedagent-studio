"""runner：常驻进程，管理任务进程。

- 领取排队的任务（同时运行的任务数不超过配置），每个任务起一个子进程（python -m fedagent.taskproc）；
- 任务进程正常结束时，任务状态已经由进程自己写好（完成、暂停、取消）；
- 意外退出（状态还是运行中）时从检查点自动重启，连续超过上限就暂停并写明原因；
- 发了暂停 / 取消命令、进程 60 秒还没停下的，直接结束进程（下次续跑时正在执行的单元重新排队）；
- runner 停下（部署、重启）时一起结束任务进程，任务保持"运行中"，下一个 runner 起来后从检查点继续。
  任务进程在自己的会话里，runner 被强行结束时它们不会跟着退出：新 runner 先结束这些遗留进程，再重新排队，
  免得同一个任务有两个进程同时跑、重复调用模型。
"""

from __future__ import annotations

import logging
import os
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from . import models as m
from .platform import Platform
from .units import add_event

log = logging.getLogger("fedagent.runner")
STOP_GRACE_SECONDS = 60
SHUTDOWN_GRACE_SECONDS = 10


@dataclass
class Child:
    process: subprocess.Popen[bytes]
    started: float
    command_seen: float | None = None


def leftover_process(pid: int | None, task_id: str) -> bool:
    """这个进程号是不是还在跑的、这个任务的任务进程（核对命令行，进程号被别的进程复用时不算）。"""
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError):
        return False
    proc = Path(f"/proc/{pid}/cmdline")
    if proc.exists():
        try:
            args = proc.read_bytes().decode(errors="replace").split("\0")
        except OSError:
            return False
    else:
        # 没有 /proc（macOS 本地开发）
        found = subprocess.run(["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True, check=False)
        args = found.stdout.split()
    return "fedagent.taskproc" in args and task_id in args


class Runner:
    def __init__(self, platform: Platform) -> None:
        self.platform = platform
        self.children: dict[str, Child] = {}
        self.leftovers: dict[str, float] = {}
        """上一个 runner 留下、已经叫它停下的任务进程：任务 id → 发出信号的时间。"""

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
        for task_id, child in list(self.children.items()):
            code = child.process.poll()
            if code is None:
                self._watch_command(task_id, child)
                continue
            del self.children[task_id]
            with db.session() as session:
                task = session.get(m.Task, task_id)
                if task is not None:
                    task.pid = None
                    if task.status == "running":
                        self._recover_task(session, task, f"任务进程退出（退出码 {code}）")
        occupied = set(self.children)
        with db.session() as session:
            # 标为运行中、却没有本 runner 管的进程（例如 runner 重启过）：重新排队，从检查点继续。
            # 上一个 runner 留下的进程还在跑时，先结束它，等它退出后再排队。
            for task in session.scalars(select(m.Task).where(m.Task.status == "running")):
                if task.id in self.children:
                    continue
                if task.pid and leftover_process(task.pid, task.id):
                    occupied.add(task.id)
                    self._stop_leftover(task.id, task.pid)
                    continue
                self.leftovers.pop(task.id, None)
                task.pid = None
                self._recover_task(session, task, "运行进程不在了", restart=False)
        slots = max(0, settings.max_running_tasks - len(occupied))
        if not slots:
            return
        with db.session() as session:
            queued = list(session.scalars(select(m.Task.id).where(
                m.Task.status == "queued", m.Task.command.is_(None),
            ).order_by(m.Task.created_at).limit(slots)))
        for task_id in queued:
            # 领取必须先提交。新进程启动后立即读取数据库，不能让它看到 queued。
            with db.session() as session:
                claimed = session.execute(update(m.Task).where(
                    m.Task.id == task_id, m.Task.status == "queued", m.Task.command.is_(None),
                ).values(status="running")).rowcount  # type: ignore[attr-defined]
                if not claimed:
                    continue
            try:
                process = self._spawn(task_id)
            except OSError:
                log.exception("could not start task %s", task_id)
                with db.session() as session:
                    task = session.get(m.Task, task_id)
                    if task is not None and task.status == "running":
                        self._recover_task(session, task, "任务进程启动失败")
                continue
            self.children[task_id] = Child(process, time.monotonic())
            with db.session() as session:
                session.execute(update(m.Task).where(m.Task.id == task_id).values(pid=process.pid))
            log.info("started task %s (pid %s)", task_id, process.pid)

    def _recover_task(self, session: Session, task: m.Task, reason: str, *, restart: bool = True) -> None:
        if task.command:
            task.status = "canceled" if task.command == "cancel" else "paused"
            task.finished_at = m.now() if task.status == "canceled" else None
            task.command = None
            add_event(session, task.id, task.status, "任务已取消" if task.status == "canceled" else "任务已暂停")
            return
        task.restarts += int(restart)
        if task.restarts > self.platform.settings.task_restart_limit:
            task.status = "paused"
            message = "任务进程多次无法完成，已暂停；日志在运行目录的 task.log"
            task.error = message
            add_event(session, task.id, "pause", message)
        else:
            task.status = "queued"
            add_event(session, task.id, "restart" if restart else "requeue", f"{reason}，从检查点继续")

    def _stop_leftover(self, task_id: str, pid: int) -> None:
        signaled = self.leftovers.get(task_id)
        try:
            if signaled is None:
                log.warning("task %s: stopping leftover process %s from a previous runner", task_id, pid)
                os.kill(pid, signal.SIGTERM)
                self.leftovers[task_id] = time.monotonic()
            elif time.monotonic() - signaled > SHUTDOWN_GRACE_SECONDS:
                os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

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
        stop = stop or threading.Event()
        while not stop.is_set():
            try:
                self.tick()
            except Exception:
                log.exception("runner tick failed")
            stop.wait(interval)
        self.shutdown()

    def shutdown(self, grace: float = SHUTDOWN_GRACE_SECONDS) -> None:
        """结束本 runner 起的任务进程。任务保持"运行中"，下一个 runner 起来后从检查点继续。"""
        for child in self.children.values():
            child.process.terminate()
        deadline = time.monotonic() + grace
        for task_id, child in self.children.items():
            try:
                child.process.wait(timeout=max(0.0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                child.process.kill()
                child.process.wait()
            log.info("stopped task %s (pid %s)", task_id, child.process.pid)
        self.children.clear()
        log.info("runner stopped")
