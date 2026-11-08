from typing import Literal

from sqlalchemy.exc import IntegrityError

from .. import apps, tasks
from ..errors import ServiceError
from ..experience import consultation, evaluation, package_evaluation
from ..schemas.experience import (
    ChatIn,
    ChatOut,
    ConsultationIn,
    ConsultationOut,
    EvaluationIn,
    EvaluationOut,
    PackageEvaluationIn,
    PackageEvaluationOut,
    PackageEvaluationSummary,
)
from .dependencies import PlatformDep, SessionDep, admin_router

router = admin_router()


@router.post("/apps/{app_id}/chat", response_model=ChatOut, tags=["apps"])
def chat(app_id: str, body: ChatIn, platform: PlatformDep, session: SessionDep) -> ChatOut:
    app = apps.get_app(session, app_id)
    model = consultation.verified_model(platform, session, body.model)
    session.expunge(app)
    session.rollback()
    return consultation.chat(platform, app, model, body)


@router.post("/consultation/chat", response_model=ConsultationOut, tags=["apps"])
def routed_chat(body: ConsultationIn, platform: PlatformDep, session: SessionDep) -> ConsultationOut:
    app = apps.get_app(session, body.package_id) if body.package_id else None
    model = consultation.verified_model(platform, session, body.model)
    if app is not None:
        session.expunge(app)
    session.rollback()
    return consultation.routed_chat(platform, app, model, body)


@router.get("/tasks/{task_id}/experience-evaluation", response_model=EvaluationOut | None, tags=["tasks"])
def get_evaluation(task_id: str, session: SessionDep) -> EvaluationOut | None:
    tasks.get_task(session, task_id)
    job = evaluation.find_job(session, task_id)
    return evaluation.present(session, job) if job else None


@router.post("/tasks/{task_id}/experience-evaluation", response_model=EvaluationOut, status_code=201, tags=["tasks"])
def start_evaluation(task_id: str, body: EvaluationIn, platform: PlatformDep, session: SessionDep) -> EvaluationOut:
    task = tasks.get_task(session, task_id)
    try:
        job = evaluation.start(platform, session, task, body)
    except IntegrityError as error:
        raise ServiceError(409, "已有评测正在创建，或来源任务已变化，请刷新后查看") from error
    return evaluation.present(session, job)


@router.post("/tasks/{task_id}/experience-evaluation/{action}", response_model=EvaluationOut, tags=["tasks"])
def control_evaluation(task_id: str, action: Literal["resume", "cancel"], session: SessionDep) -> EvaluationOut:
    tasks.get_task(session, task_id)
    job = evaluation.find_job(session, task_id)
    if job is None:
        raise ServiceError(404, "这项任务还没有评测")
    tasks.control(session, job.id, action)
    session.flush()
    return evaluation.present(session, job)


@router.get("/evaluations", response_model=list[PackageEvaluationSummary], tags=["evaluations"])
def list_package_evaluations(session: SessionDep) -> list[PackageEvaluationSummary]:
    return package_evaluation.list_jobs(session)


@router.post("/evaluations", response_model=PackageEvaluationOut, status_code=201, tags=["evaluations"])
def start_package_evaluation(body: PackageEvaluationIn, platform: PlatformDep, session: SessionDep) -> PackageEvaluationOut:
    try:
        job = package_evaluation.start(platform, session, body)
    except IntegrityError as error:
        raise ServiceError(409, "评测已创建或来源已变化，请刷新后查看") from error
    return package_evaluation.present(session, job)


@router.get("/evaluations/{job_id}", response_model=PackageEvaluationOut, tags=["evaluations"])
def get_package_evaluation(job_id: str, session: SessionDep) -> PackageEvaluationOut:
    return package_evaluation.present(session, package_evaluation.get(session, job_id))


@router.post("/evaluations/{job_id}/{action}", response_model=PackageEvaluationOut, tags=["evaluations"])
def control_package_evaluation(job_id: str, action: Literal["resume", "cancel"], session: SessionDep) -> PackageEvaluationOut:
    job = package_evaluation.get(session, job_id)
    tasks.control(session, job.id, action)
    session.flush()
    return package_evaluation.present(session, job)
