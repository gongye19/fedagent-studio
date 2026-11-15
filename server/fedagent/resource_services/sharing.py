"""只改变共享状态，资源所有权和凭据不随共享转移。"""
from sqlalchemy.orm import Session

from .. import models as m
from ..errors import ServiceError
from ..gateway import DEFAULT_ENDPOINT
from .common import not_found

RESOURCE_TABLES = {"data": m.Dataset, "llm": m.Endpoint, "agent": m.AgentEndpoint}


def set_shared(session: Session, kind: str, resource_id: str, shared: bool):
    table = RESOURCE_TABLES.get(kind)
    row = session.get(table, resource_id) if table else None
    if row is None:
        raise not_found("资源")
    if isinstance(row, m.Endpoint) and (row.builtin or row.id == DEFAULT_ENDPOINT):
        raise ServiceError(403, "平台模型由管理员维护，不能修改共享状态")
    if row.resource_space != "workspace":
        raise ServiceError(403, "只能管理当前工作区自己接入资源的共享状态")
    if isinstance(row, m.Dataset) and row.source == "upload" and not shared:
        raise ServiceError(409, "上传的数据供联邦任务使用。如需停止使用，请移除数据。")
    row.shared = shared
    session.flush()
    return row
