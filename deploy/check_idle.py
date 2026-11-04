#!/usr/bin/env python3
"""部署前只读检查：有执行中任务或资源连接检查时拒绝停止服务。"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path


def assert_idle(root: Path) -> None:
    database = root / 'data' / 'fedagent.db'
    if not database.is_file():
        return
    with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True, timeout=5) as connection:
        for table in ('tasks', 'task_checks'):
            rows = connection.execute(f"SELECT id FROM {table} WHERE status IN ('queued', 'running')").fetchall()
            if rows:
                raise RuntimeError(f'请等待执行结束再部署：{table}，{len(rows)} 项进行中')


if __name__ == '__main__':
    assert_idle(Path(sys.argv[1]))
