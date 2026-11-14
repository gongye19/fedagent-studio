"""平台的运行环境：配置、数据库、注册表、模型网关、数据集文件、密钥，一个进程一份。"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from .crypto import SecretBox
from .data import DatasetFiles
from .db import Database
from .gateway import Gateway
from .migrate import upgrade
from .registry import Registry, get_registry
from .settings import Settings, get_settings


@dataclass
class Platform:
    settings: Settings
    db: Database
    registry: Registry
    gateway: Gateway
    files: DatasetFiles
    secrets: SecretBox

    @classmethod
    def create(
        cls,
        settings: Settings | None = None,
        *,
        registry: Registry | None = None,
        transport: httpx.BaseTransport | None = None,
        migrate: bool = True,
    ) -> Platform:
        settings = settings or get_settings()
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        settings.runs_dir.mkdir(parents=True, exist_ok=True)
        settings.datasets_dir.mkdir(parents=True, exist_ok=True)
        db = Database(settings.db_url)
        if migrate:
            upgrade(db)
        secrets = SecretBox.from_settings(settings.data_dir, settings.secret_key)
        return cls(
            settings=settings,
            db=db,
            registry=registry or get_registry(),
            gateway=Gateway(db, secrets, transport=transport, allowed_hosts=tuple(settings.llm_allowed_hosts)),
            files=DatasetFiles(settings.datasets_dir),
            secrets=secrets,
        )
