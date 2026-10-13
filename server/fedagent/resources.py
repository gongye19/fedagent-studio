"""参与方、数据集、模型接口：增删改查，以及给前端的表示。"""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from typing import Any
from urllib.parse import urlsplit

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import models as m
from .data import check_file
from .gateway import FAKE_ENDPOINT
from .platform import Platform
from .schemas import (
    CheckProblem,
    DatasetCheckOut,
    DatasetOut,
    EndpointIn,
    EndpointOut,
    ParticipantIn,
    ParticipantOut,
    ParticipantPatch,
    SampleOut,
)


def new_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(4)}"


def not_found(what: str) -> HTTPException:
    return HTTPException(404, f"{what}不存在")


def require_unused(session: Session, column: Any, value: str, label: str) -> None:
    active = session.scalar(
        select(m.Task.name).join(m.TaskSite, m.TaskSite.task_id == m.Task.id)
        .where(m.Task.status.in_(("queued", "running", "paused")), column == value).limit(1)
    )
    if active is not None:
        raise HTTPException(409, f"{label}仍被任务“{active}”使用，请先完成或取消任务")


# —— 参与方 ——


def participant_status(platform: Platform, participant: m.Participant) -> str:
    if participant.hosting == "platform":
        return "online"
    if participant.last_seen_at is None:
        return "waiting"
    seen = m.aware(participant.last_seen_at)
    return "online" if m.now() - seen <= timedelta(seconds=platform.settings.client_offline_seconds) else "offline"


def participant_out(platform: Platform, participant: m.Participant) -> ParticipantOut:
    return ParticipantOut(
        id=participant.id,
        name=participant.name,
        org=participant.org,
        intro=participant.intro,
        hosting=participant.hosting,  # type: ignore[arg-type]
        status=participant_status(platform, participant),  # type: ignore[arg-type]
        builtin=participant.builtin,
        last_seen_at=participant.last_seen_at,
        client_plugins=dict(participant.client_plugins or {}),
    )


def create_participant(session: Session, body: ParticipantIn) -> m.Participant:
    participant = m.Participant(id=new_id("p"), name=body.name.strip(), org=body.org.strip(), intro=body.intro.strip(), hosting=body.hosting)
    session.add(participant)
    session.flush()
    return participant


def update_participant(session: Session, participant_id: str, body: ParticipantPatch) -> m.Participant:
    participant = session.get(m.Participant, participant_id)
    if participant is None:
        raise not_found("参与方")
    for field in ("name", "org", "intro"):
        value = getattr(body, field)
        if value is not None:
            setattr(participant, field, value.strip())
    return participant


def delete_participant(session: Session, participant_id: str) -> None:
    participant = session.get(m.Participant, participant_id)
    if participant is None:
        raise not_found("参与方")
    if participant.builtin:
        raise HTTPException(409, "平台内置参与方不能删除")
    require_unused(session, m.TaskSite.participant_id, participant_id, "参与方")
    session.delete(participant)


# —— 数据集 ——


def dataset_ready(dataset: m.Dataset) -> bool:
    if dataset.source == "local":
        return bool(dataset.item_ids)
    return dataset.content_hash is not None


def dataset_out(dataset: m.Dataset) -> DatasetOut:
    sample = dataset.sample or None
    return DatasetOut(
        id=dataset.id,
        name=dataset.name,
        participant_id=dataset.participant_id,
        description=dataset.description,
        origin=dataset.origin,
        scenario=dataset.scenario,
        task_type=dataset.task_type,
        schema_version=dataset.schema_version,
        source_hash=dataset.source_hash,
        count=dataset.count,
        answered=dataset.answered,
        source=dataset.source,  # type: ignore[arg-type]
        resource_space=dataset.resource_space,  # type: ignore[arg-type]
        sample=SampleOut.model_validate(sample) if sample else None,
        ready=dataset_ready(dataset),
    )


def check_out(report: Any, task_type: Any = None) -> DatasetCheckOut:
    sample = dict(report.sample) if report.sample else None
    if sample is not None and task_type is not None:
        sample["fields"] = task_type.preview(sample)
    return DatasetCheckOut(
        ok=report.ok,
        count=report.count,
        answered=report.answered,
        problems=[CheckProblem(line=issue.line, message=issue.message) for issue in report.issues],
        problem_count=report.issue_count,
        sample=SampleOut.model_validate(sample) if sample else None,
    )


def validate_category(platform: Platform, scenario: str, task_type: str) -> None:
    registry = platform.registry
    if registry.scenario(scenario) is None:
        raise HTTPException(422, f"场景 {scenario} 不存在")
    if task_type not in registry.task_types:
        raise HTTPException(422, f"任务类型 {task_type} 没有安装")
    if task_type not in registry.task_types_for(scenario):
        raise HTTPException(422, "这个场景里还没有能处理这种任务类型的算法")


def create_dataset(
    platform: Platform,
    session: Session,
    *,
    participant_id: str,
    name: str,
    description: str,
    scenario: str,
    task_type: str,
    raw: bytes | None,
) -> tuple[m.Dataset | None, DatasetCheckOut | None]:
    """平台托管的参与方上传文件（检查通过才保存）；本地参与方只登记名称和说明。"""
    participant = session.get(m.Participant, participant_id)
    if participant is None:
        raise not_found("参与方")
    validate_category(platform, scenario, task_type)
    if not name.strip() or len(name.strip()) > 80:
        raise HTTPException(422, "数据集名称应为 1–80 个字符")
    dataset_id = new_id("ds")
    if participant.hosting == "local":
        dataset = m.Dataset(
            id=dataset_id,
            participant_id=participant.id,
            name=name.strip(),
            description=description.strip(),
            scenario=scenario,
            task_type=task_type,
            schema_version=platform.registry.task_type(task_type).schema_version,
            source="local",
        )
        session.add(dataset)
        session.flush()
        return dataset, None
    if raw is None:
        raise HTTPException(422, "平台托管的参与方要上传数据文件")
    report = check_file(platform.registry.task_type(task_type), raw)
    checked = check_out(report, platform.registry.task_type(task_type))
    if not report.ok:
        return None, checked
    path, digest = platform.files.save(dataset_id, report.items)
    dataset = m.Dataset(
        id=dataset_id,
        participant_id=participant.id,
        name=name.strip(),
        description=description.strip() or name.strip(),
        scenario=scenario,
        task_type=task_type,
        schema_version=platform.registry.task_type(task_type).schema_version,
        source_hash=hashlib.sha256(raw).hexdigest(),
        source="upload",
        count=report.count,
        answered=report.answered,
        sample=checked.sample.model_dump() if checked.sample else None,
        content_path=path,
        content_hash=digest,
    )
    session.add(dataset)
    session.flush()
    return dataset, checked


def delete_dataset(session: Session, dataset_id: str) -> None:
    """自己登记的数据集可以删，但每个参与方至少留一份（要删最后一份就删参与方）。文件保留，已有任务不受影响。"""
    dataset = session.get(m.Dataset, dataset_id)
    if dataset is None:
        raise not_found("数据集")
    if dataset.source == "builtin":
        raise HTTPException(409, "平台内置题库不能删除")
    require_unused(session, m.TaskSite.dataset_id, dataset_id, "数据集")
    remaining = session.scalar(select(func.count()).where(m.Dataset.participant_id == dataset.participant_id)) or 0
    if remaining <= 1:
        raise HTTPException(409, "每个参与方至少留一份数据集；要删最后一份，就删除参与方")
    session.delete(dataset)


# —— 模型接口 ——


def delete_data_resource(session: Session, dataset_id: str) -> None:
    """工作区数据可独立删除；本地连接保留，空的托管来源清理。已有任务文件仍保留。"""
    dataset = session.get(m.Dataset, dataset_id)
    if dataset is None:
        raise not_found("数据资源")
    if dataset.resource_space != "workspace" or dataset.source == "builtin":
        raise HTTPException(409, "公用数据由平台维护，不能在我的资源中删除")
    require_unused(session, m.TaskSite.dataset_id, dataset.id, "数据")
    source = session.get(m.Participant, dataset.participant_id)
    remaining = session.scalar(select(func.count()).where(m.Dataset.participant_id == dataset.participant_id)) or 0
    session.delete(dataset)
    if remaining == 1 and source is not None and source.hosting == "platform" and not source.builtin:
        require_unused(session, m.TaskSite.participant_id, source.id, "数据来源")
        session.delete(source)


def endpoint_out(endpoint: m.Endpoint) -> EndpointOut:
    configured = endpoint.kind == "fake" or (bool(endpoint.base_url.strip()) and bool(endpoint.models))
    return EndpointOut(
        id=endpoint.id,
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
        if endpoint.kind == "fake":
            raise HTTPException(409, "测试用假模型不能修改")
    base_url = body.base_url.strip()
    try:
        url = urlsplit(base_url)
        valid_url = url.scheme in ("http", "https") and bool(url.hostname) and not url.username and not url.password and not url.query and not url.fragment
        if url.port is not None and not 1 <= url.port <= 65535:
            valid_url = False
    except ValueError:
        valid_url = False
    if base_url and (not valid_url or any(char.isspace() for char in base_url)):
        raise HTTPException(422, "接口地址要以 http:// 或 https:// 开头")
    models = _clean_models(body.models)
    if len(models) > 1:
        raise HTTPException(422, "每个接口只能选用一个模型；使用其他模型请另登记一个接口")
    endpoint.name = body.name.strip()
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
    if endpoint.builtin or endpoint.id == FAKE_ENDPOINT:
        raise HTTPException(409, "预留的接口不能删除")
    active = session.scalar(
        select(m.Task.name).join(m.TaskSite, m.TaskSite.task_id == m.Task.id)
        .where(m.Task.status.in_(("queued", "running", "paused")),
               (m.TaskSite.model_ref == endpoint_id) | m.TaskSite.model_ref.startswith(f"{endpoint_id}:"))
        .limit(1)
    )
    if active is not None:
        raise HTTPException(409, f"模型接口仍被任务“{active}”使用，请先完成或取消任务")
    session.delete(endpoint)
