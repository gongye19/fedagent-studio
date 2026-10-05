"""平台配置：都可以用环境变量覆盖（前缀 FEDAGENT_），例如 FEDAGENT_DATA_DIR、FEDAGENT_ADMIN_TOKEN。"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FEDAGENT_", extra="ignore")

    data_dir: Path = Path(".data")
    """数据目录：数据库、数据集、运行目录、密钥都在这里，和代码分开放。"""
    database_url: str | None = None
    """默认是数据目录里的 SQLite；换 PostgreSQL 只改这里。"""
    host: str = "127.0.0.1"
    port: int = 8000
    admin_token: str | None = None
    """设置后，界面和 API 都要带这个令牌（参与方客户端用自己的令牌）。"""
    secret_key: str | None = None
    """加密模型密钥用的 Fernet 密钥；不设置时在数据目录里生成 secret.key。"""
    fake_endpoint: bool = False
    """测试用假模型接口（不调用真实模型）：本地开发（fedagent dev）和自动测试时开启；部署的平台不开，只有真实接口。"""
    frontend_dist: Path | None = None
    """前端构建产物目录；设置后由 API 进程一起提供。"""
    client_dist: Path | None = None
    """参与方客户端和插件的安装包（*.whl）目录；设置后在 /client/ 下提供，界面上的连接命令从这里安装。"""
    max_running_tasks: int = 1
    client_lease_seconds: int = 600
    client_offline_seconds: int = 120
    """本地参与方超过这么久没有心跳就算离线。"""
    task_restart_limit: int = 3

    @property
    def db_url(self) -> str:
        return self.database_url or f"sqlite:///{(self.data_dir / 'fedagent.db').resolve()}"

    @property
    def runs_dir(self) -> Path:
        return self.data_dir / "runs"

    @property
    def datasets_dir(self) -> Path:
        return self.data_dir / "datasets"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return settings
