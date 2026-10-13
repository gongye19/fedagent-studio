"""客户端的工作循环：连接 → 领取本方的工作单元 → 取输入 → 在本地执行插件的这一步 → （可选）逐条审查 → 只提交消息、上报值和判分汇总。"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from importlib.metadata import entry_points
from pathlib import Path
from typing import Any

import httpx
from fedagent_sdk import Algorithm, Artifact, Grader, Message, Model, Row, SiteInfo, StepContext, StepFailed, TaskType

from . import __version__
from .local import CachedUnitModel, ClientStepIO, FakeModel, LocalModel, LocalState, load_jsonl

log = logging.getLogger("fedagent_client")
Review = Callable[[str, Any], bool]


def _plugins(group: str) -> dict[str, Any]:
    return {entry.name: entry.load() for entry in entry_points(group=group)}


@dataclass
class ClientConfig:
    server: str
    token: str
    datasets: dict[str, Path]
    """数据集 id → 本地 JSONL 文件。"""
    state_path: Path
    model_base_url: str | None = None
    model: str | None = None
    api_key: str | None = None
    fake_model: bool = False
    review: Review | None = None
    poll: float = 3.0


@dataclass
class Worker:
    config: ClientConfig
    transport: httpx.BaseTransport | None = None
    algorithms: dict[str, Algorithm] = field(default_factory=dict)
    task_types: dict[str, TaskType] = field(default_factory=dict)
    graders: dict[str, Grader] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.http = httpx.Client(
            base_url=self.config.server.rstrip("/"),
            headers={"Authorization": f"Bearer {self.config.token}"},
            timeout=60.0,
            transport=self.transport,
        )
        self.algorithms = {name: cls() for name, cls in _plugins("fedagent.algorithms").items()}
        self.task_types = {name: cls() for name, cls in _plugins("fedagent.task_types").items()}
        self.graders = {name: cls() for name, cls in _plugins("fedagent.graders").items()}
        self.state = LocalState(self.config.state_path)
        self.records: dict[str, dict[str, dict[str, Any]]] = {}

    def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        response = self.http.request(method, url, **kwargs)
        if response.status_code >= 400:
            raise RuntimeError(f"{method} {url} → {response.status_code}：{response.text[:300]}")
        return response

    def hello(self) -> dict[str, Any]:
        """连上平台，上报本地数据集的描述（样本数、带标注数、样本 id），不上传内容。"""
        reported = []
        plugins = {name: plugin.version for name, plugin in self.algorithms.items()}
        metadata = self._request("POST", "/v1/client/hello", json={"clientVersion": __version__, "plugins": plugins}).json()
        for dataset_id, path in self.config.datasets.items():
            type_id = metadata.get("taskTypes", {}).get(dataset_id)
            if type_id not in self.task_types:
                raise RuntimeError(f"数据集 {dataset_id} 对应的任务类型未安装，请安装支持该任务的插件")
            task_type = self.task_types[type_id]
            if task_type.schema_version != metadata.get("schemaVersions", {}).get(dataset_id, "1.0"):
                raise RuntimeError(f"数据集 {dataset_id} 的规范版本不兼容，请升级对应插件或重新登记")
            report = task_type.check([Row(index, row) for index, row in enumerate(load_jsonl(path), start=1)])
            if not report.ok:
                problem = report.issues[0]
                raise RuntimeError(f"本地文件 {path.name} 第 {problem.line} 行：{problem.message}")
            rows = report.items
            records = {str(row["id"]): row for row in rows}
            self.records[dataset_id] = records
            answered = sum(1 for row in rows if task_type.is_labeled(row))
            reported.append({"datasetId": dataset_id, "count": len(rows), "answered": answered, "itemIds": list(records)})
        return self._request("POST", "/v1/client/hello", json={"clientVersion": __version__, "plugins": plugins, "datasets": reported}).json()

    def _model(self, plugin: Algorithm, step_id: str) -> Model:
        if self.config.fake_model:
            return FakeModel(plugin, step_id)
        if not self.config.model_base_url or not self.config.model:
            raise RuntimeError("没有配置本地模型（--model-base-url、--model）")
        return LocalModel(self.config.model_base_url, self.config.model, self.config.api_key)

    @contextmanager
    def _lease(self, unit: dict[str, Any]):
        """慢模型调用和人工审查期间续租，工作单元一次只领取一个，避免排队时过期。"""
        stop = threading.Event()
        remaining = (datetime.fromisoformat(unit["leaseUntil"]) - datetime.now().astimezone()).total_seconds()
        interval = max(0.05, min(30.0, remaining / 3))

        def heartbeat() -> None:
            while not stop.wait(interval):
                try:
                    self._request("POST", f"/v1/client/units/{unit['id']}/heartbeat", headers={"X-Fedagent-Attempt": str(unit["attempt"])})
                except (httpx.HTTPError, RuntimeError):
                    log.warning("工作单元 %s 续租失败，将在提交时确认租约", unit["id"])

        thread = threading.Thread(target=heartbeat, daemon=True)
        thread.start()
        try:
            yield
        finally:
            stop.set()
            thread.join(timeout=1)

    def run_unit(self, unit: dict[str, Any]) -> None:
        with self._lease(unit):
            self._run_unit(unit)

    def _run_unit(self, unit: dict[str, Any]) -> None:
        unit_id = unit["id"]
        headers = {"X-Fedagent-Attempt": str(unit["attempt"])}
        plugin = self.algorithms.get(unit["algorithm"])
        if plugin is None or plugin.version != unit["pluginVersion"]:
            have = plugin.version if plugin else "没有安装"
            error = f"本地的算法插件 {unit['algorithm']} 版本是 {have}，任务要求 {unit['pluginVersion']}"
            self._request("POST", f"/v1/client/units/{unit_id}/fail", headers=headers, json={"error": error, "pause": True})
            return
        manifest = plugin.manifest
        step = manifest.step(unit["step"])
        task_type = self.task_types[unit["taskType"]]
        grader = self.graders[unit["grader"]]
        records = self.records.get(unit["datasetId"] or "", {})
        records = {item_id: records[item_id] for item_id in unit["itemIds"] if item_id in records}
        try:
            inputs = self._request("GET", f"/v1/client/units/{unit_id}/inputs", headers=headers).json()
            inbox = {
                channel: [
                    Message(
                        id=m["id"],
                        channel=m["channel"],
                        round=m["round"],
                        step=m["step"],
                        sender=m["sender"],
                        sender_role=m["senderRole"],
                        payload=m["payload"],
                        item_id=m.get("itemId"),
                    )
                    for m in messages
                ]
                for channel, messages in inputs["inbox"].items()
            }
            raw_artifact = inputs.get("artifact")
            artifact = Artifact(**{key: raw_artifact[key] for key in ("version", "round", "kind", "content")}) if raw_artifact else None
            item = None
            full = None
            if step is not None and step.per == "item":
                full = records.get(unit["unitKey"])
                if full is None:
                    raise RuntimeError(f"本地数据里找不到样本 {unit['unitKey']}")
                from fedagent_sdk import Item

                fields = dict(full) if step.labels else task_type.strip_labels(full)
                item = Item(id=unit["unitKey"], fields=fields)
            assert step is not None
            ctx = StepContext(
                manifest=manifest,
                step=step,
                site=SiteInfo(unit["siteId"], unit["role"], unit["siteId"]),
                round=unit["round"],
                rounds=unit["rounds"],
                params=unit["params"],
                io=ClientStepIO(self.state, unit["taskId"], unit["siteId"], records, task_type, step.labels, inbox, artifact),
                model=CachedUnitModel(self._model(plugin, step.id), self.state, unit, plugin.code_hash()) if step.model else None,
                item=item,
                log=lambda text: log.info("unit %s: %s", unit_id, text),
            )
            plugin.run_step(ctx)
        except Exception as error:
            log.exception("unit %s failed", unit_id)
            self._request("POST", f"/v1/client/units/{unit_id}/fail", headers=headers,
                          json={"error": f"{type(error).__name__}: {error}"[:4000], "pause": isinstance(error, StepFailed) and error.pause})
            return
        result = ctx.result
        for key, item_id, value in result.kept:
            self.state.put(unit["taskId"], unit["siteId"], unit["round"], key, item_id, value)
        graded = []
        for item_id, prediction in result.predictions:
            record = records.get(item_id, {})
            labeled = task_type.is_labeled(record)
            graded.append({"itemId": item_id, "labeled": labeled, "correct": bool(labeled and grader.grade(prediction, record))})
        sent = []
        for outgoing in result.sent:
            if self.config.review is not None and not self.config.review(outgoing.channel, outgoing.payload):
                log.info("unit %s: 审查时没有通过的消息，不上传", unit_id)
                continue
            sent.append({"channel": outgoing.channel, "payload": outgoing.payload, "itemId": outgoing.item_id, "to": outgoing.to})
        body = {"sent": sent, "reports": result.reports, "graded": graded}
        # 完成请求的响应丢失时可重发，同一次领取只会保存一次。
        try:
            self._request("POST", f"/v1/client/units/{unit_id}/complete", headers=headers, json=body)
        except httpx.TransportError:
            self._request("POST", f"/v1/client/units/{unit_id}/complete", headers=headers, json=body)

    def run_once(self) -> int:
        units = self._request("POST", "/v1/client/units/claim", json={"limit": 1}).json()
        for unit in units:
            self.run_unit(unit)
        return len(units)

    def run_forever(self, stop: Callable[[], bool] = lambda: False) -> None:
        self.hello()
        while not stop():
            try:
                if self.run_once() == 0:
                    time.sleep(self.config.poll)
                    self.hello()
            except (httpx.HTTPError, RuntimeError) as error:
                log.warning("连接平台失败：%s，%s 秒后重试", error, self.config.poll)
                time.sleep(self.config.poll)
