"""隔离平台的真实上传→FoT→发布；本地对照复用同一批实际 trace。"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
from fastapi.testclient import TestClient
from fedagent import models as m
from fedagent.api import create_app
from fedagent.engine import TaskEngine
from fedagent.gateway import LedgerKey
from fedagent.platform import Platform
from fedagent.resource_services.endpoint_checks import check_endpoint
from fedagent.settings import Settings
from fedagent_sdk import Message, SiteInfo, StepContext
from sqlalchemy import select

from .common import digest, load, save


def local_platform(directory: Path, model):
    def bridge(request):
        if request.method == "GET" and request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": model.name}]})
        if request.method != "POST" or not request.url.path.endswith("/chat/completions"):
            raise ValueError("本机模型桥不支持这个操作")
        body = json.loads(request.content)
        if body.pop("model") != model.name:
            raise ValueError("模型不一致")
        body.pop("stream", None)
        body.pop("stream_options", None)
        messages = body.pop("messages")
        reply = model.chat(messages, **body)
        return httpx.Response(
            200, json={"model": reply.model, "usage": reply.usage, "choices": [{"message": {"content": reply.text}, "finish_reason": reply.finish_reason}]}
        )

    platform = Platform.create(Settings(data_dir=directory / "platform", fake_endpoint=False), transport=httpx.MockTransport(bridge))
    with platform.db.session() as session:
        endpoint = session.get(m.Endpoint, "default")
        if endpoint is None:
            session.add(
                m.Endpoint(
                    id="default",
                    name="本机实验模型桥",
                    base_url="https://lifestyle-bridge.invalid/v1",
                    models=[model.name],
                    concurrency=2,
                    max_retries=0,
                    builtin=True,
                )
            )
        elif endpoint.models != [model.name] or endpoint.max_retries != 0:
            raise ValueError("隔离平台的模型配置改变")
    return platform


def checked(response, status=200):
    if response.status_code != status:
        raise ValueError(f"本机平台请求失败：{response.status_code} {response.text}")
    return response.json()


def federate(directory: Path, manifest, records, platform):
    algorithm = platform.registry.algorithm("fot-records")
    fingerprint = digest({"prepared": manifest["fingerprint"], "records": records, "plugin": algorithm.code_hash()})
    state_path = directory / "task.json"
    state = load(state_path) if state_path.exists() else {"fingerprint": fingerprint, "sites": {}}
    if state["fingerprint"] != fingerprint:
        raise ValueError("任务输入或代码改变；请使用新的隔离目录，不能续跑旧任务")
    save(state_path, state)
    ref = "default:" + platform.gateway.endpoint("default").models[0]
    with TestClient(create_app(platform)) as client:
        if "taskId" not in state:
            probe = check_endpoint(platform, "default", verify_platform=True)
            if not probe.ok:
                raise ValueError("真实模型参数检查未通过")
            for site, record in records.items():
                if site not in state["sites"]:
                    data = checked(
                        client.post(
                            "/v1/resources/data",
                            data={
                                "name": f"LifeStyle 模拟站点 {site}",
                                "sourceName": f"公开资料模拟站点 {site}",
                                "hosting": "platform",
                                "taskType": "lifestyle-records",
                                "description": "公开资料与 Synthea 合成画像，模型生成的生活方式建议过程；非真实医院。",
                            },
                            files={"file": ("process.jsonl", json.dumps(record, ensure_ascii=False).encode(), "application/jsonl")},
                        ),
                        201,
                    )
                    state["sites"][site] = {"participantId": data["source"]["id"], "datasetId": data["dataset"]["id"]}
                    save(state_path, state)
            task = checked(
                client.post(
                    "/v1/tasks",
                    json={
                        "name": "LifeStyle 三方经验链路验证",
                        "scenario": "horizontal",
                        "taskType": "lifestyle-records",
                        "algorithm": "fot-records",
                        "participants": list(state["sites"].values()),
                        "clientModel": ref,
                        "serverModel": ref,
                        "rounds": 1,
                        "mode": "full",
                        "workers": 2,
                        "params": {"insightTarget": "paper-auto"},
                    },
                ),
                201,
            )
            state["taskId"] = task["id"]
            save(state_path, state)
        task_id = state["taskId"]
        with platform.db.session() as session:
            task = session.get(m.Task, task_id)
            if task.status != "completed":
                task.status, task.command, task.error = "running", None, None
        status = TaskEngine(platform, task_id, poll=0.05).run()
        if status != "completed":
            raise ValueError(f"本机 FoT 任务未完成（{status}）；保留检查点，不发布、不计分")
        if "appId" not in state:
            app = checked(client.post("/v1/apps", json={"taskId": task_id, "builtAfterRound": 1, "name": "LifeStyle · 三方 FoT 经验包"}), 201)
            state["appId"] = app["id"]
            save(state_path, state)
        with platform.db.session() as session:
            app = session.get(m.App, state["appId"])
            shared = app.content
        save(directory / "shared-library.json", shared)
        state["local"] = local_libraries(directory, platform, state, ref)
    return state, shared


class MemoryIO:
    def __init__(self, messages):
        self.messages, self.kept = messages, {}

    def recall(self, key, item_id, round):
        return self.kept.get((key, item_id))

    def inbox(self, channel, round):
        return self.messages

    def artifact(self, before_round):
        return None

    def items(self):
        return []


def local_libraries(directory, platform, state, ref):
    algorithm = platform.registry.algorithm("fot-records")

    def one_site(pair):
        site, resource = pair
        with platform.db.session() as session:
            db_site = session.scalars(
                select(m.TaskSite).where(m.TaskSite.task_id == state["taskId"], m.TaskSite.participant_id == resource["participantId"])
            ).one()
            rows = session.scalars(
                select(m.Message)
                .where(m.Message.task_id == state["taskId"], m.Message.sender_site == db_site.id, m.Message.channel == "trace")
                .order_by(m.Message.id)
            ).all()
            messages = [Message(str(row.id), row.channel, row.round, row.step, row.sender_site, row.sender_role, row.payload, row.item_id) for row in rows]
        if not messages:
            raise ValueError(f"站点 {site} 没有实际上传的 trace，不能造本地经验对照")
        io = MemoryIO(messages)
        for step_id in ("collect", "profile", "library"):
            path = directory / "local" / f"{site}-{step_id}.json"
            fingerprint = digest({"task": state["fingerprint"], "site": site, "step": step_id, "messages": [m.payload for m in messages]})
            if path.exists():
                output = load(path)
                if output["fingerprint"] != fingerprint:
                    raise ValueError("本地经验检查点不一致")
            else:
                ctx = StepContext(
                    manifest=algorithm.manifest,
                    step=algorithm.manifest.step(step_id),
                    site=SiteInfo("server", "server"),
                    round=1,
                    rounds=1,
                    params=algorithm.manifest.params_of({}),
                    io=io,
                    model=platform.gateway.model(
                        ref, purpose="local-library", plugin=algorithm, step_id=step_id, ledger=LedgerKey("local:" + state["taskId"], site, 1, step_id, "_")
                    ),
                )
                algorithm.run_step(ctx)
                output = {"fingerprint": fingerprint, "kept": ctx.result.kept, "published": ctx.result.published, "hasPublished": ctx.result.has_published}
                save(path, output)
            for key, item_id, value in output["kept"]:
                io.kept[key, item_id] = value
            if step_id == "library":
                if not output["hasPublished"]:
                    raise ValueError("本地聚合没有产出")
                return site, output["published"]
        raise ValueError("本地聚合未结束")

    with ThreadPoolExecutor(max_workers=2) as pool:
        return dict(pool.map(one_site, state["sites"].items()))
