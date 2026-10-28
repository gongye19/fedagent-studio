"""所有 SQLite 库均为独立快照；不能只依赖原文件旁的 WAL 才读到已提交数据。"""
import importlib.util
import sqlite3
from contextlib import ExitStack, closing
from pathlib import Path


def test_nested_wal_databases_are_standalone_and_keys_preserved(tmp_path):
    spec = importlib.util.spec_from_file_location("fedagent_backup_test", Path(__file__).resolve().parents[2] / "deploy/backup.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    data = tmp_path / "data"
    paths = [data / "fedagent.db", data / "medical-agents/a/runs.sqlite", data / "medical-agents/b/agent.sqlite"]
    with ExitStack() as stack:
        for path in paths:
            path.parent.mkdir(parents=True, exist_ok=True)
            db = stack.enter_context(closing(sqlite3.connect(path)))
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE records(value TEXT)")
            db.execute("INSERT INTO records VALUES('committed-in-wal')")
            if path.name == "fedagent.db":
                db.execute("CREATE TABLE alembic_version(version_num TEXT)")
                db.execute("INSERT INTO alembic_version VALUES('0008')")
            db.commit()
        (data / "secret.key").write_text("local-test-key-not-a-real-secret")
        snapshot = module.backup(tmp_path) / "data"
        assert not list(snapshot.rglob('*-wal')) and not list(snapshot.rglob('*-shm'))
        assert (snapshot / "secret.key").read_bytes() == (data / "secret.key").read_bytes()
        for source in paths:
            with closing(sqlite3.connect(f"file:{snapshot / source.relative_to(data)}?mode=ro&immutable=1", uri=True)) as db:
                assert db.execute("SELECT value FROM records").fetchall() == [('committed-in-wal',)]
                assert db.execute("PRAGMA integrity_check").fetchone() == ('ok',)
