#!/usr/bin/env python3
"""停止服务后备份完整 data/；SQLite backup API 生成独立数据库，备份不会覆盖旧版本。"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path


def backup(root: Path) -> Path | None:
    data = root / 'data'
    db = data / 'fedagent.db'
    if not db.is_file():
        return None
    for name in ('api', 'runner', 'medical-a', 'medical-b'):
        pidfile = root / 'run' / f'{name}.pid'
        if pidfile.exists():
            try:
                os.kill(int(pidfile.read_text().strip()), 0)
            except ProcessLookupError:
                pass
            else:
                raise RuntimeError('请先停止 API、runner 和医疗 Agent，再备份完整数据目录')
    backups = root / 'backups'
    backups.mkdir(mode=0o700, exist_ok=True)
    os.chmod(backups, 0o700)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    temporary = backups / f'.{stamp}.partial'
    destination = backups / stamp
    temporary.mkdir(mode=0o700)
    try:
        shutil.copytree(data, temporary / 'data', ignore=lambda directory, names:
                        [name for name in names if name in ('fedagent.db', 'fedagent.db-wal', 'fedagent.db-shm')]
                        if Path(directory) == data else [])
        with closing(sqlite3.connect(f'file:{db}?mode=ro', uri=True)) as source, closing(sqlite3.connect(temporary / 'data' / 'fedagent.db')) as target:
            source.backup(target)
            target.execute('PRAGMA journal_mode=DELETE')
            if target.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                raise RuntimeError('备份数据库完整性检查失败')
        manifest = {'createdAt': stamp, 'source': str(data), 'schema': None}
        with closing(sqlite3.connect(f'file:{temporary}/data/fedagent.db?mode=ro', uri=True)) as connection:
            manifest['schema'] = connection.execute('select version_num from alembic_version').fetchone()[0]
        (temporary / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.rename(destination)
        return destination
    except BaseException:
        shutil.rmtree(temporary)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    result = backup(parser.parse_args().root.resolve())
    print(f'backup: {result}' if result else 'backup: no existing database')
