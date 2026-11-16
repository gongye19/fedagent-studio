"""实验文件与内容指纹；所有产物留在调用者指定的本机目录。"""

from __future__ import annotations

import atexit
import fcntl
import hashlib
import json
from pathlib import Path


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def load(path: Path):
    return json.loads(path.read_text())


def save(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def rows(path: Path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def jsonl(path: Path, values) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(value, ensure_ascii=False) + "\n" for value in values))


def hold_experiment_lock(directory: Path) -> None:
    """主线程异常也持锁到解释器退出，等待仍在收尾的模型线程结束后才释放。"""
    handle = (directory / ".lock").open("a")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BaseException:
        handle.close()
        raise
    atexit.register(handle.close)
