from __future__ import annotations

from typing import Annotated

from fastapi import BackgroundTasks, HTTPException, Query, Response
from sqlalchemy import select

from .. import models as m
from .. import tasks
from ..schemas import EstimateOut, EventOut, MessageOut, TaskConfigIn, TaskOut, ValidateOut
from ..schemas.process import ProcessPageOut
from ..task_services.process import page as process_page
from .dependencies import PlatformDep, SessionDep, admin_router

router = admin_router()


@router.post("/tasks/validate", response_model=ValidateOut, tags=["tasks"])
def validate_task(body: TaskConfigIn, platform: PlatformDep, session: SessionDep) -> ValidateOut:
    issues, prepared = tasks.validate(platform, session, body)
    estimate = tasks.estimate(platform, body, prepared) if prepared is not None and prepared.sites else None
    return ValidateOut(issues=issues, estimate=estimate)


@router.post("/tasks/estimate", response_model=EstimateOut, tags=["tasks"])
def estimate_task(body: TaskConfigIn, platform: PlatformDep, session: SessionDep) -> EstimateOut:
    _, prepared = tasks.validate(platform, session, body)
    if prepared is None or not prepared.sites:
        raise HTTPException(422, "选好算法和参与方之后才能预估")
    return tasks.estimate(platform, body, prepared)


@router.post("/tasks", response_model=TaskOut, status_code=201, tags=["tasks"])
def create_task(body: TaskConfigIn, platform: PlatformDep, session: SessionDep) -> TaskOut:
    task = tasks.create(platform, session, body)
    session.flush()
    return tasks.task_out(platform, session, task)


@router.get("/tasks", response_model=list[TaskOut], tags=["tasks"])
def list_tasks(
    platform: PlatformDep,
    session: SessionDep,
    scenario: str | None = None,
    task_type: Annotated[str | None, Query(alias="taskType")] = None,
    status: str | None = None,
) -> list[TaskOut]:
    query = select(m.Task).order_by(m.Task.created_at.desc())
    if scenario:
        query = query.where(m.Task.scenario == scenario)
    if task_type:
        query = query.where(m.Task.task_type == task_type)
    if status:
        query = query.where(m.Task.status == status)
    return [tasks.task_out(platform, session, row) for row in session.scalars(query)]


@router.get("/tasks/{task_id}", response_model=TaskOut, tags=["tasks"])
def get_task(task_id: str, platform: PlatformDep, session: SessionDep) -> TaskOut:
    return tasks.task_out(platform, session, tasks.get_task(session, task_id))


@router.delete("/tasks/{task_id}", status_code=204, tags=["tasks"])
def delete_task(task_id: str, background: BackgroundTasks, platform: PlatformDep, session: SessionDep) -> Response:
    tasks.delete_task(session, task_id)
    background.add_task(tasks.remove_run_directory, platform, task_id)
    return Response(status_code=204)


@router.post("/tasks/{task_id}/{action}", response_model=TaskOut, tags=["tasks"])
def control_task(task_id: str, action: str, platform: PlatformDep, session: SessionDep) -> TaskOut:
    if action not in ("pause", "resume", "cancel"):
        raise HTTPException(404, "未知操作")
    task = tasks.control(session, task_id, action)
    session.flush()
    return tasks.task_out(platform, session, task)


@router.get("/tasks/{task_id}/messages", response_model=list[MessageOut], tags=["tasks"])
def task_messages(
    task_id: str,
    platform: PlatformDep,
    session: SessionDep,
    round: int | None = None,
    site: str | None = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
    after: Annotated[int, Query(ge=0)] = 0,
) -> list[MessageOut]:
    return tasks.messages_out(platform, session, tasks.get_task(session, task_id), round=round, site=site, limit=limit, after=after)


@router.get("/tasks/{task_id}/events", response_model=list[EventOut], tags=["tasks"])
def task_events(task_id: str, session: SessionDep) -> list[EventOut]:
    tasks.get_task(session, task_id)
    rows = session.scalars(select(m.Event).where(m.Event.task_id == task_id, m.Event.kind != "process").order_by(m.Event.id))
    return [EventOut(id=row.id, kind=row.kind, message=row.message, created_at=row.created_at) for row in rows]


@router.get("/tasks/{task_id}/process", response_model=ProcessPageOut, tags=["tasks"])
def task_process(task_id: str, session: SessionDep, after: Annotated[int, Query(ge=0)] = 0,
                 round: Annotated[int | None, Query(ge=1)] = None, site: str | None = None) -> ProcessPageOut:
    tasks.get_task(session, task_id)
    return process_page(session, task_id, after=after, round=round, site=site)
