"""可复用的独立 Agent HTTP 运行器：幂等、异步执行、取消与重启恢复。"""

from __future__ import annotations

import hashlib
import multiprocessing
import os
import sqlite3
import threading
from contextlib import asynccontextmanager, contextmanager
from multiprocessing.process import BaseProcess
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fedagent_sdk import ModelError, StepFailed

from ..gateway import LedgerKey
from ..platform import Platform
from ..settings import Settings
from .protocol import MAX_BYTES, AgentRequest, AgentResult, AlgorithmCapability, Capabilities, RunStatus
from .runtime import context_of


@contextmanager
def _connect(path: Path):
    db = sqlite3.connect(path, timeout=30)
    try:
        db.execute("PRAGMA journal_mode=WAL")
        with db:
            yield db
    finally:
        db.close()


def _write(path: Path, run_id: str, status: RunStatus) -> None:
    with _connect(path) as db:
        db.execute("UPDATE runs SET output=? WHERE id=?", (status.model_dump_json(), run_id))


def _finish_cancel(path: Path, run_id: str) -> RunStatus:
    with _connect(path) as db:
        row = db.execute("SELECT output FROM runs WHERE id=?", (run_id,)).fetchone()
        status = RunStatus.model_validate_json(row[0])
        if status.status not in ("succeeded", "failed", "canceled"):
            status = RunStatus(run_id=run_id, status="canceled")
            db.execute("UPDATE runs SET output=? WHERE id=?", (status.model_dump_json(), run_id))
        return status


def _work(settings: dict, path: Path, body: AgentRequest, model_ref: str) -> None:
    try:
        platform = Platform.create(Settings(**settings), migrate=False)
        algorithm = platform.registry.algorithm(body.algorithm)
        step = algorithm.manifest.step(body.step)
        model = (
            platform.gateway.model(
                model_ref,
                ledger=LedgerKey(body.task_id, body.site_id, body.round, body.step, body.unit_key),
                purpose="agent-test" if body.task_id.startswith("check-") else "agent",
                plugin=algorithm,
                step_id=body.step,
            )
            if step and step.model
            else None
        )
        ctx = context_of(body, algorithm, model)
        algorithm.run_step(ctx)
        value = ctx.result
        if value.has_published:
            raise StepFailed("参与方 Agent 不能发布中心产出")
        result = AgentResult(kept=value.kept, sent=value.sent, reports=value.reports, predictions=value.predictions, logs=value.logs)
        from .store import AgentStore

        public = result.model_copy(update={"kept": []}) if step and step.private_state else result
        algorithm.validate_participant_result(ctx, public.unit_result())
        AgentStore(path.parent).record(body, result)
        status = RunStatus(run_id=body.run_id, status="succeeded", result=public)
    except Exception as error:
        import logging

        logging.getLogger(__name__).exception("Agent run %s failed", body.run_id)
        code = ("diagnosis_incomplete" if isinstance(error, ModelError) and str(error).startswith("问诊回合结束")
                else "model_error" if isinstance(error, ModelError) else "invalid_output" if isinstance(error, ValueError) else None)
        status = RunStatus(run_id=body.run_id, status="failed", error="执行失败，请检查 Agent 服务日志", error_code=code,
                           retryable=isinstance(error, ModelError) or (isinstance(error, StepFailed) and not error.pause))
    _write(path, body.run_id, status)


def create_agent_app(
    platform: Platform, root: Path, model_ref: str, *, token: str | None = None,
    algorithm_ids: frozenset[str] | None = None, name: str = "FedAgent Agent",
) -> FastAPI:
    from .store import AgentStore

    AgentStore(root)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = root / "runs.sqlite"
    with _connect(path) as db:
        db.execute("CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, digest TEXT NOT NULL, output TEXT NOT NULL)")
        for run_id, raw in db.execute("SELECT id, output FROM runs"):
            status = RunStatus.model_validate_json(raw)
            if status.status in ("running", "queued", "canceling"):
                db.execute(
                    "UPDATE runs SET output=? WHERE id=?",
                    (RunStatus(run_id=run_id, status="failed", error="Agent 服务重启中断了执行").model_dump_json(), run_id),
                )
    os.chmod(path, 0o600)
    processes: dict[str, BaseProcess] = {}
    lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(_app):
        yield
        with lock:
            for run_id, process in processes.items():
                if process.is_alive():
                    process.terminate()
                    process.join(timeout=3)
                    _finish_cancel(path, run_id)

    def auth(request: Request):
        if token and request.headers.get("Authorization") != f"Bearer {token}":
            raise HTTPException(401, "需要 Agent 服务访问密钥")

    app = FastAPI(title=name, lifespan=lifespan, dependencies=[Depends(auth)])

    @app.middleware("http")
    async def size_limit(request: Request, call_next):
        from starlette.responses import JSONResponse

        if request.method == "POST":
            data = bytearray()
            async for chunk in request.stream():
                data.extend(chunk)
                if len(data) > MAX_BYTES:
                    return JSONResponse({"detail": "输入超过 8 MB"}, status_code=413)
            request._body = bytes(data)
        return await call_next(request)

    @app.get("/healthz")
    def health():
        return {"status": "ok", "name": name}

    @app.get("/capabilities", response_model=Capabilities)
    def capabilities():
        return Capabilities(
            algorithms={
                a.id: AlgorithmCapability(version=a.version, steps=[s.id for s in a.manifest.steps if s.at != "server"])
                for a in platform.registry.algorithms.values()
                if algorithm_ids is None or a.id in algorithm_ids
            }
        )

    def read(run_id: str) -> RunStatus:
        with _connect(path) as db:
            row = db.execute("SELECT output FROM runs WHERE id=?", (run_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "运行不存在")
        status = RunStatus.model_validate_json(row[0])
        process = processes.get(run_id)
        if process and not process.is_alive() and status.status == "running":
            status = RunStatus(run_id=run_id, status="failed", error="Agent 执行进程意外退出")
            _write(path, run_id, status)
        return status

    @app.post("/runs", response_model=RunStatus, status_code=202)
    def submit(body: AgentRequest):
        algorithm = platform.registry.algorithms.get(body.algorithm)
        if (algorithm_ids is not None and body.algorithm not in algorithm_ids) or algorithm is None or body.task_type not in algorithm.manifest.accepts:
            raise HTTPException(422, "算法或任务类型不受支持")
        try:
            context_of(body, algorithm)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        digest = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
        with lock:
            with _connect(path) as db:
                existing = db.execute("SELECT digest FROM runs WHERE id=?", (body.run_id,)).fetchone()
                if existing:
                    if existing[0] and existing[0] != digest:
                        raise HTTPException(409, "同一运行编号的输入不能改变")
                    return read(body.run_id)
                for run_id, process in list(processes.items()):
                    if not process.is_alive():
                        process.join(timeout=0)
                        del processes[run_id]
                if len(processes) >= 8:
                    raise HTTPException(429, "Agent 并发已满，请稍后重试")
                status = RunStatus(run_id=body.run_id, status="running")
                db.execute("INSERT INTO runs VALUES(?,?,?)", (body.run_id, digest, status.model_dump_json()))
            process = multiprocessing.get_context("spawn").Process(target=_work, args=(platform.settings.model_dump(), path, body, model_ref), daemon=True)
            processes[body.run_id] = process
            process.start()
            return status

    @app.get("/runs/{run_id}", response_model=RunStatus)
    def get_run(run_id: str):
        with lock:
            return read(run_id)

    @app.post("/runs/{run_id}/cancel", response_model=RunStatus)
    def cancel(run_id: str):
        with lock:
            try:
                status = read(run_id)
            except HTTPException as error:
                if error.status_code != 404:
                    raise
                status = RunStatus(run_id=run_id, status="canceled")
                with _connect(path) as db:
                    db.execute("INSERT OR IGNORE INTO runs VALUES(?,?,?)", (run_id, "", status.model_dump_json()))
                return status
            if status.status in ("succeeded", "failed", "canceled"):
                return status
            process = processes.get(run_id)
            if process and process.is_alive():
                process.terminate()
                process.join(timeout=3)
                if process.is_alive():
                    return RunStatus(run_id=run_id, status="canceling")
            return _finish_cancel(path, run_id)

    return app
