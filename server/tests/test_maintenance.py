import importlib.util
import os
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from fedagent_sdk import ModelError

from fedagent.crypto import SecretBox
from fedagent.platform import Platform
from fedagent.seed import seed
from fedagent.settings import Settings


def backup_module():
    path = Path(__file__).resolve().parents[2] / "deploy" / "backup.py"
    spec = importlib.util.spec_from_file_location("deploy_backup", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_backup_restores_database_files_and_matching_key(tmp_path):
    data = tmp_path / "data"
    platform = Platform.create(Settings(data_dir=data, fake_endpoint=True))
    seed(platform)
    cipher = platform.secrets.encrypt("test-only-key")
    # 保持 WAL 连接打开，验证备份 API 会包含已经提交但未 checkpoint 的数据。
    with sqlite3.connect(data / "fedagent.db") as source:
        source.execute("create table backup_probe (value text)")
        source.execute("insert into backup_probe values (?)", (cipher,))
        source.commit()
        destination = backup_module().backup(tmp_path)
        assert destination is not None
        with sqlite3.connect(destination / "data" / "fedagent.db") as restored:
            saved = restored.execute("select value from backup_probe").fetchone()[0]
            assert restored.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        secrets = SecretBox.from_settings(destination / "data", None)
        assert secrets.decrypt(saved) == "test-only-key"
        assert list((destination / "data" / "datasets").iterdir())
        assert not (destination / "data" / "fedagent.db-wal").exists()
        assert destination.parent.stat().st_mode & 0o777 == 0o700
        assert (destination / "data" / "secret.key").stat().st_mode & 0o777 == 0o600
        assert backup_module().backup(tmp_path) != destination


def test_backup_refuses_running_service(tmp_path):
    Platform.create(Settings(data_dir=tmp_path / "data"))
    (tmp_path / "run").mkdir()
    (tmp_path / "run" / "api.pid").write_text(str(os.getpid()))
    with pytest.raises(RuntimeError, match="先停止"):
        backup_module().backup(tmp_path)
    assert not (tmp_path / "backups").exists()


def test_concurrent_first_start_shares_one_secret_key(tmp_path, monkeypatch):
    barrier = threading.Barrier(8)
    generate = Fernet.generate_key

    def new_key():
        barrier.wait(timeout=5)
        return generate()

    monkeypatch.setattr(Fernet, "generate_key", new_key)
    with ThreadPoolExecutor(max_workers=8) as executor:
        boxes = list(executor.map(lambda _: SecretBox.from_settings(tmp_path, None), range(8)))
    cipher = boxes[0].encrypt("test-only-key")
    assert all(box.decrypt(cipher) == "test-only-key" for box in boxes)
    assert [path.name for path in tmp_path.iterdir()] == ["secret.key"]


def test_wrong_key_reports_recovery_instead_of_empty_key():
    cipher = SecretBox(Fernet.generate_key()).encrypt("test-only-key")
    with pytest.raises(ModelError, match=r"secret\.key"):
        SecretBox(Fernet.generate_key()).decrypt(cipher)
