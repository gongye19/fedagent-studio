from __future__ import annotations

from fedagent_sdk import ModelError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import models as m
from ..errors import ServiceError
from ..gateway import FAKE_ENDPOINT
from ..model_network import validate_url
from ..platform import Platform
from ..schemas import EndpointIn, EndpointOut
from .common import new_id, not_found
from .verification import endpoint_verified


def endpoint_out(endpoint: m.Endpoint) -> EndpointOut:
    configured = endpoint.kind == "fake" or (bool(endpoint.base_url.strip()) and bool(endpoint.models))
    return EndpointOut(
        id=endpoint.id,
        owner_id=endpoint.owner_id, owner_name=endpoint.owner_name, shared=endpoint.shared,
        resource_space=endpoint.resource_space,  # type: ignore[arg-type]
        name=endpoint.name,
        kind=endpoint.kind,  # type: ignore[arg-type]
        base_url=endpoint.base_url,
        models=list(endpoint.models or []),
        concurrency=endpoint.concurrency,
        price=endpoint.price,
        has_key=bool(endpoint.api_key_enc),
        builtin=endpoint.builtin,
        configured=configured,
        verified=endpoint_verified(endpoint),
        timeout=endpoint.timeout,
        max_retries=endpoint.max_retries,
    )


def _clean_models(models: list[str]) -> list[str]:
    seen: list[str] = []
    for model in models:
        name = model.strip()
        if name and name not in seen:
            seen.append(name)
    return seen


def save_endpoint(platform: Platform, session: Session, body: EndpointIn, endpoint_id: str | None = None) -> m.Endpoint:
    if endpoint_id is None:
        endpoint = m.Endpoint(id=new_id("ep"), name=body.name.strip(), kind="openai")
        session.add(endpoint)
    else:
        endpoint = session.get(m.Endpoint, endpoint_id)
        if endpoint is None:
            raise not_found("模型接口")
        if endpoint.resource_space != "workspace" and not endpoint.builtin:
            raise ServiceError(403, "只能修改当前工作区自己的 LLM 接口")
        if endpoint.kind == "fake":
            raise ServiceError(409, "测试用假模型不能修改")
    base_url = body.base_url.strip()
    if base_url:
        try:
            validate_url(base_url, platform.gateway.allowed_hosts)
        except ModelError as error:
            raise ServiceError(422, str(error)) from error
    models = _clean_models(body.models)
    if len(models) > 1:
        raise ServiceError(422, "每个接口只能选用一个模型；使用其他模型请另登记一个接口")
    endpoint.name = body.name.strip()
    if (endpoint.base_url or "").rstrip("/") != base_url.rstrip("/"):
        endpoint.api_key_enc = None
    endpoint.base_url = base_url
    endpoint.models = models
    endpoint.concurrency = body.concurrency
    endpoint.price = body.price
    endpoint.timeout = body.timeout
    endpoint.max_retries = body.max_retries
    if body.api_key is not None:
        endpoint.api_key_enc = platform.secrets.encrypt(body.api_key.strip()) if body.api_key.strip() else None
    session.flush()
    return endpoint


def delete_endpoint(session: Session, endpoint_id: str) -> None:
    endpoint = session.get(m.Endpoint, endpoint_id)
    if endpoint is None:
        raise not_found("模型接口")
    if endpoint.resource_space != "workspace" and not endpoint.builtin:
        raise ServiceError(403, "只能删除当前工作区自己的 LLM 接口")
    if endpoint.builtin or endpoint.id == FAKE_ENDPOINT:
        raise ServiceError(409, "预留的接口不能删除")
    references = [m.Task.config[key].as_string() for key in ("model", "aggregation_model", "clientModel", "serverModel")]
    references.append(m.TaskSite.model_ref)
    active = session.scalar(
        select(m.Task.name)
        .outerjoin(m.TaskSite, m.TaskSite.task_id == m.Task.id)
        .where(m.Task.status.in_(("queued", "running", "paused")), or_(
            *(or_(ref == endpoint_id, ref.startswith(f"{endpoint_id}:")) for ref in references),
        ))
        .limit(1)
    )
    if active is not None:
        raise ServiceError(409, f"模型接口仍被任务“{active}”使用，请先完成或取消任务")
    session.delete(endpoint)
