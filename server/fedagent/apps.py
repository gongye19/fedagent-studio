"""应用：把一版产出发布出来，试用（带产出 / 不带产出对比）、导出、API 调用。

应用复制一份产出内容并记下分类和插件版本，来源任务删掉后仍然可用。怎么使用产出由算法插件的 apply、export 决定。
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

from fedagent_sdk import ApplyRequest, Artifact, ModelError
from fedagent_sdk.model import MeteredModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models as m
from .errors import ServiceError
from .platform import Platform
from .resources import new_id, not_found
from .schemas import AppIn, ApplyIn, ApplyOut, ApplySide, AppOut, OutputItem
from .tasks import get_task


def artifact_of(app: m.App) -> Artifact:
    return Artifact(version=app.version, round=app.built_after_round, kind=app.kind, content=app.content)


def publish(platform: Platform, session: Session, body: AppIn) -> m.App:
    task = get_task(session, body.task_id)
    row = session.scalars(select(m.Artifact).where(m.Artifact.task_id == task.id, m.Artifact.round == body.built_after_round)).first()
    if row is None:
        raise ServiceError(404, "这一轮还没有产出")
    if session.scalars(select(m.App).where(m.App.task_id == task.id, m.App.version == row.version)).first() is not None:
        raise ServiceError(409, "这一版已经发布过了")
    app = m.App(
        id=new_id("app"),
        task_id=task.id,
        version=row.version,
        built_after_round=row.round,
        name=body.name.strip(),
        scenario=task.scenario,
        task_type=task.task_type,
        algorithm=task.algorithm,
        plugin_version=row.plugin_version,
        kind=row.kind,
        content=row.content,
    )
    session.add(app)
    return app


def app_out(platform: Platform, app: m.App) -> AppOut:
    algorithm = platform.registry.algorithms.get(app.algorithm)
    if algorithm is not None:
        items = [OutputItem(key=entry.key, text=entry.text, category=entry.category) for entry in algorithm.describe(artifact_of(app))]
    elif isinstance(app.content, dict):
        items = [OutputItem(key=str(key), text=str(value)) for key, value in app.content.items()]
    else:
        items = []
    return AppOut(
        id=app.id,
        task_id=app.task_id,
        built_after_round=app.built_after_round,
        name=app.name,
        published_at=app.published_at,
        scenario=app.scenario,
        task_type=app.task_type,
        algorithm=app.algorithm,
        plugin_version=app.plugin_version,
        items=items,
    )


def get_app(session: Session, app_id: str) -> m.App:
    app = session.get(m.App, app_id)
    if app is None:
        raise not_found("应用")
    return app


def _application(platform: Platform, app: m.App, body: ApplyIn):
    registry = platform.registry
    algorithm = registry.algorithm(app.algorithm)
    if algorithm.version != app.plugin_version:
        raise ServiceError(409, "应用的算法版本尚未安装，请恢复对应版本后再运行")
    task_type = registry.task_type(app.task_type)
    try:
        if len(json.dumps(body.input, ensure_ascii=False, allow_nan=False)) > 40000:
            raise ValueError("输入过长，请缩短后重新提交")
        item = task_type.application_item(body.input, body.answer)
    except (ValueError, TypeError, RecursionError) as error:
        raise ServiceError(422, str(error)) from error
    request = ApplyRequest(input=task_type.application_input(item))

    def side(artifact: Artifact | None) -> ApplySide:
        model = MeteredModel(platform.gateway.model(body.model, purpose="apply", plugin=algorithm))
        result = algorithm.apply(artifact, request, model)
        correct = None
        if task_type.is_labeled(item) and task_type.graders:
            correct = registry.grader(task_type.graders[0]).evaluate(result.output, item, model)
        tokens = int(model.usage.get("prompt_tokens", 0)) + int(model.usage.get("completion_tokens", 0))
        return ApplySide(output=result.output, correct=correct, tokens=tokens, details=result.details)

    return side


def invoke(platform: Platform, app: m.App, body: ApplyIn) -> ApplySide:
    """实际接入默认只运行带产出的一侧，避免每次 API 调用强制付两份推理费用。"""
    try:
        return _application(platform, app, body)(artifact_of(app))
    except ModelError as error:
        raise ServiceError(502, f"模型调用失败：{error}") from error


def apply(platform: Platform, app: m.App, body: ApplyIn) -> ApplyOut:
    """兼容原接口：同一输入带／不带产出对比。输入与评分由任务类型处理。"""
    side = _application(platform, app, body)

    # 带产出、不带产出两次调用同时发，等待时间按较慢的那次算
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {"with": pool.submit(side, artifact_of(app)), "without": pool.submit(side, None)}
        try:
            sides = {key: future.result() for key, future in futures.items()}
        except ModelError as error:
            raise ServiceError(502, f"模型调用失败：{error}") from error
    return ApplyOut.model_validate({"without": sides["without"], "with": sides["with"]})


def export(platform: Platform, app: m.App) -> tuple[str, str, bytes]:
    return platform.registry.algorithm(app.algorithm).export(artifact_of(app))
