"""任务编排：一个运行中的任务一个进程，按算法清单逐轮、逐步推进。

- 每一步按清单拆成工作单元（每条样本一个，或每个站点一个）。平台托管的参与方和服务端的单元在本进程里并发执行，
  本地参与方的单元放进队列，等客户端领取；全部完成才进入下一步（每一步是一道栅栏）。
- 工作单元的结果写进数据库才算完成。续跑时跳过已完成的单元；单元里已完成的模型调用从调用账本取，不重复计费。
- 暂停、取消由 API 写进任务的 command，本进程轮询到后停下；正在执行的单元下次续跑时重新执行。
- 失败：单元按清单的重试次数重试，仍失败就暂停任务并写明原因；插件主动报告 pause 的直接暂停。
"""

from __future__ import annotations

import logging
import time
import traceback
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any

from fedagent_sdk import SERVER, Algorithm, CapabilityError, Grader, ModelError, SiteInfo, StepContext, StepDef, StepFailed, TaskType
from sqlalchemy import func, select, update

from . import models as m
from .data import to_item
from .gateway import LedgerKey
from .platform import Platform
from .units import DbStepIO, Graded, SiteView, add_event, load_sites, store_result

log = logging.getLogger("fedagent.engine")

CLIENT_WAIT_LIMIT = timedelta(minutes=30)
"""本地参与方超过这么久没有心跳、它的工作单元还没完成，就暂停任务。"""


@dataclass
class Outcome:
    ok: bool
    error: str | None = None
    pause: bool = False


class TaskStopped(Exception):
    def __init__(self, status: str) -> None:
        super().__init__(status)
        self.status = status


class TaskEngine:
    def __init__(self, platform: Platform, task_id: str, *, poll: float = 0.2) -> None:
        self.platform = platform
        self.db = platform.db
        self.task_id = task_id
        self.poll = poll
        self.run_dir: Path = platform.settings.runs_dir / task_id

    # —— 入口 ——

    def run(self) -> str:
        with self.db.session() as session:
            task = session.get(m.Task, self.task_id)
            if task is None:
                return "missing"
            if task.status != "running":
                return task.status
            self.config: dict[str, Any] = dict(task.config)
            self.cursor_round = task.cursor_round
            plugin_version, plugin_hash = task.plugin_version, task.plugin_hash
            if task.started_at is None:
                task.started_at = m.now()
            self.sites = load_sites(session, self.task_id)
            # 上次中断时正在执行的单元重新排队；客户端过期的租约收回
            session.execute(update(m.WorkUnit).where(m.WorkUnit.task_id == self.task_id, m.WorkUnit.status == "running").values(status="pending"))
        registry = self.platform.registry
        try:
            self.plugin: Algorithm = registry.algorithm(self.config["algorithm"])
        except Exception as error:
            return self._pause(f"算法插件不可用：{error}")
        if self.plugin.version != plugin_version or self.plugin.code_hash() != plugin_hash:
            return self._pause(f"算法插件和创建任务时的版本不一致（创建时 {plugin_version}，现在 {self.plugin.version}）；装回原版本，或复制为新任务")
        self.manifest = self.plugin.manifest
        self.task_type: TaskType = registry.task_type(self.config["taskType"])
        self.grader: Grader = registry.grader(self.config.get("grader") or self.task_type.graders[0])
        self.params = self.manifest.params_of(self.config.get("params"))
        self.rounds = int(self.config["rounds"])
        self.site_by_id = {site.id: site for site in self.sites}
        self.records = self._load_records()
        self._event("start", "任务开始运行" if self.cursor_round == 1 else f"从第 {self.cursor_round} 轮继续运行")
        try:
            for round in range(self.cursor_round, self.rounds + 1):
                for step_id in self.plugin.plan(round, self.rounds):
                    step = self.manifest.step(step_id)
                    if step is None:
                        return self._pause(f"插件计划了清单里没有的步骤 {step_id}")
                    if self._step_done(round, step):
                        continue
                    self._set_cursor(round, step.id)
                    self._run_step(round, step)
                self._event("round", f"第 {round} 轮完成", {"round": round})
        except TaskStopped as stopped:
            return stopped.status
        return self._complete()

    # —— 一步 ——

    def _targets(self, step: StepDef) -> list[SiteView]:
        if step.at == SERVER:
            return [site for site in self.sites if site.kind == "server"]
        return [site for site in self.sites if site.kind == "participant" and site.role == step.at]

    def _step_done(self, round: int, step: StepDef) -> bool:
        with self.db.session() as session:
            rows = session.execute(
                select(m.WorkUnit.status, func.count())
                .where(m.WorkUnit.task_id == self.task_id, m.WorkUnit.round == round, m.WorkUnit.step == step.id)
                .group_by(m.WorkUnit.status)
            ).all()
        counts = dict(rows)
        expected = sum(len(site.items) if step.per == "item" else 1 for site in self._targets(step))
        return counts.get("done", 0) >= expected and expected > 0

    def _ensure_units(self, round: int, step: StepDef) -> None:
        with self.db.session() as session:
            existing = set(
                session.execute(
                    select(m.WorkUnit.site_id, m.WorkUnit.unit_key).where(
                        m.WorkUnit.task_id == self.task_id, m.WorkUnit.round == round, m.WorkUnit.step == step.id
                    )
                ).all()
            )
            for site in self._targets(step):
                keys = list(site.items) if step.per == "item" else ["_"]
                for key in keys:
                    if (site.id, key) not in existing:
                        session.add(m.WorkUnit(task_id=self.task_id, round=round, step=step.id, site_id=site.id, unit_key=key, executor=site.executor))

    def _run_step(self, round: int, step: StepDef) -> None:
        self._ensure_units(round, step)
        self._step_started = time.monotonic()
        workers = max(1, int(self.config.get("workers") or 8))
        pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix=f"{step.id}")
        futures: dict[Future[Outcome], int] = {}
        try:
            while True:
                self._check_command()
                self._check_budget()
                for future in [future for future in futures if future.done()]:
                    unit_id = futures.pop(future)
                    try:
                        outcome = future.result()
                    except Exception as error:
                        outcome = Outcome(False, f"{type(error).__name__}: {error}")
                    if not outcome.ok:
                        self._unit_failed(unit_id, step, outcome)
                capacity = workers - len(futures)
                if capacity > 0:
                    for unit_id in self._claim_platform_units(round, step, capacity):
                        futures[pool.submit(self._execute, unit_id, round, step)] = unit_id
                self._reclaim_client_leases(round, step)
                status = self._unit_counts(round, step)
                if status.get("failed"):
                    raise TaskStopped(self._pause_from_failed(round, step))
                total = sum(status.values())
                if not futures and status.get("done", 0) == total and total > 0:
                    return
                self._check_client_wait(round, step)
                if futures:
                    wait(list(futures), timeout=self.poll, return_when=FIRST_COMPLETED)
                else:
                    time.sleep(self.poll)
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

    def _claim_platform_units(self, round: int, step: StepDef, limit: int) -> list[int]:
        with self.db.session() as session:
            units = session.scalars(
                select(m.WorkUnit)
                .where(
                    m.WorkUnit.task_id == self.task_id,
                    m.WorkUnit.round == round,
                    m.WorkUnit.step == step.id,
                    m.WorkUnit.executor == "platform",
                    m.WorkUnit.status == "pending",
                )
                .order_by(m.WorkUnit.id)
                .limit(limit)
            ).all()
            for unit in units:
                unit.status = "running"
                unit.attempts += 1
                unit.started_at = m.now()
            return [unit.id for unit in units]

    def _unit_counts(self, round: int, step: StepDef) -> dict[str, int]:
        with self.db.session() as session:
            rows = session.execute(
                select(m.WorkUnit.status, func.count())
                .where(m.WorkUnit.task_id == self.task_id, m.WorkUnit.round == round, m.WorkUnit.step == step.id)
                .group_by(m.WorkUnit.status)
            ).all()
        return {status: count for status, count in rows}

    def _execute(self, unit_id: int, round: int, step: StepDef) -> Outcome:
        with self.db.session() as session:
            unit = session.get(m.WorkUnit, unit_id)
            assert unit is not None
            site = self.site_by_id[unit.site_id]
            unit_key = unit.unit_key
        records = self.records.get(site.id, {})
        full_item = records.get(unit_key) if step.per == "item" else None
        if step.per == "item" and full_item is None:
            return Outcome(False, f"找不到样本 {unit_key}", pause=True)
        model = None
        if step.model:
            ref = site.model_ref or "default"
            try:
                model = self.platform.gateway.model(
                    ref,
                    ledger=LedgerKey(self.task_id, site.id, round, step.id, unit_key),
                    plugin=self.plugin,
                    step_id=step.id,
                )
            except ModelError as error:
                return Outcome(False, str(error), pause=True)
        ctx = StepContext(
            manifest=self.manifest,
            step=step,
            site=SiteInfo(site.id, site.role, site.participant_id, site.label),
            round=round,
            rounds=self.rounds,
            params=self.params,
            io=DbStepIO(self.db, self.task_id, site, step, self.task_type, records),
            model=model,
            item=to_item(self.task_type, full_item, labels=step.labels) if full_item is not None else None,
            log=lambda text: log.info("%s %s r%s %s: %s", self.task_id, site.id, round, step.id, text),
        )
        try:
            self.plugin.run_step(ctx)
        except StepFailed as error:
            return Outcome(False, str(error), pause=error.pause)
        except CapabilityError as error:
            return Outcome(False, f"插件用了清单没有声明的能力：{error}", pause=True)
        except ModelError as error:
            return Outcome(False, f"模型调用失败：{error}")
        except Exception as error:
            log.exception("unit %s failed", unit_id)
            return Outcome(False, f"{type(error).__name__}: {error}\n{traceback.format_exc(limit=3)}")
        graded = []
        for item_id, prediction in ctx.result.predictions:
            record = records.get(item_id, {})
            labeled = self.task_type.is_labeled(record)
            correct = bool(labeled and self.grader.grade(prediction, record))
            graded.append(Graded(item_id, labeled, correct))
        with self.db.session() as session:
            unit = session.get(m.WorkUnit, unit_id)
            if unit is None or unit.status != "running":
                return Outcome(True)
            store_result(
                session,
                unit=unit,
                manifest=self.manifest,
                site=site,
                sites=self.site_by_id,
                result=ctx.result,
                graded=graded,
                plugin_version=self.plugin.version,
                keep_private=True,
                run_dir=self.run_dir,
            )
        return Outcome(True)

    def _unit_failed(self, unit_id: int, step: StepDef, outcome: Outcome) -> None:
        with self.db.session() as session:
            unit = session.get(m.WorkUnit, unit_id)
            if unit is None:
                return
            unit.error = outcome.error
            if outcome.pause or unit.attempts > step.retries:
                unit.status = "failed"
            else:
                unit.status = "pending"

    def _pause_from_failed(self, round: int, step: StepDef) -> str:
        with self.db.session() as session:
            unit = session.scalars(
                select(m.WorkUnit)
                .where(m.WorkUnit.task_id == self.task_id, m.WorkUnit.round == round, m.WorkUnit.step == step.id, m.WorkUnit.status == "failed")
                .limit(1)
            ).first()
            assert unit is not None
            site = self.site_by_id.get(unit.site_id)
            # 修好后继续时，失败的单元重新排队
            unit.status = "pending"
            unit.attempts = 0
            reason = (unit.error or "").split("\n")[0]
        where = f"{site.label if site else unit.site_id} · 第 {round} 轮 · {step.label}"
        return self._pause(f"{where}：{reason}")

    # —— 本地客户端的单元 ——

    def _reclaim_client_leases(self, round: int, step: StepDef) -> None:
        with self.db.session() as session:
            session.execute(
                update(m.WorkUnit)
                .where(
                    m.WorkUnit.task_id == self.task_id,
                    m.WorkUnit.round == round,
                    m.WorkUnit.step == step.id,
                    m.WorkUnit.status == "claimed",
                    m.WorkUnit.lease_until < m.now(),
                )
                .values(status="pending", claimed_by=None, lease_until=None)
            )

    def _check_client_wait(self, round: int, step: StepDef) -> None:
        """这一步已经等了 30 分钟以上，还有本地参与方没完成、而且它 30 分钟没有心跳，就暂停任务。"""
        if time.monotonic() - self._step_started < CLIENT_WAIT_LIMIT.total_seconds():
            return
        waiting = [site for site in self._targets(step) if site.executor == "client"]
        with self.db.session() as session:
            for site in waiting:
                open_units = session.scalar(
                    select(func.count()).where(
                        m.WorkUnit.task_id == self.task_id,
                        m.WorkUnit.round == round,
                        m.WorkUnit.step == step.id,
                        m.WorkUnit.site_id == site.id,
                        m.WorkUnit.status.in_(("pending", "claimed")),
                    )
                )
                if not open_units:
                    continue
                participant = session.get(m.Participant, site.participant_id)
                seen = m.aware(participant.last_seen_at) if participant and participant.last_seen_at else None
                if seen is None or m.now() - seen > CLIENT_WAIT_LIMIT:
                    absent = site
                    break
            else:
                absent = None
        if absent is not None:
            raise TaskStopped(self._pause(f"{absent.label} 的本地客户端超过 30 分钟没有连接，任务已暂停；客户端连上后可以继续"))

    # —— 任务状态 ——

    def _check_command(self) -> None:
        """API 写进 command 的暂停、取消。状态改完、提交之后再抛出，免得异常让事务回滚。"""
        stopped: str | None = None
        with self.db.session() as session:
            task = session.get(m.Task, self.task_id)
            if task is None:
                stopped = "missing"
            elif task.command == "pause":
                task.command = None
                task.status = "paused"
                add_event(session, self.task_id, "pause", "任务已暂停", run_dir=self.run_dir)
                stopped = "paused"
            elif task.command == "cancel":
                task.command = None
                task.status = "canceled"
                task.finished_at = m.now()
                add_event(session, self.task_id, "cancel", "任务已取消", run_dir=self.run_dir)
                stopped = "canceled"
        if stopped is not None:
            raise TaskStopped(stopped)

    def _check_budget(self) -> None:
        with self.db.session() as session:
            task = session.get(m.Task, self.task_id)
            if task is None or task.budget is None:
                return
            spent = session.scalar(select(func.coalesce(func.sum(m.CallRecord.cost), 0.0)).where(m.CallRecord.task_id == self.task_id)) or 0.0
        if spent > task.budget:
            raise TaskStopped(self._pause(f"费用 {spent:.2f} 元超过了上限 {task.budget:.2f} 元"))

    def _pause(self, reason: str) -> str:
        with self.db.session() as session:
            task = session.get(m.Task, self.task_id)
            if task is not None:
                task.status = "paused"
                task.error = reason
                task.command = None
                add_event(session, self.task_id, "pause", reason, run_dir=self.run_dir)
        log.warning("task %s paused: %s", self.task_id, reason)
        return "paused"

    def _set_cursor(self, round: int, step_id: str) -> None:
        with self.db.session() as session:
            task = session.get(m.Task, self.task_id)
            if task is not None:
                task.cursor_round = round
                task.cursor_step = step_id
                task.error = None

    def _complete(self) -> str:
        with self.db.session() as session:
            task = session.get(m.Task, self.task_id)
            if task is not None:
                task.status = "completed"
                task.finished_at = m.now()
                task.cursor_step = None
                task.error = None
                add_event(session, self.task_id, "complete", "任务完成", run_dir=self.run_dir)
        return "completed"

    def _event(self, kind: str, message: str, data: dict[str, Any] | None = None) -> None:
        with self.db.session() as session:
            add_event(session, self.task_id, kind, message, data, run_dir=self.run_dir)

    def _load_records(self) -> dict[str, dict[str, dict[str, Any]]]:
        """平台托管的参与方：按冻结时的内容哈希读数据集文件。"""
        records: dict[str, dict[str, dict[str, Any]]] = {}
        for site in self.sites:
            if site.kind != "participant" or site.executor != "platform" or not site.dataset_hash:
                continue
            rows = self.platform.files.load(f"{site.dataset_id}/{site.dataset_hash}.jsonl")
            records[site.id] = {self.task_type.item_id(row): row for row in rows}
        return records
