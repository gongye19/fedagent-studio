#!/usr/bin/env python3
"""部署前只读检查：有执行中任务或资源连接检查时拒绝停止服务。"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path


def assert_idle(root: Path, candidate_hashes: dict[str, str] | None = None) -> None:
    database = root / 'data' / 'fedagent.db'
    if not database.is_file():
        return
    with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True, timeout=5) as connection:
        for table in ('tasks', 'task_checks'):
            rows = connection.execute(f"SELECT id FROM {table} WHERE status IN ('queued', 'running')").fetchall()
            if rows:
                raise RuntimeError(f'请等待执行结束再部署：{table}，{len(rows)} 项进行中')

        if candidate_hashes is not None:
            rows = connection.execute("SELECT id, algorithm, plugin_hash, config FROM tasks WHERE status='paused'").fetchall()
            incompatible = [task for task, algorithm, code_hash, config in rows
                            if candidate_hashes.get(algorithm) != json.loads(config).get('consumer_hash', code_hash)]
            if incompatible:
                raise RuntimeError('暂停任务的算法代码与候选版本不兼容，请先处理任务或保留旧运行环境：' + ', '.join(incompatible))


if __name__ == '__main__':
    hashes = json.loads(Path(sys.argv[2]).read_text()) if len(sys.argv) > 2 else None
    assert_idle(Path(sys.argv[1]), hashes)
