"""模型密钥的加密保存：Fernet（cryptography）。接口只能写入、不能读出。"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from fedagent_sdk import ModelError


class SecretBox:
    def __init__(self, key: bytes) -> None:
        self._fernet = Fernet(key)

    @classmethod
    def from_settings(cls, data_dir: Path, configured: str | None) -> SecretBox:
        if configured:
            return cls(configured.encode())
        path = data_dir / "secret.key"
        if not path.exists():
            # API 和 runner 同时首次启动时只能有一个密钥；链接前临时文件已写完。
            with tempfile.NamedTemporaryFile(dir=data_dir, delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(Fernet.generate_key())
            try:
                os.link(temporary, path)
            except FileExistsError:
                pass
            finally:
                temporary.unlink()
        return cls(path.read_bytes().strip())

    def encrypt(self, value: str) -> str:
        return self._fernet.encrypt(value.encode()).decode()

    def decrypt(self, value: str | None) -> str | None:
        if not value:
            return None
        try:
            return self._fernet.decrypt(value.encode()).decode()
        except InvalidToken as error:
            raise ModelError("无法解密已保存的模型密钥，请恢复匹配的 secret.key 或重新配置接口密钥") from error
