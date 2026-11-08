"""独立评测复用任务队列和调用账本，完成的回答与本站经验会保留。"""
from __future__ import annotations

import logging
from typing import Any

from fedagent_sdk import ApplyRequest, Artifact, ModelError, StepFailed
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .. import models as m
from ..errors import ServiceError
from ..gateway import FAKE_ENDPOINT, EndpointConfig, LedgerKey, parse_ref
from ..model_runtime import GatewayModel
from ..platform import Platform
from ..resources import new_id
from ..schemas.experience import Arm, Change, EvaluationArm, EvaluationCase, EvaluationIn, EvaluationOut, EvaluationScore, EvaluationSite
from ..units import add_event
from .baseline import local_package
from .cases import freeze_cases
from .consultation import MEDICAL_RECORDS, RECORD_ALGORITHMS, experience_guidance, verified_model

ARMS: tuple[Arm, ...] = ("none", "local", "federated")
LOG = logging.getLogger(__name__)


def find_job(session: Session, task_id: str) -> m.Task | None:
    return session.scalar(select(m.Task).where(m.Task.source_task_id == task_id, m.Task.evaluation_package_id.is_(None)))


def _artifact_row(session: Session, task_id: str) -> m.Artifact | None:
    return session.scalar(select(m.Artifact).where(m.Artifact.task_id == task_id).order_by(m.Artifact.version.desc()))


def start(platform: Platform, session: Session, task: m.Task, body: EvaluationIn) -> m.Task:
    if task.status != "completed" or task.task_type != MEDICAL_RECORDS or task.scenario != "horizontal" or task.algorithm not in RECORD_ALGORITHMS:
        raise ServiceError(409, "只有已完成的横向问诊经验任务可以评测")
    existing = find_job(session, task.id)
    if existing is not None:
        raise ServiceError(409, "该经验包已有一项评测，请查看或继续已有评测")
    algorithm = platform.registry.algorithm(task.algorithm)
    if algorithm.version != task.plugin_version or algorithm.code_hash() != task.plugin_hash:
        raise ServiceError(409, "当前算法与生成该经验包时的版本不同")
    artifact = _artifact_row(session, task.id)
    if artifact is None:
        raise ServiceError(409, "这个任务没有可评测的经验包")
    model = verified_model(platform, session, body.model)
    aggregation_model = verified_model(platform, session, task.config["serverModel"]) if any(
        step.at == "server" and step.model for step in algorithm.manifest.steps
    ) else None
    cases = freeze_cases(platform, session, task.id, body.sources)
    if not cases:
        raise ServiceError(422, "请选择带参考诊断的独立病例")
    job = m.Task(id=new_id("eval"), source_task_id=task.id, name=f"评测 · {task.name}"[:120], scenario=task.scenario,
                 task_type=task.task_type, algorithm=task.algorithm, plugin_version=task.plugin_version, plugin_hash=task.plugin_hash,
                 config={"model": model, "aggregation_model": aggregation_model, "artifact_version": artifact.version, "cases": cases},
                 status="queued", fake=parse_ref(model)[0] == FAKE_ENDPOINT or task.fake)
    session.add(job)
    session.flush()
    return job


def report_rows(session: Session, job_id: str) -> list[m.Report]:
    return list(session.scalars(select(m.Report).where(m.Report.task_id == job_id)))


def count_case(score: EvaluationScore, arms: dict[Arm, EvaluationArm], required: tuple[Arm, ...], baseline: Arm) -> Change:
    score.total += 1
    score.attempted += len(arms)
    if not all(arm in arms and arms[arm].correct is not None for arm in required):
        return "incomplete"
    score.paired += 1
    score.none += int(arms["none"].correct is True)
    score.local += int("local" in arms and arms["local"].correct is True)
    score.federated += int(arms["federated"].correct is True)
    previous, current = arms[baseline].correct, arms["federated"].correct
    if previous == current:
        score.unchanged += 1
        return "unchanged"
    if current:
        score.improved += 1
        return "improved"
    score.worsened += 1
    return "worsened"


def present(session: Session, job: m.Task) -> EvaluationOut:
    reports = {(row.site_id, row.unit_key, row.step): row.value for row in report_rows(session, job.id)}
    scores: dict[str, EvaluationSite] = {}
    summary = EvaluationScore()
    cases = []
    for index, case in enumerate(job.config["cases"]):
        site = case["site_id"]
        arms: dict[Arm, EvaluationArm] = {arm: EvaluationArm.model_validate(reports[site, str(index), arm])
                for arm in ARMS if (site, str(index), arm) in reports}
        site_score = scores.setdefault(site, EvaluationSite(id=site, name=case["site_name"]))
        change = count_case(site_score, arms, ARMS, "local")
        count_case(summary, arms, ARMS, "local")
        public_arms: dict[Arm, EvaluationArm] = {
            key: EvaluationArm(correct=arm.correct, error="评测未完成" if arm.error else None) for key, arm in arms.items()
        }
        cases.append(EvaluationCase(site_id=site, case_id=f"病例 {index + 1}", reference="", arms=public_arms, change=change))
    return EvaluationOut.model_validate(dict(status=job.status, error=job.error, model=job.config["model"],
                                              score=summary, sites=list(scores.values()), cases=cases if job.status not in ("running", "queued") else []))


def checkpoint(platform: Platform, job: m.Task, site: str, unit: str, step: str, value: Any) -> None:
    with platform.db.session() as session:
        row = session.scalar(select(m.Report).where(
            m.Report.task_id == job.id, m.Report.site_id == site, m.Report.unit_key == unit, m.Report.step == step,
        ))
        if row:
            row.value = value
        else:
            session.add(m.Report(task_id=job.id, round=1, step=step, site_id=site, unit_key=unit, name="experience-evaluation", value=value))


def stop_requested(platform: Platform, job: m.Task) -> str | None:
    with platform.db.session() as session:
        current = session.get(m.Task, job.id)
        if current is None:
            return "canceled"
        if current.command:
            current.status = "canceled" if current.command == "cancel" else "paused"
            current.finished_at = m.now() if current.status == "canceled" else None
            current.command = None
            return current.status
    return None


def evaluate_arm(platform: Platform, job: m.Task, case: dict, index: int, arm: Arm, artifact: Artifact | None,
                 resolved: tuple[EndpointConfig, str] | None = None) -> EvaluationArm:
    algorithm = platform.registry.algorithm(job.algorithm)
    grader = platform.registry.grader(job.config.get("grader") or platform.registry.task_type(MEDICAL_RECORDS).graders[0])
    ledger = LedgerKey(job.id, case["site_id"], 1, arm, str(index))
    if resolved is None:
        model = platform.gateway.model(job.config["model"], plugin=algorithm, purpose="experience-eval", ledger=ledger)
    else:
        model = GatewayModel(platform.gateway, *resolved, plugin=algorithm, purpose="experience-eval", ledger=ledger, step_id=None)
    response = algorithm.apply(artifact, ApplyRequest(input=case["input"]), model)
    if not response.output.strip():
        raise ModelError("模型未返回诊断")
    if resolved is None:
        correct = grader.evaluate(response.output, {"answer": case["reference"]}, model)
    else:
        # 评分格式错只丢弃本组评分缓存，继续时仍可复用已经作答的结果。
        grading_key = LedgerKey(job.id, case["site_id"], 1, f"{arm}-grade", str(index))
        grading_model = GatewayModel(platform.gateway, *resolved, plugin=algorithm, purpose="experience-eval",
                                     ledger=grading_key, step_id=None)
        try:
            correct = grader.evaluate(response.output, {"answer": case["reference"]}, grading_model)
        except ModelError:
            with platform.db.session() as session:
                session.execute(update(m.CallRecord).where(
                    m.CallRecord.task_id == job.id, m.CallRecord.site_id == case["site_id"],
                    m.CallRecord.step == grading_key.step, m.CallRecord.unit_key == str(index),
                    m.CallRecord.status == "ok",
                ).values(status="discarded"))
            raise
    keys = []
    if artifact is not None:
        guidance = experience_guidance(job.algorithm, artifact.content, case["input"])
        keys = list(guidance) if isinstance(guidance, dict) else [entry["id"] for entry in guidance]
    return EvaluationArm(output=response.output, correct=correct, experience_keys=keys)


def run(platform: Platform, job: m.Task) -> str:
    with platform.db.session() as session:
        current = session.get(m.Task, job.id)
        source = session.get(m.Task, job.source_task_id) if job.source_task_id else None
        artifact_row = session.get(m.Artifact, (source.id, job.config["artifact_version"])) if source else None
        if current is None or source is None or artifact_row is None:
            raise RuntimeError("评测来源已不存在")
        algorithm = platform.registry.algorithm(source.algorithm)
        if algorithm.version != source.plugin_version or algorithm.code_hash() != source.plugin_hash:
            current.status = "paused"
            current.error = "当前算法与生成经验包时的版本不同"
            return "paused"
        current.started_at = current.started_at or m.now()
        saved = {(r.site_id, r.unit_key, r.step): r.value for r in report_rows(session, job.id)}
        artifact = Artifact(artifact_row.version, artifact_row.round, artifact_row.kind, artifact_row.content)

    baselines: dict[str, Any] = {}
    failed = 0
    for index, case in enumerate(job.config["cases"]):
        site = case["site_id"]
        for arm in ARMS:
            stopped = stop_requested(platform, job)
            if stopped:
                return stopped
            previous = saved.get((site, str(index), arm))
            if previous and previous.get("correct") is not None:
                continue
            if arm == "local" and site not in baselines:
                stored = saved.get((site, "package", "local-package"))
                try:
                    content = stored["content"] if stored and "content" in stored else local_package(platform, source, job, site, artifact)
                    baselines[site] = Artifact(artifact.version, artifact.round, artifact.kind, content)
                    if not stored or "content" not in stored:
                        checkpoint(platform, job, site, "package", "local-package", {"content": content})
                except (ModelError, StepFailed):
                    LOG.exception("local baseline failed for %s", site)
                    baselines[site] = None
            try:
                if arm == "local" and baselines[site] is None:
                    result = EvaluationArm(error="本站经验包生成失败")
                else:
                    selected = baselines[site] if arm == "local" else artifact if arm == "federated" else None
                    result = evaluate_arm(platform, job, case, index, arm, selected)
            except ModelError:
                LOG.exception("evaluation %s failed for case %s", arm, index)
                result = EvaluationArm(error="模型调用或评分失败")
            checkpoint(platform, job, site, str(index), arm, result.model_dump(by_alias=False))
            failed += int(result.error is not None)
    return finish(platform, job, failed=bool(failed))


def finish(platform: Platform, job: m.Task, *, failed: bool, completed_message: str = "横向评测已完成") -> str:
    status = "paused" if failed else "completed"
    with platform.db.session() as session:
        updated = session.execute(update(m.Task).where(m.Task.id == job.id, m.Task.command.is_(None)).values(
            status=status, error="部分病例未完成，重试时会保留已完成的对照。" if failed else None,
            finished_at=m.now() if not failed else None,
        ))
        if updated.rowcount:  # type: ignore[attr-defined]
            add_event(session, job.id, status, completed_message if not failed else "横向评测部分失败")
            return status
    return stop_requested(platform, job) or status
