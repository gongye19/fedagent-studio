"""公共任务读接口与内部执行记录之间的边界。"""
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import models as m

PRIVATE_TASK_ERROR = "执行详情保留在服务端日志。"
PUBLIC_EVENT_KINDS = frozenset({"create", "start", "round", "complete", "resume", "cancel", "requeue", "restart", "agent-stop"})


def protected_sites(task_id: str):
    return select(m.TaskSite).outerjoin(m.Dataset, m.TaskSite.dataset_id == m.Dataset.id).where(
        m.TaskSite.task_id == task_id, m.TaskSite.kind == "participant",
        or_(m.Dataset.source == "upload", m.Dataset.id.is_(None)),
    )


def uses_uploaded_data(session: Session, task_id: str) -> bool:
    return bool(session.scalar(select(protected_sites(task_id).exists())))
