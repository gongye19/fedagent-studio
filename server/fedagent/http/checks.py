from fastapi import BackgroundTasks, Response
from sqlalchemy import delete

from .. import models as m
from ..checks import service
from ..errors import ServiceError
from ..schemas import TaskConfigIn
from ..schemas.checks import TaskCheckOut
from .dependencies import PlatformDep, SessionDep, admin_router

router = admin_router()


@router.post("/task-checks", response_model=TaskCheckOut, status_code=202, tags=["tasks"])
def test_config(body: TaskConfigIn, background: BackgroundTasks, platform: PlatformDep, session: SessionDep) -> TaskCheckOut:
    row = service.create(platform, session, body)
    session.commit()  # 后台开始前持久化；不能依赖 response 后的依赖清理顺序。
    background.add_task(service.run, platform, row.id, body)
    return service.out(row)


@router.get("/task-checks/{check_id}", response_model=TaskCheckOut, tags=["tasks"])
def get_check(check_id: str, session: SessionDep) -> TaskCheckOut:
    return service.out(service.get(session, check_id))


@router.delete("/task-checks/{check_id}", status_code=204, tags=["tasks"])
def remove_check(check_id: str, session: SessionDep) -> Response:
    row = service.get(session, check_id)
    if row.status in ("queued", "running"):
        raise ServiceError(409, "请等待测试结束")
    session.execute(delete(m.AgentRun).where(m.AgentRun.task_id.is_(None), m.AgentRun.id.startswith(check_id + "_", autoescape=True)))
    session.delete(row)
    return Response(status_code=204)
