"""用已发布的医疗经验包做两组病例对照。"""
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from typing import cast

from fedagent_evomed.grading import SCORING_VERSION
from fedagent_sdk import Artifact, ModelError
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as m
from ..apps import get_app
from ..errors import ServiceError
from ..gateway import FAKE_ENDPOINT, EndpointConfig, parse_ref
from ..platform import Platform
from ..resource_services.verification import digest, endpoint_signature
from ..resources import new_id
from ..schemas.experience import (
    Arm,
    EvaluationArm,
    PackageEvaluationIn,
)
from . import evaluation, frozen_cases
from .cases import freeze_package_cases
from .consultation import MEDICAL_RECORDS, RECORD_ALGORITHMS, verified_model
from .package_results import list_jobs as list_jobs
from .package_results import present as present

ARMS: tuple[Arm, ...] = ("none", "federated")


def get(session: Session, job_id: str) -> m.Task:
    job = session.get(m.Task, job_id)
    if job is None or job.evaluation_package_id is None:
        raise ServiceError(404, "评测记录不存在")
    return job


def verified_package(platform: Platform, session: Session, package_id: str) -> tuple[m.App, m.Task, m.Artifact]:
    app = get_app(session, package_id)
    if app.task_type != MEDICAL_RECORDS or app.scenario != "horizontal" or app.algorithm not in RECORD_ALGORITHMS:
        raise ServiceError(422, "请选择已发布的横向问诊经验包")
    source = session.get(m.Task, app.task_id)
    artifact = session.get(m.Artifact, (app.task_id, app.version))
    if source is None or source.status != "completed" or artifact is None:
        raise ServiceError(409, "经验包缺少已完成的来源任务或生成记录，无法评测")
    algorithm = platform.registry.algorithm(source.algorithm)
    if (app.algorithm != source.algorithm or app.plugin_version != source.plugin_version
            or artifact.plugin_version != app.plugin_version or algorithm.version != source.plugin_version
            or digest(artifact.content) != digest(app.content)):
        raise ServiceError(409, "发布包与来源版本不一致，无法评测")
    return app, source, artifact


def start(platform: Platform, session: Session, body: PackageEvaluationIn) -> m.Task:
    app, source, artifact = verified_package(platform, session, body.package_id)
    active = select(m.Task.id).where(m.Task.evaluation_package_id == app.id,
                                    m.Task.status.in_(("queued", "running", "paused")))
    if session.scalar(active) is not None:
        raise ServiceError(409, "该经验包已有未结束的评测，请查看或停止已有评测")
    model = verified_model(platform, session, body.model)
    endpoint = session.get(m.Endpoint, parse_ref(model)[0])
    assert endpoint is not None
    grader = source.config.get("grader") or platform.registry.task_type(MEDICAL_RECORDS).graders[0]
    platform.registry.grader(grader)
    cases = freeze_package_cases(platform, session, source.id, body.dataset_ids, body.limit)
    usages = {case["usage"] for case in cases}
    usage = "mixed" if len(usages) > 1 else "backtest" if "backtest" in usages else "heldout"
    job_id = new_id("eval")
    job = m.Task(id=job_id, source_task_id=source.id, evaluation_package_id=app.id,
                 name=f"评测 · {app.name}"[:120], scenario=source.scenario, task_type=source.task_type,
                 algorithm=source.algorithm, plugin_version=source.plugin_version, plugin_hash=source.plugin_hash,
                 config={"model": model, "endpoint_signature": endpoint_signature(endpoint), "grader": grader,
                         "artifact_version": artifact.version, "artifact_digest": digest(artifact.content),
                         "package_name": app.name, "usage": usage, "total": len(cases),
                         "consumer_hash": platform.registry.algorithm(source.algorithm).code_hash(), "scoring_version": SCORING_VERSION,
                         **frozen_cases.freeze(platform, job_id, cases)},
                 status="queued", fake=parse_ref(model)[0] == FAKE_ENDPOINT)
    session.add(job)
    session.flush()
    return job


def _answer(platform: Platform, job: m.Task, case: dict, index: int, arm: Arm, artifact: Artifact,
            resolved: tuple[EndpointConfig, str]) -> EvaluationArm:
    try:
        return evaluation.evaluate_arm(platform, job, case, index, arm, artifact if arm == "federated" else None, resolved)
    except ModelError:
        evaluation.LOG.exception("package evaluation %s failed for case %s", arm, index)
        return EvaluationArm(error="模型调用或评分失败")


def run(platform: Platform, job: m.Task) -> str:
    with platform.db.session() as session:
        current = get(session, job.id)
        row = session.get(m.Artifact, (job.source_task_id, job.config["artifact_version"]))
        algorithm = platform.registry.algorithm(job.algorithm)
        endpoint = session.get(m.Endpoint, parse_ref(job.config["model"])[0])
        if row is None or digest(row.content) != job.config["artifact_digest"] or (
            algorithm.version != job.plugin_version or algorithm.code_hash() != job.config.get("consumer_hash", job.plugin_hash)
        ):
            current.status, current.error = "paused", "冻结的经验包或算法版本不再可用"
            return "paused"
        if endpoint is None or endpoint_signature(endpoint) != job.config["endpoint_signature"]:
            current.status, current.error = "paused", "评测模型接口已变化，请恢复配置或重新发起评测"
            return "paused"
        current.started_at = current.started_at or m.now()
        resolved = platform.gateway.resolve(job.config["model"])
        workers = min(8, resolved[0].concurrency)
        artifact = Artifact(row.version, row.round, row.kind, row.content)
        saved = {(item.site_id, item.unit_key, item.step) for item in evaluation.report_rows(session, job.id)
                 if item.value.get("correct") is not None}

    try:
        cases = frozen_cases.load(platform, job)
    except ServiceError:
        with platform.db.session() as session:
            current = get(session, job.id)
            current.status, current.error = "paused", "冻结的评测病例校验失败，请恢复运行文件"
        return "paused"
    units = ((index, case, arm) for index, case in enumerate(cases) for arm in ARMS
                 if (case["site_id"], str(index), arm) not in saved)
    pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="package-eval")
    futures: dict[Future[EvaluationArm], tuple[int, dict, str]] = {}
    failed = False
    try:
        while True:
            if stopped := evaluation.stop_requested(platform, job):
                return stopped
            for _ in range(workers - len(futures)):
                unit = next(units, None)
                if unit is None:
                    break
                index, case, arm = unit
                futures[pool.submit(_answer, platform, job, case, index, cast(Arm, arm), artifact, resolved)] = unit
            if not futures:
                break
            done, _ = wait(futures, timeout=0.5, return_when=FIRST_COMPLETED)
            for future in done:
                index, case, arm = futures.pop(future)
                try:
                    answer = future.result()
                except Exception:
                    evaluation.LOG.exception("package evaluation %s crashed for case %s", arm, index)
                    answer = EvaluationArm(error="评测执行失败")
                evaluation.checkpoint(platform, job, case["site_id"], str(index), arm, {"correct": answer.correct, "error": answer.error})
                failed |= answer.correct is None
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return evaluation.finish(platform, job, failed=failed)
