"""REST API：界面、命令行、参与方客户端共用一套接口。

- /v1/...：管理接口。设置了 FEDAGENT_ADMIN_TOKEN 时要带 Authorization: Bearer <令牌>；
- /v1/client/...：参与方客户端，用平台签发的客户端令牌；
- /healthz、/v1/meta 不需要令牌；
- 设置了 FEDAGENT_FRONTEND_DIST 时，同一个端口也提供前端静态文件。
"""

from __future__ import annotations

import hmac
import time
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fedagent_sdk import ModelError
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.types import Scope

from . import __version__, apps, clients, resources, tasks
from . import models as m
from .data import MAX_FILE_BYTES, check_file
from .platform import Platform
from .schemas import (
    AlgorithmOut,
    AppIn,
    ApplyIn,
    ApplyOut,
    AppOut,
    AppPatch,
    ClaimIn,
    ClientHelloIn,
    ClientHelloOut,
    ClientTokenOut,
    ClientUnitOut,
    CompleteIn,
    DatasetCheckOut,
    DatasetOut,
    EndpointIn,
    EndpointModelsOut,
    EndpointOut,
    EndpointTestOut,
    EstimateOut,
    EventOut,
    FailIn,
    MessageOut,
    MetaOut,
    ModelCheckOut,
    ModelListIn,
    ParticipantOut,
    ParticipantPatch,
    RegistryOut,
    TaskConfigIn,
    TaskOut,
    UnitInputsOut,
    ValidateOut,
)

# —— 依赖 ——


def platform_of(request: Request) -> Platform:
    return request.app.state.platform


def db_session(request: Request) -> Iterator[Session]:
    with platform_of(request).db.session() as session:
        yield session


def require_admin(request: Request, authorization: Annotated[str | None, Header()] = None) -> None:
    token = platform_of(request).settings.admin_token
    if not token:
        return
    supplied = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(supplied, token):
        raise HTTPException(401, "需要访问令牌")


PlatformDep = Annotated[Platform, Depends(platform_of)]
# 写事务必须先提交再返回响应，否则立即刷新列表可能读到提交前的状态。
SessionDep = Annotated[Session, Depends(db_session, scope="function")]

admin = APIRouter(prefix="/v1", dependencies=[Depends(require_admin)])
public = APIRouter()
client = APIRouter(prefix="/v1/client", tags=["client"])


async def _read_upload(file: UploadFile | None) -> bytes | None:
    if file is None:
        return None
    raw = await file.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES:
        raise HTTPException(413, "文件超过 20 MB")
    return raw


# —— 系统 ——


@public.get("/healthz", include_in_schema=False)
def healthz(session: SessionDep) -> dict[str, bool]:
    session.execute(select(1))
    return {"ok": True}


@public.get("/v1/meta", response_model=MetaOut, tags=["system"])
def meta(platform: PlatformDep) -> MetaOut:
    packages = platform.settings.client_dist
    return MetaOut(
        version=__version__,
        auth_required=bool(platform.settings.admin_token),
        client_packages=sorted(path.name for path in packages.glob("*.whl")) if packages and packages.is_dir() else [],
    )


# —— 注册表 ——


@admin.get("/registry", response_model=RegistryOut, tags=["registry"])
def registry(platform: PlatformDep) -> dict:
    return platform.registry.describe()


@admin.get("/algorithms/{algorithm_id}", response_model=AlgorithmOut, tags=["registry"])
def algorithm(algorithm_id: str, platform: PlatformDep) -> dict:
    found = platform.registry.algorithms.get(algorithm_id)
    if found is None:
        raise resources.not_found("算法")
    return platform.registry.describe_algorithm(found)


# —— 参与方 ——


def _participants_order(rows: list[m.Participant]) -> list[m.Participant]:
    """新登记的在前（按登记时间从新到旧），内置数据在后。"""
    own = sorted((row for row in rows if not row.builtin), key=lambda row: row.created_at, reverse=True)
    builtin = sorted((row for row in rows if row.builtin), key=lambda row: (row.hosting != "local", row.id))
    return own + builtin


@admin.get("/participants", response_model=list[ParticipantOut], tags=["participants"])
def list_participants(platform: PlatformDep, session: SessionDep) -> list[ParticipantOut]:
    rows = list(session.scalars(select(m.Participant)))
    return [resources.participant_out(platform, row) for row in _participants_order(rows)]


@admin.post("/participants", response_model=ParticipantOut, status_code=201, tags=["participants"])
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
    from .schemas import ParticipantIn

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


@admin.patch("/participants/{participant_id}", response_model=ParticipantOut, tags=["participants"])
def update_participant(participant_id: str, body: ParticipantPatch, platform: PlatformDep, session: SessionDep) -> ParticipantOut:
    return resources.participant_out(platform, resources.update_participant(session, participant_id, body))


@admin.delete("/participants/{participant_id}", status_code=204, tags=["participants"])
def delete_participant(participant_id: str, session: SessionDep) -> Response:
    resources.delete_participant(session, participant_id)
    return Response(status_code=204)


@admin.post("/participants/{participant_id}/client-tokens", response_model=ClientTokenOut, status_code=201, tags=["participants"])
def issue_client_token(participant_id: str, session: SessionDep) -> ClientTokenOut:
    token, raw = clients.issue_token(session, participant_id)
    return ClientTokenOut(id=token.id, token=raw, created_at=token.created_at)


@admin.get("/participants/{participant_id}/client-tokens", response_model=list[ClientTokenOut], tags=["participants"])
def list_client_tokens(participant_id: str, session: SessionDep) -> list[ClientTokenOut]:
    rows = session.scalars(
        select(m.ClientToken).where(m.ClientToken.participant_id == participant_id, m.ClientToken.revoked_at.is_(None)).order_by(m.ClientToken.created_at)
    )
    return [ClientTokenOut(id=row.id, token=None, created_at=row.created_at) for row in rows]


@admin.delete("/client-tokens/{token_id}", status_code=204, tags=["participants"])
def revoke_client_token(token_id: str, session: SessionDep) -> Response:
    token = session.get(m.ClientToken, token_id)
    if token is None:
        raise resources.not_found("令牌")
    token.revoked_at = m.now()
    return Response(status_code=204)


# —— 数据集 ——


@admin.get("/datasets", response_model=list[DatasetOut], tags=["datasets"])
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


@admin.post("/datasets", response_model=DatasetOut, status_code=201, tags=["datasets"])
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


@admin.post("/datasets/check", response_model=DatasetCheckOut, tags=["datasets"])
async def check_dataset(platform: PlatformDep, task_type: Annotated[str, Form(alias="taskType")], file: Annotated[UploadFile, File()]) -> DatasetCheckOut:
    raw = await _read_upload(file)
    return resources.check_out(check_file(platform.registry.task_type(task_type), raw or b""))


@admin.delete("/datasets/{dataset_id}", status_code=204, tags=["datasets"])
def delete_dataset(dataset_id: str, session: SessionDep) -> Response:
    resources.delete_dataset(session, dataset_id)
    return Response(status_code=204)


# —— 模型接口 ——


@admin.get("/endpoints", response_model=list[EndpointOut], tags=["endpoints"])
def list_endpoints(session: SessionDep) -> list[EndpointOut]:
    rows = session.scalars(select(m.Endpoint).order_by(m.Endpoint.builtin.desc(), m.Endpoint.created_at))
    return [resources.endpoint_out(row) for row in rows]


@admin.post("/endpoints", response_model=EndpointOut, status_code=201, tags=["endpoints"])
def create_endpoint(body: EndpointIn, platform: PlatformDep, session: SessionDep) -> EndpointOut:
    return resources.endpoint_out(resources.save_endpoint(platform, session, body))


@admin.put("/endpoints/{endpoint_id}", response_model=EndpointOut, tags=["endpoints"])
def update_endpoint(endpoint_id: str, body: EndpointIn, platform: PlatformDep, session: SessionDep) -> EndpointOut:
    return resources.endpoint_out(resources.save_endpoint(platform, session, body, endpoint_id))


@admin.delete("/endpoints/{endpoint_id}", status_code=204, tags=["endpoints"])
def delete_endpoint(endpoint_id: str, session: SessionDep) -> Response:
    resources.delete_endpoint(session, endpoint_id)
    return Response(status_code=204)


@admin.post("/endpoints/models", response_model=EndpointModelsOut, tags=["endpoints"])
def preview_models(body: ModelListIn, platform: PlatformDep) -> EndpointModelsOut:
    """读一个接口地址提供的模型，新增、编辑接口时选模型用；不保存任何东西。没填密钥时用这个接口已经保存的密钥。"""
    gateway = platform.gateway
    key = body.api_key
    if key is None and body.endpoint_id:
        try:
            endpoint = gateway.endpoint(body.endpoint_id)
            # 编辑地址时，不能把原接口已保存的密钥发送给另一个服务。
            if body.base_url.strip().rstrip("/") == endpoint.base_url.rstrip("/"):
                key = endpoint.api_key
        except ModelError as error:
            raise HTTPException(404, str(error)) from error
    try:
        return EndpointModelsOut(models=gateway.list_models_at(body.base_url, key))
    except ModelError as error:
        raise HTTPException(502, f"读不到模型列表：{error}") from error


@admin.get("/endpoints/{endpoint_id}/models", response_model=EndpointModelsOut, tags=["endpoints"])
def endpoint_models(endpoint_id: str, platform: PlatformDep) -> EndpointModelsOut:
    """接口提供的模型（读接口的 GET /models），选模型时用。"""
    gateway = platform.gateway
    try:
        gateway.endpoint(endpoint_id)
    except ModelError as error:
        raise HTTPException(404, str(error)) from error
    try:
        return EndpointModelsOut(models=gateway.list_models(endpoint_id))
    except ModelError as error:
        raise HTTPException(502, f"读不到模型列表：{error}") from error


@admin.post("/endpoints/{endpoint_id}/test", response_model=EndpointTestOut, tags=["endpoints"])
def test_endpoint(endpoint_id: str, platform: PlatformDep) -> EndpointTestOut:
    """检查接口：读接口的模型列表；每个登记的模型按算法实际用的生成参数各发一条很短的请求（会产生极少量费用）。"""
    gateway = platform.gateway
    try:
        endpoint = gateway.endpoint(endpoint_id)
    except ModelError as error:
        raise HTTPException(404, str(error)) from error
    if not endpoint.configured:
        return EndpointTestOut(ok=False, model=None, latency_ms=None, message="还没有填接口地址和模型")
    available: list[str] | None = None
    models_error: str | None = None
    try:
        available = gateway.list_models(endpoint_id)
    except ModelError as error:
        models_error = str(error)  # 有的接口不提供模型列表，不算失败
    settings = platform.registry.model_settings()
    checks: list[ModelCheckOut] = []
    for model in endpoint.models:
        started = time.monotonic()
        try:
            gateway.probe(endpoint_id, model, settings)
            checks.append(ModelCheckOut(model=model, ok=True, latency_ms=int((time.monotonic() - started) * 1000), message="正常"))
        except ModelError as error:
            checks.append(ModelCheckOut(model=model, ok=False, latency_ms=None, message=str(error)))
    failed = [check for check in checks if not check.ok]
    missing = [model for model in endpoint.models if available is not None and endpoint.kind != "fake" and model not in available]
    if failed:
        message = f"{len(failed)} 个模型不能用：" + "；".join(f"{check.model}（{check.message}）" for check in failed)
    else:
        message = "模型都能用：" + "、".join(f"{check.model} {check.latency_ms / 1000:.1f} 秒" for check in checks if check.latency_ms is not None)
    if missing:
        message += f"。接口的模型列表里没有：{'、'.join(missing)}"
    first = checks[0] if checks else None
    return EndpointTestOut(
        ok=not failed,
        model=first.model if first else None,
        latency_ms=first.latency_ms if first else None,
        message=message,
        available=available,
        models_error=models_error,
        checks=checks,
    )


# —— 联邦任务 ——


@admin.post("/tasks/validate", response_model=ValidateOut, tags=["tasks"])
def validate_task(body: TaskConfigIn, platform: PlatformDep, session: SessionDep) -> ValidateOut:
    issues, prepared = tasks.validate(platform, session, body)
    estimate = tasks.estimate(platform, body, prepared) if prepared is not None and prepared.sites else None
    return ValidateOut(issues=issues, estimate=estimate)


@admin.post("/tasks/estimate", response_model=EstimateOut, tags=["tasks"])
def estimate_task(body: TaskConfigIn, platform: PlatformDep, session: SessionDep) -> EstimateOut:
    _, prepared = tasks.validate(platform, session, body)
    if prepared is None or not prepared.sites:
        raise HTTPException(422, "选好算法和参与方之后才能预估")
    return tasks.estimate(platform, body, prepared)


@admin.post("/tasks", response_model=TaskOut, status_code=201, tags=["tasks"])
def create_task(body: TaskConfigIn, platform: PlatformDep, session: SessionDep) -> TaskOut:
    task = tasks.create(platform, session, body)
    session.flush()
    return tasks.task_out(platform, session, task)


@admin.get("/tasks", response_model=list[TaskOut], tags=["tasks"])
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


@admin.get("/tasks/{task_id}", response_model=TaskOut, tags=["tasks"])
def get_task(task_id: str, platform: PlatformDep, session: SessionDep) -> TaskOut:
    return tasks.task_out(platform, session, tasks.get_task(session, task_id))


@admin.delete("/tasks/{task_id}", status_code=204, tags=["tasks"])
def delete_task(task_id: str, background: BackgroundTasks, platform: PlatformDep, session: SessionDep) -> Response:
    tasks.delete_task(session, task_id)
    background.add_task(tasks.remove_run_directory, platform, task_id)
    return Response(status_code=204)


@admin.post("/tasks/{task_id}/{action}", response_model=TaskOut, tags=["tasks"])
def control_task(task_id: str, action: str, platform: PlatformDep, session: SessionDep) -> TaskOut:
    if action not in ("pause", "resume", "cancel"):
        raise HTTPException(404, "未知操作")
    task = tasks.control(session, task_id, action)
    session.flush()
    return tasks.task_out(platform, session, task)


@admin.get("/tasks/{task_id}/messages", response_model=list[MessageOut], tags=["tasks"])
def task_messages(
    task_id: str,
    platform: PlatformDep,
    session: SessionDep,
    round: int | None = None,
    site: str | None = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
) -> list[MessageOut]:
    return tasks.messages_out(platform, session, tasks.get_task(session, task_id), round=round, site=site, limit=limit)


@admin.get("/tasks/{task_id}/events", response_model=list[EventOut], tags=["tasks"])
def task_events(task_id: str, session: SessionDep) -> list[EventOut]:
    tasks.get_task(session, task_id)
    rows = session.scalars(select(m.Event).where(m.Event.task_id == task_id).order_by(m.Event.id))
    return [EventOut(id=row.id, kind=row.kind, message=row.message, created_at=row.created_at) for row in rows]


# —— 应用 ——


@admin.get("/apps", response_model=list[AppOut], tags=["apps"])
def list_apps(platform: PlatformDep, session: SessionDep) -> list[AppOut]:
    rows = session.scalars(select(m.App).order_by(m.App.published_at.desc()))
    return [apps.app_out(platform, row) for row in rows]


@admin.post("/apps", response_model=AppOut, status_code=201, tags=["apps"])
def publish_app(body: AppIn, platform: PlatformDep, session: SessionDep) -> AppOut:
    app = apps.publish(platform, session, body)
    session.flush()
    return apps.app_out(platform, app)


@admin.get("/apps/{app_id}", response_model=AppOut, tags=["apps"])
def get_app(app_id: str, platform: PlatformDep, session: SessionDep) -> AppOut:
    return apps.app_out(platform, apps.get_app(session, app_id))


@admin.patch("/apps/{app_id}", response_model=AppOut, tags=["apps"])
def rename_app(app_id: str, body: AppPatch, platform: PlatformDep, session: SessionDep) -> AppOut:
    app = apps.get_app(session, app_id)
    app.name = body.name.strip()
    return apps.app_out(platform, app)


@admin.delete("/apps/{app_id}", status_code=204, tags=["apps"])
def withdraw_app(app_id: str, session: SessionDep) -> Response:
    session.delete(apps.get_app(session, app_id))
    return Response(status_code=204)


@admin.post("/apps/{app_id}/apply", response_model=ApplyOut, tags=["apps"])
def apply_app(app_id: str, body: ApplyIn, platform: PlatformDep, session: SessionDep) -> ApplyOut:
    app = apps.get_app(session, app_id)
    session.expunge(app)
    return apps.apply(platform, app, body)


@admin.get("/apps/{app_id}/export", tags=["apps"])
def export_app(app_id: str, platform: PlatformDep, session: SessionDep) -> Response:
    filename, media_type, body = apps.export(platform, apps.get_app(session, app_id))
    return Response(content=body, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# —— 参与方客户端 ——


def client_auth(session: SessionDep, authorization: Annotated[str | None, Header()] = None) -> tuple[m.ClientToken, m.Participant]:
    return clients.authenticate(session, (authorization or "").removeprefix("Bearer ").strip())


ClientDep = Annotated[tuple[m.ClientToken, m.Participant], Depends(client_auth)]
AttemptDep = Annotated[int, Header(alias="X-Fedagent-Attempt", ge=1)]


@client.post("/hello", response_model=ClientHelloOut)
def client_hello(body: ClientHelloIn, auth: ClientDep, session: SessionDep) -> ClientHelloOut:
    _, participant = auth
    updated = clients.hello(session, participant, body)
    return ClientHelloOut(participant_id=participant.id, participant=participant.name, datasets=updated)


@client.post("/units/claim", response_model=list[ClientUnitOut])
def client_claim(body: ClaimIn, auth: ClientDep, platform: PlatformDep, session: SessionDep) -> list[ClientUnitOut]:
    token, participant = auth
    return clients.claim(platform, session, token, participant, body.limit)


@client.get("/units/{unit_id}/inputs", response_model=UnitInputsOut)
def client_inputs(unit_id: int, attempt: AttemptDep, auth: ClientDep, platform: PlatformDep, session: SessionDep) -> UnitInputsOut:
    return clients.inputs(platform, session, auth[0], auth[1], unit_id, attempt)


@client.post("/units/{unit_id}/heartbeat", status_code=204)
def client_heartbeat(unit_id: int, attempt: AttemptDep, auth: ClientDep, platform: PlatformDep, session: SessionDep) -> Response:
    clients.heartbeat(platform, session, auth[0], auth[1], unit_id, attempt)
    return Response(status_code=204)


@client.post("/units/{unit_id}/complete", status_code=204)
def client_complete(unit_id: int, body: CompleteIn, attempt: AttemptDep, auth: ClientDep, platform: PlatformDep, session: SessionDep) -> Response:
    clients.complete(platform, session, auth[0], auth[1], unit_id, attempt, body)
    return Response(status_code=204)


@client.post("/units/{unit_id}/fail", status_code=204)
def client_fail(unit_id: int, body: FailIn, attempt: AttemptDep, auth: ClientDep, platform: PlatformDep, session: SessionDep) -> Response:
    clients.fail(platform, session, auth[0], auth[1], unit_id, attempt, body)
    return Response(status_code=204)


# —— 组装 ——


class FrontendFiles(StaticFiles):
    """前端构建产物：带哈希的 assets/ 长期缓存；index.html 每次都向服务端确认，部署新版本后马上生效。"""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
        return response


def create_app(platform: Platform) -> FastAPI:
    app = FastAPI(title="FedAgent Studio API", version=__version__)
    app.state.platform = platform
    # 经 Tailscale 中继访问时带宽有限：页面脚本和较大的 JSON 压缩后再发
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    @app.middleware("http")
    async def _api_cache(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/v1/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    app.include_router(public)
    app.include_router(admin)
    app.include_router(client)

    @app.exception_handler(ModelError)
    async def _model_error(_request: Request, error: ModelError) -> JSONResponse:
        return JSONResponse(status_code=502, content={"detail": f"模型调用失败：{error}"})

    packages = platform.settings.client_dist
    if packages is not None and packages.is_dir():
        # 安装包里只有代码，不需要令牌；要挂在前端之前，否则会被 "/" 接走
        app.mount("/client", StaticFiles(directory=packages), name="client")
    dist = platform.settings.frontend_dist
    if dist is not None and dist.exists():
        app.mount("/", FrontendFiles(directory=dist, html=True), name="frontend")
    return app
