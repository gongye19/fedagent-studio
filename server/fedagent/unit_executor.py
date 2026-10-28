"""单个工作单元的执行与结果提交；不推进任务轮次或控制任务生命周期。"""

from __future__ import annotations

import logging
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fedagent_sdk import Algorithm, CapabilityError, Grader, ModelError, ProgressUpdate, SiteInfo, StepContext, StepDef, StepFailed, TaskType
from sqlalchemy import update

from . import models as m
from .data import to_item
from .gateway import LedgerKey
from .platform import Platform
from .units import DbStepIO, Graded, SiteView, store_result

log = logging.getLogger("fedagent.engine")


@dataclass
class Outcome:
    ok: bool
    error: str | None = None
    pause: bool = False


@dataclass
class UnitExecutor:
    platform: Platform
    task_id: str
    run_dir: Path
    plugin: Algorithm
    task_type: TaskType
    grader: Grader
    site_by_id: dict[str, SiteView]
    records: dict[str, dict[str, dict[str, Any]]]
    params: dict[str, Any]
    rounds: int

    @property
    def db(self):
        return self.platform.db

    @property
    def manifest(self):
        return self.plugin.manifest

    def execute(self, unit_id: int, attempt: int, round: int, step: StepDef) -> Outcome:
        from .task_services.process import append

        with self.db.session() as session:
            unit = session.get(m.WorkUnit, unit_id)
            assert unit is not None
            site, key = unit.site_id, unit.unit_key
            external = self.site_by_id[site].executor == "agent"
        origin = f"unit-{unit_id}-attempt-{attempt}"
        def emit(seq, status):
            if external:
                return
            append(self.platform, task_id=self.task_id, origin=origin, seq=seq, site=site, round=round,
                   step=step.id, unit=key, event=ProgressUpdate(activity="unit", title=step.label, status=status,
                                                             item_id=key if step.per == "item" else None))
        emit(1, "running")
        outcome = self._execute(unit_id, attempt, round, step)
        with self.db.session() as session:
            stored = session.get(m.WorkUnit, unit_id)
            completed = stored is not None and stored.status == "done"
        if completed or not outcome.ok:
            emit(2, "completed" if completed else "failed")
        return outcome

    def _execute(self, unit_id: int, attempt: int, round: int, step: StepDef) -> Outcome:
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
        if step.model and site.executor != "agent":
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
            if site.executor == "agent":
                from .agents.adapter import execute

                ctx.result = execute(
                    self.platform,
                    ctx,
                    self.plugin,
                    self.task_type.id,
                    self.task_id,
                    unit_id,
                    unit_key,
                    (site.model_ref or "").removeprefix("agent:"),
                    self.site_by_id,
                )
            else:
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
        try:
            grading_model = None
            if self.grader.requires_model and ctx.result.predictions:
                grading_model = self.platform.gateway.model(
                    self.site_by_id["server"].model_ref or "default",
                    ledger=LedgerKey(self.task_id, site.id, round, step.id, unit_key),
                    plugin=self.plugin, step_id=step.id, purpose="grade",
                )
            for item_id, prediction in ctx.result.predictions:
                record = records.get(item_id, {})
                labeled = self.task_type.is_evaluated(record)
                correct = bool(labeled and self.grader.evaluate(prediction, record, grading_model))
                graded.append(Graded(item_id, labeled, correct))
        except ModelError as error:
            return Outcome(False, f"判分失败：{error}")
        except Exception as error:
            log.exception("unit %s grading failed", unit_id)
            return Outcome(False, f"判分失败：{type(error).__name__}: {error}", pause=True)
        with self.db.session() as session:
            unit = session.get(m.WorkUnit, unit_id)
            task = session.get(m.Task, self.task_id)
            if unit is None or task is None or task.status != "running" or task.command is not None:
                return Outcome(True)
            stored = store_result(
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
                expected="running",
                attempt=attempt,
            )
            if not stored:
                log.info("%s unit %s attempt %s: result discarded (stored by another attempt)", self.task_id, unit_id, attempt)
        return Outcome(True)


def fail_unit(db, unit_id: int, attempt: int, step: StepDef, outcome: Outcome) -> None:
    # 只改这次尝试领到的单元；过期的执行失败了不影响后来的尝试
    with db.session() as session:
        failed = session.execute(
            update(m.WorkUnit)
            .where(m.WorkUnit.id == unit_id, m.WorkUnit.status == "running", m.WorkUnit.attempts == attempt)
            .values(error=outcome.error, status="failed" if outcome.pause or attempt > step.retries else "pending"),
            execution_options={"synchronize_session": False},
        )
        if not failed.rowcount:  # type: ignore[attr-defined]
            return
        unit = session.get(m.WorkUnit, unit_id)
        assert unit is not None
        # 这次尝试的调用作废：重试（或修好后继续）时重新调用模型，而不是从账本取回让这一步失败的结果。
        # 费用照记（账本里的行还在），只是不再拿来续跑。
        session.execute(
            update(m.CallRecord)
            .where(
                m.CallRecord.task_id == unit.task_id,
                m.CallRecord.site_id == unit.site_id,
                m.CallRecord.round == unit.round,
                m.CallRecord.step == unit.step,
                m.CallRecord.unit_key == unit.unit_key,
                m.CallRecord.status == "ok",
            )
            .values(status="discarded"),
            execution_options={"synchronize_session": False},
        )
