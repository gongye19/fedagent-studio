"""模型密钥的加密保存：Fernet（cryptography）。接口只能写入、不能读出。"""

from __future__ import annotations

import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


class SecretBox:
    def __init__(self, key: bytes) -> None:
        self._fernet = Fernet(key)

    @classmethod
    def from_settings(cls, data_dir: Path, configured: str | None) -> SecretBox:
        if configured:
            return cls(configured.encode())
        path = data_dir / "secret.key"
        if not path.exists():
            path.write_bytes(Fernet.generate_key())
            os.chmod(path, 0o600)
        return cls(path.read_bytes().strip())

    def encrypt(self, value: str) -> str:
        return self._fernet.encrypt(value.encode()).decode()

    def decrypt(self, value: str | None) -> str | None:
        if not value:
            return None
        try:
            return self._fernet.decrypt(value.encode()).decode()
        except InvalidToken:
            return None
