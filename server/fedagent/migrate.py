"""数据库迁移：Alembic。api、runner 启动时都会升级到最新版本，用文件锁避免两个进程同时迁移。"""

from __future__ import annotations

import fcntl
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config

from .db import Database

MIGRATIONS = Path(__file__).parent / "migrations"


def alembic_config(db: Database) -> Config:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    config.set_main_option("sqlalchemy.url", db.url.replace("%", "%%"))
    return config


@contextmanager
def _lock(db: Database) -> Iterator[None]:
    if not db.url.startswith("sqlite:///"):
        yield
        return
    path = Path(db.url.removeprefix("sqlite:///")).with_suffix(".migrate.lock")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def upgrade(db: Database) -> None:
    config = alembic_config(db)
    with _lock(db), db.engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")


def revision(db: Database, message: str) -> None:
    """开发用：按模型的改动生成新的迁移脚本。"""
    config = alembic_config(db)
    with db.engine.begin() as connection:
        config.attributes["connection"] = connection
        command.revision(config, message=message, autogenerate=True)
