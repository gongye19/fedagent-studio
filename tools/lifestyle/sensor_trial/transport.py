"""一次登录复用多个SSH通道；不安装服务，不在传输层自动重试模型请求。"""

import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

from fedagent_sdk import ModelError

from ..model import COMMAND, CachedModel


class SSHLink:
    def __enter__(self):
        target = os.environ.get("FEDAGENT_LIFESTYLE_SSH_TARGET", "")
        port = os.environ.get("FEDAGENT_LIFESTYLE_SSH_PORT", "22")
        if not target or target.startswith("-") or not port.isdecimal() or not 1 <= int(port) <= 65535:
            raise ValueError("SSH target/port invalid")
        self.folder = tempfile.TemporaryDirectory(prefix="fa-", dir="/tmp")
        self.socket = str(Path(self.folder.name) / "s")
        self.base = [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "ServerAliveInterval=10",
            "-o",
            "ServerAliveCountMax=3",
            "-o",
            "ControlPath=" + self.socket,
            "-p",
            port,
            target,
        ]
        try:
            subprocess.run(
                self.base[:-1] + ["-M", "-N", "-f", "-o", "ControlPersist=60", target],
                stdin=subprocess.DEVNULL,
                capture_output=True,
                timeout=20,
                check=True,
            )
            self.check()
        except BaseException:
            self.__exit__(None, None, None)
            raise
        return self

    def check(self):
        subprocess.run(
            self.base[:-1] + ["-O", "check", self.base[-1]], stdin=subprocess.DEVNULL, capture_output=True, timeout=5, check=True
        )

    def request(self, request):
        self.check()
        start = time.monotonic()
        try:
            result = subprocess.run(
                self.base + [COMMAND],
                input=json.dumps(request),
                text=True,
                capture_output=True,
                timeout=15 if request.get("inspect") else 660,
                check=True,
            )
            value = json.loads(result.stdout)
        except (subprocess.SubprocessError, ValueError) as error:
            raise ModelError("SSH模型桥未完整返回；未自动重发：" + type(error).__name__) from error
        print(f"SSH bridge {'inspect' if request.get('inspect') else 'reply'}: {time.monotonic() - start:.1f}s", flush=True)
        return value

    def __exit__(self, *exc):
        try:
            subprocess.run(
                self.base[:-1] + ["-O", "exit", self.base[-1]], stdin=subprocess.DEVNULL, capture_output=True, timeout=5, check=False
            )
        except subprocess.SubprocessError:
            pass
        finally:
            self.folder.cleanup()


class ConnectedModel(CachedModel):
    def __init__(self, *args, link, **kwargs):
        self.link = link
        super().__init__(*args, **kwargs)

    def _request(self, request):
        return self.link.request(request)
