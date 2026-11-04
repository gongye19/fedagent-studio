"""部署门禁必须在停止服务、上传或覆盖运行文件之前拒绝不安全的状态。"""
import importlib.util
import os
import shutil
import sqlite3
import subprocess
from pathlib import Path

import pytest

DEPLOY = Path(__file__).resolve().parents[2] / "deploy"


def guard():
    spec = importlib.util.spec_from_file_location("deployment_guard", DEPLOY / "check_idle.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.assert_idle


@pytest.mark.parametrize("table", ["tasks", "task_checks"])
@pytest.mark.parametrize("status", ["running", "queued"])
def test_active_work_blocks_deployment_without_writing_database(tmp_path, table, status):
    data = tmp_path / "data"
    data.mkdir()
    path = data / "fedagent.db"
    with sqlite3.connect(path) as db:
        for name in ("tasks", "task_checks"):
            db.execute(f"CREATE TABLE {name}(id TEXT, status TEXT)")
        db.execute(f"INSERT INTO {table} VALUES('active', ?)", (status,))
    before = path.read_bytes()
    with pytest.raises(RuntimeError, match=table):
        guard()(tmp_path)
    assert path.read_bytes() == before


def test_paused_tasks_are_preserved_and_do_not_block_deployment(tmp_path):
    (tmp_path / "data").mkdir()
    path = tmp_path / "data/fedagent.db"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE tasks(id TEXT, status TEXT)")
        db.execute("CREATE TABLE task_checks(id TEXT, status TEXT)")
        db.execute("INSERT INTO tasks VALUES('old', 'paused')")
    before = path.read_bytes()
    guard()(tmp_path)
    assert path.read_bytes() == before


def git(root, *args):
    return subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True, text=True).stdout.strip()


def init_repo(path):
    path.mkdir()
    git(path, "init", "-b", "main")
    git(path, "config", "user.email", "deployment-test@localhost")
    git(path, "config", "user.name", "Deployment test")
    return path


def test_uncommitted_changes_block_push_and_remote_deploy(tmp_path):
    root = init_repo(tmp_path / "repo")
    shutil.copytree(DEPLOY, root / "deploy", ignore=shutil.ignore_patterns("__pycache__"))
    git(root, "add", ".")
    git(root, "commit", "-m", "initial")
    (root / "uncommitted.txt").write_text("unfinished")
    result = subprocess.run(["bash", str(root / "deploy/deploy.sh")], capture_output=True, text=True)
    assert result.returncode != 0
    assert "请先提交改动" in result.stderr
    assert not git(root, "remote")


def test_server_build_failure_keeps_live_runtime_untouched(tmp_path):
    source = init_repo(tmp_path / "source")
    shutil.copytree(DEPLOY, source / "deploy", ignore=shutil.ignore_patterns("__pycache__"))
    (source / "app").mkdir()
    (source / "app/package.json").write_text("{}")
    git(source, "add", ".")
    git(source, "commit", "-m", "initial")
    revision = git(source, "rev-parse", "HEAD")
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    git(tmp_path, "clone", "--bare", str(source), str(runtime / "repository.git"))
    (runtime / "serve.sh").write_text("exit 99\n")
    (runtime / "bin").mkdir()
    (runtime / "bin/uv").touch()
    (runtime / "bin/uv").chmod(0o755)
    commands = tmp_path / "commands"
    commands.mkdir()
    for name, body in {"flock": "exit 0", "node": "exit 0", "npm": "exit 42"}.items():
        path = commands / name
        path.write_text("#!/bin/sh\n" + body + "\n")
        path.chmod(0o755)
    environment = {**os.environ, "FEDAGENT_DEPLOY_ROOT": str(runtime), "PATH": f"{commands}:{os.environ['PATH']}"}
    before = (runtime / "serve.sh").read_bytes()
    result = subprocess.run(["bash", str(DEPLOY / "update.sh"), revision], env=environment, capture_output=True, text=True)
    assert result.returncode == 42, result.stderr
    assert (runtime / "serve.sh").read_bytes() == before
    assert not (runtime / "backups").exists()
    assert not (runtime / "run/deployed-revision").exists()
