from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, serialize_by_alias=True, allow_inf_nan=False)


def _utc(value: datetime) -> datetime:
    """数据库（SQLite）读回来的时间不带时区，存的是 UTC：补上时区，前端按本地时间显示才对。"""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


Time = Annotated[datetime, AfterValidator(_utc)]
