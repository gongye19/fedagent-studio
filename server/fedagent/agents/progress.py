"""接入方公开过程事件的持久化；与私有轨迹和最终结果分别存储。"""
import sqlite3
from contextlib import closing
from pathlib import Path

from fedagent_sdk import ProgressEvent, ProgressUpdate

from .protocol import ProgressPage


class ProgressStore:
    def __init__(self, path: Path):
        self.path = path
        with closing(sqlite3.connect(path, timeout=30)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS progress(run TEXT, seq INTEGER, event TEXT NOT NULL, PRIMARY KEY(run,seq))")

    def append(self, run: str, event: ProgressUpdate) -> None:
        with closing(sqlite3.connect(self.path, timeout=30)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            seq = db.execute("SELECT COALESCE(MAX(seq),0)+1 FROM progress WHERE run=?", (run,)).fetchone()[0]
            value = ProgressEvent(**event.model_dump(), seq=seq)
            db.execute("INSERT INTO progress VALUES(?,?,?)", (run, seq, value.model_dump_json()))

    def page(self, run: str, after: int) -> ProgressPage:
        with closing(sqlite3.connect(self.path, timeout=30)) as db, db:
            rows = db.execute("SELECT event FROM progress WHERE run=? AND seq>? ORDER BY seq LIMIT 101", (run, after)).fetchall()
        return ProgressPage(events=[ProgressEvent.model_validate_json(row[0]) for row in rows[:100]], has_more=len(rows) > 100)
