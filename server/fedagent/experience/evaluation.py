"""独立评测复用任务队列和调用账本，完成的回答与本站经验会保留。"""
from __future__ import annotations

import logging
from typing import Any

from fedagent_sdk import ApplyRequest, Artifact, ModelError, StepFailed
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .. import models as m
from ..errors import ServiceError
from ..gateway import FAKE_ENDPOINT, LedgerKey, parse_ref
from ..platform import Platform
from ..resources import new_id
from ..schemas.experience import Arm, EvaluationArm, EvaluationCase, EvaluationIn, EvaluationOut, EvaluationScore, EvaluationSite
from ..units import add_event
from .baseline import local_package
from .cases import freeze_cases
from .consultation import MEDICAL_RECORDS, RECORD_ALGORITHMS, experience_guidance, verified_model

ARMS: tuple[Arm, ...] = ("none", "local", "federated")
LOG = logging.getLogger(__name__)


def find_job(session: Session, task_id: str) -> m.Task | None:
    return session.scalar(select(m.Task).where(m.Task.source_task_id == task_id))


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


def _report_rows(session: Session, job_id: str) -> list[m.Report]:
    return list(session.scalars(select(m.Report).where(m.Report.task_id == job_id)))


def present(session: Session, job: m.Task) -> EvaluationOut:
    reports = {(row.site_id, row.unit_key, row.step): row.value for row in _report_rows(session, job.id)}
    scores: dict[str, EvaluationSite] = {}
    summary = EvaluationScore()
    cases = []
    for index, case in enumerate(job.config["cases"]):
        site = case["site_id"]
        arms: dict[Arm, EvaluationArm] = {arm: EvaluationArm.model_validate(reports[site, str(index), arm])
                for arm in ARMS if (site, str(index), arm) in reports}
        paired = all(arm in arms and arms[arm].correct is not None for arm in ARMS)
        change = "incomplete"
        if paired:
            local, federated = arms["local"].correct, arms["federated"].correct
            change = "unchanged" if local == federated else "improved" if federated else "worsened"
        site_score = scores.setdefault(site, EvaluationSite(id=site, name=case["site_name"]))
        for score in (summary, site_score):
            score.total += 1
            score.attempted += len(arms)
            if paired:
                score.paired += 1
                score.none += int(arms["none"].correct is True)
                score.local += int(arms["local"].correct is True)
                score.federated += int(arms["federated"].correct is True)
                score.improved += int(change == "improved")
                score.worsened += int(change == "worsened")
                score.unchanged += int(change == "unchanged")
        public_arms: dict[Arm, EvaluationArm] = {
            key: EvaluationArm(correct=arm.correct, error="评测未完成" if arm.error else None) for key, arm in arms.items()
        }
        cases.append(EvaluationCase(site_id=site, case_id=f"病例 {index + 1}", reference="", arms=public_arms, change=change))
    return EvaluationOut.model_validate(dict(status=job.status, error=job.error, model=job.config["model"],
                                              score=summary, sites=list(scores.values()), cases=cases if job.status not in ("running", "queued") else []))


def _checkpoint(platform: Platform, job: m.Task, site: str, unit: str, step: str, value: Any) -> None:
    with platform.db.session() as session:
        row = session.scalar(select(m.Report).where(
            m.Report.task_id == job.id, m.Report.site_id == site, m.Report.unit_key == unit, m.Report.step == step,
        ))
        if row:
            row.value = value
        else:
            session.add(m.Report(task_id=job.id, round=1, step=step, site_id=site, unit_key=unit, name="experience-evaluation", value=value))


def _stop_requested(platform: Platform, job: m.Task) -> str | None:
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


def _evaluate(platform: Platform, job: m.Task, case: dict, index: int, arm: Arm, artifact: Artifact | None) -> EvaluationArm:
    algorithm = platform.registry.algorithm(job.algorithm)
    grader = platform.registry.grader(platform.registry.task_type(MEDICAL_RECORDS).graders[0])
    model = platform.gateway.model(job.config["model"], plugin=algorithm, purpose="experience-eval",
                                   ledger=LedgerKey(job.id, case["site_id"], 1, arm, str(index)))
    request = ApplyRequest(input=case["input"])
    response = algorithm.apply(artifact, request, model)
    if not response.output.strip():
        raise ModelError("模型未返回诊断")
    correct = grader.evaluate(response.output, {"answer": case["reference"]}, model)
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
        saved = {(r.site_id, r.unit_key, r.step): r.value for r in _report_rows(session, job.id)}
        artifact = Artifact(artifact_row.version, artifact_row.round, artifact_row.kind, artifact_row.content)

    baselines: dict[str, Any] = {}
    failed = 0
    for index, case in enumerate(job.config["cases"]):
        site = case["site_id"]
        for arm in ARMS:
            stopped = _stop_requested(platform, job)
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
                        _checkpoint(platform, job, site, "package", "local-package", {"content": content})
                except (ModelError, StepFailed):
                    LOG.exception("local baseline failed for %s", site)
                    baselines[site] = None
            try:
                if arm == "local" and baselines[site] is None:
                    result = EvaluationArm(error="本站经验包生成失败")
                else:
                    selected = baselines[site] if arm == "local" else artifact if arm == "federated" else None
                    result = _evaluate(platform, job, case, index, arm, selected)
            except ModelError:
                LOG.exception("evaluation %s failed for case %s", arm, index)
                result = EvaluationArm(error="模型调用或评分失败")
            _checkpoint(platform, job, site, str(index), arm, result.model_dump(by_alias=False))
            failed += int(result.error is not None)
    status = "paused" if failed else "completed"
    with platform.db.session() as session:
        updated = session.execute(update(m.Task).where(m.Task.id == job.id, m.Task.command.is_(None)).values(
            status=status, error="部分病例未完成，重试时会保留已完成的对照。" if failed else None,
            finished_at=m.now() if not failed else None,
        ))
        if updated.rowcount:  # type: ignore[attr-defined]
            add_event(session, job.id, status, "横向评测已完成" if not failed else "横向评测部分失败")
            return status
    return _stop_requested(platform, job) or status
