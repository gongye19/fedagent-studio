"""沿用真实引擎，只补失败快照及所有线程收尾；不改变算法步骤。"""

import re
import threading
from datetime import UTC, datetime

from fedagent import models as m
from fedagent.engine import TaskEngine
from sqlalchemy import select

from ...common import digest, load, save
from .budget import connection_errors


class DrainingEngine(TaskEngine):
    def __init__(self, platform, task_id, directory, model):
        super().__init__(platform, task_id, poll=0.05)
        self.directory, self.guard = directory, model

    def _pause_from_failed(self, round, step):
        self.guard.stopped.set()
        with self.db.session() as session:
            units = list(session.scalars(select(m.WorkUnit).where(m.WorkUnit.task_id == self.task_id, m.WorkUnit.status == "failed")))
            snapshot = [{"id": u.id, "site": u.site_id, "step": u.step, "item": u.unit_key, "attempts": u.attempts, "error": u.error} for u in units]
        path = self.directory / "failed-units.json"
        history = load(path) if path.exists() else []
        history.append({"at": datetime.now(UTC).isoformat(), "units": snapshot})
        save(path, history)
        return super()._pause_from_failed(round, step)

    def _run_step(self, round, step):
        before = set(threading.enumerate())
        try:
            super()._run_step(round, step)
        except BaseException:
            self.guard.stopped.set()
            raise
        finally:
            new_threads = set(threading.enumerate()) - before
            known = {t for t in new_threads if t.name.startswith(step.id + "_")}
            for thread in known:
                thread.join()
            if new_threads - known:
                self.guard.stopped.set()
                raise ValueError("unexpected-thread-during-isolated-step")


def resume_failed(platform, task_id, directory):
    """仅恢复明确GuardStop；已结束的故障仍受同请求两次上限约束。"""
    path = directory / "failed-units.json"
    history = load(path) if path.exists() else []
    if not history:
        raise ValueError("missing-failed-unit-evidence")
    snapshots = {u["id"]: u for u in history[-1]["units"]}
    attempts = load(directory / "attempts.json") if (directory / "attempts.json").exists() else []
    # 原引擎复位的主失败单元也必须检查，不能只看剩下的failed行。
    for snapshot in snapshots.values():
        match = re.search(r"GuardStop:(blocked|ended):([0-9a-f]{64})", snapshot["error"] or "")
        if not match:
            raise ValueError("non-connection-failure-cannot-resume")
        mode, key = match.groups()
        rows = [r for r in attempts if r["requestHash"] == key]
        if any(r["status"] == "started" for r in rows) or (mode == "ended" and not connection_errors(rows, key)):
            raise ValueError("failure-not-confirmed-ended")
        if connection_errors(rows, key) >= 2:
            raise ValueError("same-request-error-cap-prevents-resume")
    restored = []
    with platform.db.session() as session:
        failed = list(session.scalars(select(m.WorkUnit).where(m.WorkUnit.task_id == task_id, m.WorkUnit.status == "failed")))
        for unit in failed:
            evidence = snapshots.get(unit.id)
            if not evidence or evidence["error"] != unit.error or evidence["attempts"] != unit.attempts:
                raise ValueError("non-connection-failure-cannot-resume")
            unit.status = "pending"
            restored.append(unit.id)
    receipt = directory / "resumes.json"
    values = load(receipt) if receipt.exists() else []
    values.append({"at": datetime.now(UTC).isoformat(), "ledgerDigest": digest(attempts), "restoredUnits": restored})
    save(receipt, values)
