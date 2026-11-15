"""模型接入探测共用服务；普通 HTTP 探测不改变平台模型的验证凭据。"""
from __future__ import annotations

import time

from fedagent_sdk import ModelError

from .. import models as m
from ..errors import ServiceError
from ..gateway import DEFAULT_ENDPOINT
from ..platform import Platform
from ..schemas import EndpointTestOut, ModelCheckOut
from .verification import endpoint_signature


def check_endpoint(platform: Platform, endpoint_id: str, *, verify_platform: bool = False) -> EndpointTestOut:
    """检查接口：读接口的模型列表；每个登记的模型按算法实际用的生成参数各发一条很短的请求（会产生极少量费用）。"""
    gateway = platform.gateway
    try:
        endpoint = gateway.endpoint(endpoint_id)
    except ModelError as error:
        raise ServiceError(404, str(error)) from error
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
    with platform.db.session() as session:
        row = session.get(m.Endpoint, endpoint_id)
        if row and (verify_platform or not (row.builtin or row.id == DEFAULT_ENDPOINT)):
            # 只给真正受测的配置记凭据，避免测试中编辑接口造成假通过。
            current = gateway.endpoint(endpoint_id)
            unchanged = (current.base_url, current.models, current.api_key) == (endpoint.base_url, endpoint.models, endpoint.api_key)
            row.verification_hash = endpoint_signature(row) if not failed and unchanged else None
    return EndpointTestOut(
        ok=not failed,
        model=first.model if first else None,
        latency_ms=first.latency_ms if first else None,
        message=message,
        available=available,
        models_error=models_error,
        checks=checks,
    )
