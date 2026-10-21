from urllib.parse import urlsplit

from pydantic import Field, field_validator

from ..agents.protocol import Capabilities
from .base import Model
from .sharing import ResourceInfo


class AgentIn(Model):
    name: str = Field(min_length=1, max_length=80)
    base_url: str = Field(min_length=1, max_length=400)
    api_key: str | None = Field(default=None, max_length=2000)

    @field_validator("base_url")
    @classmethod
    def address(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        parts = urlsplit(value)
        if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
            raise ValueError("服务地址应为 HTTP(S) 地址，不含账号、查询参数或片段")
        return value

    @field_validator("name")
    @classmethod
    def nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("请填写接口名称")
        return value.strip()


class AgentOut(ResourceInfo):
    id: str
    name: str
    base_url: str
    resource_space: str
    has_key: bool
    capabilities: Capabilities | None
    revision: int
