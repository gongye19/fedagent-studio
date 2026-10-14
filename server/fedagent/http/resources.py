from __future__ import annotations

import json
from typing import Annotated

from fastapi import File, Form, HTTPException, Query, Response, UploadFile
from sqlalchemy import select

from .. import clients, resources
from .. import models as m
from ..data import MAX_FILE_BYTES, check_file
from ..registry import SCENARIOS
from ..schemas import ClientTokenOut, DataResourceOut, DatasetCheckOut, DatasetOut, ParticipantOut, ParticipantPatch
from .dependencies import PlatformDep, SessionDep, admin_router

router = admin_router()


async def _read_upload(file: UploadFile | None) -> bytes | None:
    if file is None:
        return None
    raw = await file.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES:
        raise HTTPException(413, "文件超过 20 MB")
    return raw


def _participants_order(rows: list[m.Participant]) -> list[m.Participant]:
    """新登记的在前（按登记时间从新到旧），内置数据在后。"""
    own = sorted((row for row in rows if not row.builtin), key=lambda row: row.created_at, reverse=True)
    builtin = sorted((row for row in rows if row.builtin), key=lambda row: (row.hosting != "local", row.id))
    return own + builtin


@router.get("/participants", response_model=list[ParticipantOut], tags=["participants"])
def list_participants(platform: PlatformDep, session: SessionDep) -> list[ParticipantOut]:
    rows = list(session.scalars(select(m.Participant)))
    return [resources.participant_out(platform, row) for row in _participants_order(rows)]


@router.post("/participants", response_model=ParticipantOut, status_code=201, tags=["participants"])
async def create_participant(
    platform: PlatformDep,
    session: SessionDep,
    name: Annotated[str, Form(min_length=1, max_length=40)],
    hosting: Annotated[str, Form(pattern="^(platform|local)$")],
    dataset_name: Annotated[str, Form(alias="datasetName", min_length=1, max_length=40)],
    scenario: Annotated[str, Form()],
    task_type: Annotated[str, Form(alias="taskType")],
    org: Annotated[str, Form(max_length=40)] = "",
    intro: Annotated[str, Form(max_length=120)] = "",
    dataset_description: Annotated[str, Form(alias="datasetDescription", max_length=120)] = "",
    file: Annotated[UploadFile | None, File()] = None,
) -> ParticipantOut:
    """新增参与方，同时登记它的第一份数据集（同一个事务：数据集检查不通过时什么都不保存）。"""
    from ..schemas import ParticipantIn

    participant = resources.create_participant(session, ParticipantIn(name=name, org=org, intro=intro, hosting=hosting))  # type: ignore[arg-type]
    session.flush()
    dataset, checked = resources.create_dataset(
        platform,
        session,
        participant_id=participant.id,
        name=dataset_name,
        description=dataset_description,
        scenario=scenario,
        task_type=task_type,
        raw=await _read_upload(file),
    )
    if dataset is None:
        session.rollback()
        raise HTTPException(422, {"message": "数据文件检查不通过", "check": checked.model_dump() if checked else None})
    return resources.participant_out(platform, participant)


@router.patch("/participants/{participant_id}", response_model=ParticipantOut, tags=["participants"])
def update_participant(participant_id: str, body: ParticipantPatch, platform: PlatformDep, session: SessionDep) -> ParticipantOut:
    return resources.participant_out(platform, resources.update_participant(session, participant_id, body))


@router.delete("/participants/{participant_id}", status_code=204, tags=["participants"])
def delete_participant(participant_id: str, session: SessionDep) -> Response:
    resources.delete_participant(session, participant_id)
    return Response(status_code=204)


@router.post("/participants/{participant_id}/client-tokens", response_model=ClientTokenOut, status_code=201, tags=["participants"])
def issue_client_token(participant_id: str, session: SessionDep) -> ClientTokenOut:
    token, raw = clients.issue_token(session, participant_id)
    return ClientTokenOut(id=token.id, token=raw, created_at=token.created_at)


@router.get("/participants/{participant_id}/client-tokens", response_model=list[ClientTokenOut], tags=["participants"])
def list_client_tokens(participant_id: str, session: SessionDep) -> list[ClientTokenOut]:
    rows = session.scalars(
        select(m.ClientToken).where(m.ClientToken.participant_id == participant_id, m.ClientToken.revoked_at.is_(None)).order_by(m.ClientToken.created_at)
    )
    return [ClientTokenOut(id=row.id, token=None, created_at=row.created_at) for row in rows]


@router.delete("/client-tokens/{token_id}", status_code=204, tags=["participants"])
def revoke_client_token(token_id: str, session: SessionDep) -> Response:
    token = session.get(m.ClientToken, token_id)
    if token is None:
        raise resources.not_found("令牌")
    token.revoked_at = m.now()
    return Response(status_code=204)


@router.post("/resources/data", response_model=DataResourceOut, status_code=201, tags=["resources"])
async def create_data_resource(
    platform: PlatformDep,
    session: SessionDep,
    name: Annotated[str, Form(min_length=1, max_length=40)],
    task_type: Annotated[str, Form(alias="taskType")],
    hosting: Annotated[str, Form(pattern="^(platform|local)$")],
    scenario: Annotated[str | None, Form()] = None,
    source_id: Annotated[str | None, Form(alias="sourceId")] = None,
    source_name: Annotated[str, Form(alias="sourceName", max_length=40)] = "",
    description: Annotated[str, Form(max_length=120)] = "",
    file: Annotated[UploadFile | None, File()] = None,
) -> DataResourceOut:
    """用户接入自己的数据：选择既有执行来源或与第一份数据原子登记，无需先新建参与方。"""
    from ..schemas import ParticipantIn

    supported = [item.id for item in SCENARIOS if task_type in platform.registry.task_types_for(item.id)]
    if not supported:
        raise HTTPException(422, "还没有算法支持这种任务类型")
    category = scenario or supported[0]
    if source_id:
        source = session.get(m.Participant, source_id)
        if source is None:
            raise resources.not_found("数据来源")
        if source.builtin:
            raise HTTPException(409, "请选择自己的数据来源，或新建来源；公用来源由平台维护")
        if source.hosting != hosting:
            raise HTTPException(422, "运行位置和已有数据来源不一致")
    else:
        source = resources.create_participant(session, ParticipantIn(name=source_name.strip() or name, hosting=hosting))  # type: ignore[arg-type]
    dataset, checked = resources.create_dataset(
        platform, session, participant_id=source.id, name=name, description=description, scenario=category, task_type=task_type, raw=await _read_upload(file)
    )
    if dataset is None:
        session.rollback()
        raise HTTPException(422, {"message": "数据文件检查不通过", "check": checked.model_dump() if checked else None})
    return DataResourceOut(dataset=resources.dataset_out(dataset), source=resources.participant_out(platform, source))


@router.delete("/resources/data/{dataset_id}", status_code=204, tags=["resources"])
def delete_data_resource(dataset_id: str, session: SessionDep) -> Response:
    resources.delete_data_resource(session, dataset_id)
    return Response(status_code=204)


@router.get("/datasets", response_model=list[DatasetOut], tags=["datasets"])
def list_datasets(
    session: SessionDep,
    participant: str | None = None,
    scenario: str | None = None,
    task_type: Annotated[str | None, Query(alias="taskType")] = None,
) -> list[DatasetOut]:
    query = select(m.Dataset).order_by(m.Dataset.created_at.desc(), m.Dataset.id)
    if participant:
        query = query.where(m.Dataset.participant_id == participant)
    if scenario:
        query = query.where(m.Dataset.scenario == scenario)
    if task_type:
        query = query.where(m.Dataset.task_type == task_type)
    return [resources.dataset_out(row) for row in session.scalars(query)]


@router.post("/datasets", response_model=DatasetOut, status_code=201, tags=["datasets"])
async def create_dataset(
    platform: PlatformDep,
    session: SessionDep,
    participant_id: Annotated[str, Form(alias="participantId")],
    name: Annotated[str, Form(min_length=1, max_length=40)],
    scenario: Annotated[str, Form()],
    task_type: Annotated[str, Form(alias="taskType")],
    description: Annotated[str, Form(max_length=120)] = "",
    file: Annotated[UploadFile | None, File()] = None,
) -> DatasetOut:
    dataset, checked = resources.create_dataset(
        platform,
        session,
        participant_id=participant_id,
        name=name,
        description=description,
        scenario=scenario,
        task_type=task_type,
        raw=await _read_upload(file),
    )
    if dataset is None:
        raise HTTPException(422, {"message": "数据文件检查不通过", "check": checked.model_dump() if checked else None})
    return resources.dataset_out(dataset)


@router.post("/datasets/check", response_model=DatasetCheckOut, tags=["datasets"])
async def check_dataset(platform: PlatformDep, task_type: Annotated[str, Form(alias="taskType")], file: Annotated[UploadFile, File()]) -> DatasetCheckOut:
    raw = await _read_upload(file)
    plugin = platform.registry.task_types.get(task_type)
    if plugin is None:
        raise HTTPException(422, "所选任务类型未安装，请刷新后重新选择")
    return resources.check_out(check_file(plugin, raw or b""), plugin)


@router.get("/task-types/{task_type}/template", tags=["datasets"])
def dataset_template(task_type: str, platform: PlatformDep) -> Response:
    plugin = platform.registry.task_types.get(task_type)
    if plugin is None:
        raise HTTPException(404, "任务类型不存在")
    body = "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in plugin.template)
    return Response(body, media_type="application/x-ndjson", headers={"Content-Disposition": 'attachment; filename="dataset-template.jsonl"'})


@router.delete("/datasets/{dataset_id}", status_code=204, tags=["datasets"])
def delete_dataset(dataset_id: str, session: SessionDep) -> Response:
    resources.delete_dataset(session, dataset_id)
    return Response(status_code=204)
