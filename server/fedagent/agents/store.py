"""用户侧 Agent 的独立存储；按任务、来源和轮次隔离，不自动跨任务复用经验。"""
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from fedagent_sdk import Artifact

from .protocol import AgentRequest, AgentResult, SavedValue


class AgentStore:
    def __init__(self, root: Path):
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = root / "agent.sqlite"
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS private_state(task TEXT, site TEXT, round INTEGER, step TEXT, unit TEXT, output TEXT, "
                       "PRIMARY KEY(task,site,round,step,unit))")
            db.execute("CREATE TABLE IF NOT EXISTS memories(task TEXT, site TEXT, version INTEGER, round INTEGER, content TEXT, PRIMARY KEY(task,site))")
        self.path.chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        try:
            db.execute("PRAGMA journal_mode=WAL")
            with db:
                yield db
        finally:
            db.close()

    def record(self, request: AgentRequest, result: AgentResult):
        # 接入验证临时保留本方状态供后续对照步骤读取，验证结束后清理。
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO private_state VALUES(?,?,?,?,?,?)", (
                request.task_id, request.site_id, request.round, request.step, request.unit_key, result.model_dump_json()))
        if not request.task_id.startswith("check-") and request.artifact and request.artifact.kind == "clinical-memory":
            self.save_memory(request.task_id, request.site_id, request.artifact)

    def save_memory(self, task: str, site: str, artifact: Artifact):
        if artifact.kind != "clinical-memory" or artifact.version < 1 or artifact.round < 1:
            raise ValueError("需要有效的医疗经验库版本")
        with self.connect() as db:
            old = db.execute("SELECT version,content,round FROM memories WHERE task=? AND site=?", (task, site)).fetchone()
            content = json.dumps(artifact.content, ensure_ascii=False, sort_keys=True)
            if old and (old[0] > artifact.version or (old[0] == artifact.version and (old[1] != content or old[2] != artifact.round))):
                raise ValueError("不能覆盖已有经验版本或回退到旧版本")
            db.execute("INSERT OR REPLACE INTO memories VALUES(?,?,?,?,?)", (task, site, artifact.version, artifact.round, content))

    def memory(self, task: str, site: str) -> Artifact | None:
        with self.connect() as db:
            row = db.execute("SELECT version,round,content FROM memories WHERE task=? AND site=?", (task, site)).fetchone()
        return Artifact(row[0], row[1], "clinical-memory", json.loads(row[2])) if row else None

    def state(self, request: AgentRequest) -> list[SavedValue]:
        """只恢复同任务、同站点、已完成步骤的私有值；服务重启后也可继续。"""
        values = {(entry.round, entry.key, entry.item_id): entry for entry in request.state}
        with self.connect() as db:
            rows = db.execute("SELECT round,output FROM private_state WHERE task=? AND site=? AND round<=? ORDER BY round,rowid",
                              (request.task_id, request.site_id, request.round)).fetchall()
        for round, raw in rows:
            for key, item_id, value in AgentResult.model_validate_json(raw).kept:
                if request.unit_key != "_" and item_id not in (None, request.unit_key):
                    continue
                values[(round, key, item_id)] = SavedValue(round=round, key=key, item_id=item_id, value=value)
        return list(values.values())

    def clear_check(self, task: str):
        if not task.startswith("check-"):
            raise ValueError("只能清理验证任务的临时状态")
        with self.connect() as db:
            db.execute("DELETE FROM private_state WHERE task=?", (task,))
            db.execute("DELETE FROM memories WHERE task=?", (task,))
