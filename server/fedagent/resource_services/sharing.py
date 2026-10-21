"""只改变共享状态，资源所有权和凭据不随共享转移。"""
from sqlalchemy.orm import Session

from .. import models as m
from ..errors import ServiceError
from .common import not_found

RESOURCE_TABLES = {"data": m.Dataset, "llm": m.Endpoint, "agent": m.AgentEndpoint}


def set_shared(session: Session, kind: str, resource_id: str, shared: bool):
    table = RESOURCE_TABLES.get(kind)
    row = session.get(table, resource_id) if table else None
    if row is None:
        raise not_found("资源")
    if row.resource_space != "workspace":
        raise ServiceError(403, "只能管理当前工作区自己接入资源的共享状态")
    if isinstance(row, m.Endpoint) and row.kind == "fake":
        raise ServiceError(409, "测试接口不能共享")
    row.shared = shared
    session.flush()
    return row
