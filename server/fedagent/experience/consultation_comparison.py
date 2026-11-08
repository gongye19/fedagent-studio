"""冻结双栏问诊的共同输入，保存各栏进度，完成后一次揭晓结果。"""
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from threading import Lock
from typing import cast

from fedagent_sdk import ModelError
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .. import models as m
from ..errors import ServiceError
from ..gateway import FAKE_ENDPOINT, parse_ref
from ..platform import Platform
from ..resource_services.verification import digest, endpoint_signature
from ..resources import new_id
from ..schemas.consultation_comparison import Arm, ComparisonArm, ComparisonIn, ComparisonOut, ComparisonStep
from ..schemas.experience import Status
from . import comparison_runtime, evaluation
from .comparison_case import assert_holdout, get_case, load_case, safe_evidence
from .consultation import verified_model
from .package_evaluation import verified_package

ARMS: tuple[Arm, ...] = ("baseline", "experience")
ACTIVE = ("queued", "running", "paused")
MAX_STEPS = 10
# The deployment runs a single API process. Hold the lock through the database commit.
_start_lock = Lock()


def get(session: Session, job_id: str) -> m.Task:
    job = session.get(m.Task, job_id)
    if job is None or job.task_type != m.CONSULTATION_COMPARISON:
        raise ServiceError(404, "实时对比记录不存在")
    return job


def active(session: Session) -> m.Task | None:
    return session.scalar(select(m.Task).where(
        m.Task.task_type == m.CONSULTATION_COMPARISON, m.Task.status.in_(ACTIVE),
    ).order_by(m.Task.created_at.desc()).limit(1))


def start(platform: Platform, session: Session, body: ComparisonIn) -> m.Task:
    with _start_lock:
        if active(session) is not None:
            raise ServiceError(409, "已有实时对比，请先完成或停止当前问诊")
        app, source, artifact = verified_package(platform, session, body.package_id)
        definition = get_case(body.case_id)
        case = load_case(platform, definition)
        assert_holdout(platform, session, source, definition, case)
        model = verified_model(platform, session, body.model)
        endpoint = session.get(m.Endpoint, parse_ref(model)[0])
        assert endpoint is not None
        config = {
            "case": definition.summary.model_dump(), "evidence": safe_evidence(case, definition.reference_label),
            "reference": case["answer"], "reference_label": definition.reference_label, "experience": artifact.content, "package_name": app.name,
            "package_id": app.id, "artifact_version": artifact.version,
            "model": model, "endpoint_signature": endpoint_signature(endpoint), "max_steps": MAX_STEPS,
        }
        job = m.Task(
            id=new_id("cmp"), name=f"实时问诊对比 · {definition.summary.title}", scenario=source.scenario,
            task_type=m.CONSULTATION_COMPARISON, algorithm=source.algorithm,
            plugin_version=source.plugin_version, plugin_hash=source.plugin_hash, config=config,
            audit={"comparison_digest": digest(config)}, status="queued", fake=endpoint.id == FAKE_ENDPOINT,
        )
        session.add(job)
        session.commit()
        return job


def _progress(session: Session, job: m.Task, arm: Arm) -> tuple[list[ComparisonStep], set[tuple[str, str]], dict | None]:
    rows = [row for row in evaluation.report_rows(session, job.id) if row.site_id == arm]
    records = sorted((row for row in rows if row.step == "comparison-step"), key=lambda row: int(row.unit_key))
    steps = [ComparisonStep.model_validate(row.value["step"]) for row in records]
    used = {(step.action, row.value["target"].casefold()) for step, row in zip(steps, records, strict=True)}
    verdict = next((row.value for row in rows if row.step == "comparison-verdict"), None)
    return steps, used, verdict


def present(session: Session, job: m.Task) -> ComparisonOut:
    arms = []
    complete = job.status == "completed"
    for arm in ARMS:
        steps, _, verdict = _progress(session, job, arm)
        diagnosis = steps[-1].text if steps and steps[-1].action == "diagnosis" else None
        status = ("diagnosed" if diagnosis else "limit" if len(steps) >= job.config["max_steps"] else
                  "canceled" if job.status == "canceled" else "failed" if job.status == "paused" else
                  "running" if job.status == "running" else "waiting")
        arms.append(ComparisonArm(arm=arm, status=status, steps=[step for step in steps if step.action != "diagnosis"],
                                  diagnosis=diagnosis if complete else None,
                                  matched=verdict["matched"] if complete and verdict else None))
    return ComparisonOut(id=job.id, case=job.config["case"], package_name=job.config["package_name"],
                         model=job.config["model"], status=cast(Status, job.status), max_steps=job.config["max_steps"],
                         arms=arms, reference=job.config["reference_label"] if complete else None, error=job.error)


def _pause(platform: Platform, job: m.Task, message: str) -> str:
    with platform.db.session() as session:
        session.execute(update(m.Task).where(m.Task.id == job.id, m.Task.command.is_(None)).values(
            status="paused", error=message,
        ))
    return evaluation.stop_requested(platform, job) or "paused"


def run(platform: Platform, job: m.Task) -> str:
    config = job.config
    algorithm = platform.registry.algorithms.get(job.algorithm)
    if (digest(config) != job.audit.get("comparison_digest") or algorithm is None
            or algorithm.version != job.plugin_version or algorithm.code_hash() != job.plugin_hash):
        return _pause(platform, job, "冻结的问诊配置或算法版本已变化")
    with platform.db.session() as session:
        current = get(session, job.id)
        endpoint = session.get(m.Endpoint, parse_ref(config["model"])[0])
        if endpoint is None or endpoint_signature(endpoint) != config["endpoint_signature"]:
            current.status, current.error = "paused", "模型接口已变化，请恢复配置或重新发起对比"
            return "paused"
        current.started_at = current.started_at or m.now()
        resolved = platform.gateway.resolve(config["model"])
        saved: dict[Arm, tuple[list[ComparisonStep], set[tuple[str, str]], dict | None]] = {arm: _progress(session, job, arm) for arm in ARMS}

    pool = ThreadPoolExecutor(max_workers=min(2, resolved[0].concurrency), thread_name_prefix="consultation")
    pending: dict[Future[tuple[ComparisonStep, str]], Arm] = {}
    failed = False
    try:
        while True:
            if stopped := evaluation.stop_requested(platform, job):
                return stopped
            for arm, (steps, used, _) in saved.items():
                if not failed and arm not in pending.values() and len(steps) < config["max_steps"] and (
                    not steps or steps[-1].action != "diagnosis"
                ):
                    pending[pool.submit(comparison_runtime.next_step, platform, job, resolved, arm, steps, used)] = arm
            if not pending:
                break
            done, _ = wait(pending, timeout=0.5, return_when=FIRST_COMPLETED)
            for future in done:
                arm = pending.pop(future)
                try:
                    step, target = future.result()
                except ModelError:
                    evaluation.LOG.exception("consultation %s interrupted at %s", job.id, arm)
                    failed = True
                    continue
                steps, used, _ = saved[arm]
                evaluation.checkpoint(platform, job, arm, str(len(steps)), "comparison-step",
                                      {"step": step.model_dump(), "target": target})
                steps.append(step)
                used.add((step.action, target.casefold()))
    finally:
        # A canceled job never resumes; taskproc exits immediately. A failure drains
        # the other arm before it exposes a resumable status.
        pool.shutdown(wait=False, cancel_futures=True)
    if failed:
        return _pause(platform, job, "模型请求失败，已保留问诊记录，可以继续")

    for arm, (steps, _, verdict) in saved.items():
        if stopped := evaluation.stop_requested(platform, job):
            return stopped
        if verdict is None and steps and steps[-1].action == "diagnosis":
            try:
                matched = comparison_runtime.score(platform, job, resolved, arm, steps[-1].text)
            except ModelError:
                evaluation.LOG.exception("consultation %s scoring failed for %s", job.id, arm)
                return _pause(platform, job, "诊断核对失败，继续后只重试尚未完成的核对")
            evaluation.checkpoint(platform, job, arm, "final", "comparison-verdict", {"matched": matched})
    return evaluation.finish(platform, job, failed=False, completed_message="实时问诊对比已完成")
