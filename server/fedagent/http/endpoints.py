from __future__ import annotations

from fastapi import HTTPException, Response
from fedagent_sdk import ModelError
from sqlalchemy import select

from .. import models as m
from .. import resources
from ..resource_services.endpoint_checks import check_endpoint
from ..schemas import EndpointIn, EndpointModelsOut, EndpointOut, EndpointTestOut, ModelListIn
from .dependencies import PlatformDep, SessionDep, admin_router

router = admin_router()


@router.get("/endpoints", response_model=list[EndpointOut], tags=["endpoints"])
def list_endpoints(session: SessionDep) -> list[EndpointOut]:
    rows = session.scalars(select(m.Endpoint).order_by(m.Endpoint.builtin.desc(), m.Endpoint.created_at))
    return [resources.endpoint_out(row) for row in rows]


@router.post("/endpoints", response_model=EndpointOut, status_code=201, tags=["endpoints"])
def create_endpoint(body: EndpointIn, platform: PlatformDep, session: SessionDep) -> EndpointOut:
    return resources.endpoint_out(resources.save_endpoint(platform, session, body))


@router.put("/endpoints/{endpoint_id}", response_model=EndpointOut, tags=["endpoints"])
def update_endpoint(endpoint_id: str, body: EndpointIn, platform: PlatformDep, session: SessionDep) -> EndpointOut:
    return resources.endpoint_out(resources.save_endpoint(platform, session, body, endpoint_id))


@router.delete("/endpoints/{endpoint_id}", status_code=204, tags=["endpoints"])
def delete_endpoint(endpoint_id: str, session: SessionDep) -> Response:
    resources.delete_endpoint(session, endpoint_id)
    return Response(status_code=204)


@router.post("/endpoints/models", response_model=EndpointModelsOut, tags=["endpoints"])
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


@router.get("/endpoints/{endpoint_id}/models", response_model=EndpointModelsOut, tags=["endpoints"])
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


@router.post("/endpoints/{endpoint_id}/test", response_model=EndpointTestOut, tags=["endpoints"])
def test_endpoint(endpoint_id: str, platform: PlatformDep) -> EndpointTestOut:
    """检查接口：读接口的模型列表；每个登记的模型按算法实际用的生成参数各发一条很短的请求（会产生极少量费用）。"""
    return check_endpoint(platform, endpoint_id)
