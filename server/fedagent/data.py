"""数据集：读文件、检查、保存、按任务取样本。

文件格式由数据格式适配器读成一行行（现在是 JSONL）；检查规则由任务类型决定（和前端上传检查同一套）。
内容登记后不可改：文件按内容哈希保存，重新上传就是新版本，任务冻结时记下哈希。
标注字段只给判分用：交给算法步骤的样本默认去掉标注。
"""

from __future__ import annotations

import hashlib
import json
import threading
from pathlib import Path
from typing import Any

from fedagent_sdk import CheckReport, Item, Row, TaskType

MAX_FILE_BYTES = 20 * 1024 * 1024


def _reject_constant(value: str) -> None:
    raise ValueError(f"JSON 不支持 {value}")


def parse_jsonl(text: str) -> list[Row]:
    rows: list[Row] = []
    for index, raw in enumerate(text.splitlines(), start=1):
        if not raw.strip():
            continue
        try:
            value = json.loads(raw, parse_constant=_reject_constant)
        except (ValueError, RecursionError):
            rows.append(Row(index, None, "不是合法的 JSON，检查引号和逗号"))
            continue
        if not isinstance(value, dict):
            rows.append(Row(index, None, "每行应是一个 JSON 对象"))
            continue
        rows.append(Row(index, value))
    return rows


def check_file(task_type: TaskType, raw: bytes) -> CheckReport:
    report = CheckReport()
    if len(raw) > MAX_FILE_BYTES:
        report.add(0, "文件超过 20 MB")
        return report
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        report.add(0, "文件不是 UTF-8 编码的文本")
        return report
    return task_type.check(parse_jsonl(text))


class DatasetFiles:
    """平台托管数据集的文件。按内容哈希保存，读入后在进程内缓存。"""

    def __init__(self, root: Path) -> None:
        self.root = root
        self._cache: dict[str, tuple[int, int, list[dict[str, Any]]]] = {}
        self._lock = threading.Lock()

    def save(self, dataset_id: str, items: list[dict[str, Any]]) -> tuple[str, str]:
        """保存检查通过的样本（规范化后的 JSONL），返回（相对路径、内容哈希）。"""
        body = "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in items).encode()
        digest = hashlib.sha256(body).hexdigest()
        path = self.root / dataset_id / f"{digest}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.write_bytes(body)
        return str(path.relative_to(self.root)), digest

    def load(self, relative: str) -> list[dict[str, Any]]:
        path = (self.root / relative).resolve()
        if not path.is_relative_to(self.root.resolve()) or not path.is_file():
            raise ValueError("数据文件不存在或超出数据目录")
        stamp = path.stat()
        with self._lock:
            cached = self._cache.get(relative)
        if cached is not None and cached[:2] == (stamp.st_mtime_ns, stamp.st_size):
            return cached[2]
        raw = path.read_bytes()
        if len(path.stem) == 64 and hashlib.sha256(raw).hexdigest() != path.stem:
            raise ValueError("数据文件的内容哈希不匹配")
        text = raw.decode("utf-8")
        items = [json.loads(line) for line in text.splitlines() if line.strip()]
        with self._lock:
            if len(self._cache) >= 16:
                self._cache.pop(next(iter(self._cache)))
            self._cache[relative] = (stamp.st_mtime_ns, stamp.st_size, items)
        return items


def select_items(ids: list[str], cap: int | None) -> list[str]:
    """试跑时每份数据集按固定顺序取前 cap 条。"""
    return ids[:cap] if cap else list(ids)


def to_item(task_type: TaskType, record: dict[str, Any], *, labels: bool) -> Item:
    fields = dict(record) if labels else task_type.strip_labels(record)
    return Item(id=task_type.item_id(record), fields=fields)
