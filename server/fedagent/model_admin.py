"""仅服务器本地提供平台模型维护入口；用户 HTTP 接口不接受此权限。"""
from __future__ import annotations

import getpass

from . import models as m
from .errors import ServiceError
from .gateway import DEFAULT_ENDPOINT
from .platform import Platform
from .resource_services.endpoint_checks import check_endpoint
from .resource_services.endpoints import save_endpoint
from .schemas import EndpointIn
from .seed import seed


def configure_default(platform: Platform, name: str | None, base_url: str, model: str) -> None:
    seed(platform)
    # 密钥不接受命令行参数，不回显、不写日志；空输入保留已有密钥。
    api_key = getpass.getpass("平台模型 API 密钥（留空保留；更换地址后须重新填写）：").strip()
    with platform.db.session() as session:
        current = session.get(m.Endpoint, DEFAULT_ENDPOINT)
        if current is None:
            raise ServiceError(404, "平台默认接口缺失，请检查数据库初始化")
        body = EndpointIn(name=name or current.name, base_url=base_url, models=[model], api_key=api_key or None,
                          concurrency=current.concurrency, price=current.price,
                          timeout=current.timeout, max_retries=current.max_retries)
        save_endpoint(platform, session, body, DEFAULT_ENDPOINT, allow_platform=True)
    report = check_endpoint(platform, DEFAULT_ENDPOINT, verify_platform=True)
    if not report.ok:
        print("已保存配置，但验证失败：" + report.message)
        raise SystemExit(1)
    print("平台模型已保存并验证通过。")
