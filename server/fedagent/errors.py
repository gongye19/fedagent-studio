"""服务层错误；由 HTTP 适配器映射为响应，服务本身不依赖 Web 框架。"""

from typing import Any


class ServiceError(Exception):
    def __init__(self, status_code: int, detail: str | dict[str, Any]):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
