"""仅本轮放宽免费身份检查的启动等待；收费请求仍走既有桥与超时。"""

import time

from fedagent_sdk import ModelError

from ..common import digest, save
from ..diet_transport import CompletedUpstreamError, DietLink, is_overload
from .worker import WORKER_COMMAND, Worker


def retryable_internal(detail):
    events = detail.get("upstream", [])
    return (
        bool(detail.get("completedUpstreamError"))
        and bool(events)
        and all(
            isinstance(event, dict)
            and event.get("type") == "upstream_error"
            and str(event.get("message", ""))
            .lower()
            .startswith("an error occurred while processing your request.")
            and "retry your request" in str(event.get("message", "")).lower()
            for event in events
        )
    )


class GuidanceLink(DietLink):
    def __init__(self, directory):
        super().__init__(directory)
        self.inspected = {}
        self.worker = None

    def request(self, request):
        if not request.get("inspect"):
            return super().request(request)
        ref = request["ref"]
        if ref not in self.inspected:
            value = self._request_once(request)
            if (
                not isinstance(value, dict)
                or value.get("kind") == "fake"
                or not value.get("model")
            ):
                raise ModelError("免费配置检查返回无效身份")
            self.inspected[ref] = value
        # Every paid request still resolves and verifies the live identity remotely.
        return self.inspected[ref]

    def _request_once(self, request):
        self.check()
        if self.worker is None:
            self.worker = Worker(self.base + [WORKER_COMMAND])
        start = time.monotonic()
        value = self.worker.exchange(request, 60 if request.get("inspect") else 660)
        if "bridgeError" in value:
            detail = value["bridgeError"]
            save(
                self.directory / f"upstream-{digest(request)}-{time.time_ns()}.json",
                detail,
            )
            if detail.get("completedUpstreamError"):
                error = CompletedUpstreamError(
                    "已收到上游错误；用量未知，安全详情已保存"
                )
                error.overloaded = is_overload(detail)
                error.retryable = error.overloaded or retryable_internal(detail)
                if error.retryable:
                    self.next_dispatch = time.monotonic() + 45
                raise error
            raise ModelError("模型未成功返回，未重发请求")
        print(
            f"guidance bridge {'inspect' if request.get('inspect') else 'reply'}: {time.monotonic() - start:.1f}s",
            flush=True,
        )
        return value

    def __exit__(self, *exc):
        try:
            if self.worker is not None:
                self.worker.close()
        finally:
            super().__exit__(*exc)
