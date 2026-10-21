from __future__ import annotations

import hashlib
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models as m
from ..data import check_file
from ..errors import ServiceError
from ..platform import Platform
from ..schemas import CheckProblem, DatasetCheckOut, DatasetOut, SampleOut
from .common import new_id, not_found, require_unused


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
        owner_id=dataset.owner_id, owner_name=dataset.owner_name, shared=dataset.shared,
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
        raise ServiceError(422, f"场景 {scenario} 不存在")
    if task_type not in registry.task_types:
        raise ServiceError(422, f"任务类型 {task_type} 没有安装")
    if task_type not in registry.task_types_for(scenario):
        raise ServiceError(422, "这个场景里还没有能处理这种任务类型的算法")


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
        raise ServiceError(422, "数据集名称应为 1–80 个字符")
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
        raise ServiceError(422, "平台托管的参与方要上传数据文件")
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
        raise ServiceError(409, "平台内置题库不能删除")
    require_unused(session, m.TaskSite.dataset_id, dataset_id, "数据集")
    remaining = session.scalar(select(func.count()).where(m.Dataset.participant_id == dataset.participant_id)) or 0
    if remaining <= 1:
        raise ServiceError(409, "每个参与方至少留一份数据集；要删最后一份，就删除参与方")
    session.delete(dataset)


def delete_data_resource(session: Session, dataset_id: str) -> None:
    """工作区数据可独立删除；本地连接保留，空的托管来源清理。已有任务文件仍保留。"""
    dataset = session.get(m.Dataset, dataset_id)
    if dataset is None:
        raise not_found("数据资源")
    if dataset.resource_space != "workspace" or dataset.source == "builtin":
        raise ServiceError(409, "公用数据由平台维护，不能在我的资源中删除")
    require_unused(session, m.TaskSite.dataset_id, dataset.id, "数据")
    source = session.get(m.Participant, dataset.participant_id)
    remaining = session.scalar(select(func.count()).where(m.Dataset.participant_id == dataset.participant_id)) or 0
    session.delete(dataset)
    if remaining == 1 and source is not None and source.hosting == "platform" and not source.builtin:
        require_unused(session, m.TaskSite.participant_id, source.id, "数据来源")
        session.delete(source)
