from __future__ import annotations

import secrets
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as m
from ..errors import ServiceError


def new_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(4)}"


def not_found(what: str) -> ServiceError:
    return ServiceError(404, f"{what}不存在")


def require_unused(session: Session, column: Any, value: str, label: str) -> None:
    active = session.scalar(
        select(m.Task.name)
        .join(m.TaskSite, m.TaskSite.task_id == m.Task.id)
        .where(m.Task.status.in_(("queued", "running", "paused")), column == value)
        .limit(1)
    )
    if active is not None:
        raise ServiceError(409, f"{label}仍被任务“{active}”使用，请先完成或取消任务")
