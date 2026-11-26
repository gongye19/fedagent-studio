"""仅本轮放宽免费身份检查的启动等待；收费请求仍走既有桥与超时。"""

import json
import subprocess

from fedagent_sdk import ModelError

from ..diet_transport import COMMAND, DietLink


class GuidanceLink(DietLink):
    def __init__(self, directory):
        super().__init__(directory)
        self.inspected = {}

    def request(self, request):
        if not request.get("inspect"):
            return super().request(request)
        ref = request["ref"]
        if ref not in self.inspected:
            self.check()
            try:
                response = subprocess.run(
                    self.base + [COMMAND],
                    input=json.dumps(request),
                    text=True,
                    capture_output=True,
                    timeout=60,
                    check=True,
                )
                value = json.loads(response.stdout)
            except (subprocess.SubprocessError, ValueError) as error:
                raise ModelError(
                    "免费配置检查未完整返回：" + type(error).__name__
                ) from None
            if (
                not isinstance(value, dict)
                or value.get("kind") == "fake"
                or not value.get("model")
            ):
                raise ModelError("免费配置检查返回无效身份")
            self.inspected[ref] = value
        # Every paid request still resolves and verifies the live identity remotely.
        return self.inspected[ref]
