"""数据库表。索引和状态在数据库里；数据集文件、运行目录在数据目录里。

站点（task_sites）是任务里执行步骤的一方：每个参加任务的参与方一个（站点 id 就是参与方 id），服务端一个（站点 id 是 server）。
工作单元（work_units）是执行和续跑的最小单位；它的结果写进 site_state（私有中间结果）、messages（跨站点的消息）、
reports（上报的汇总值）、artifacts（产出版本），在同一个事务里提交。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, ClassVar

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def now() -> datetime:
    return datetime.now(UTC)


def aware(value: datetime) -> datetime:
    """SQLite 读回来的时间不带时区（存的是 UTC），补上 UTC。"""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


class Base(DeclarativeBase):
    type_annotation_map: ClassVar[dict[Any, Any]] = {dict[str, Any]: JSON, list[Any]: JSON, datetime: DateTime(timezone=True)}


class Participant(Base):
    __tablename__ = "participants"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    org: Mapped[str] = mapped_column(String(80), default="")
    intro: Mapped[str] = mapped_column(String(240), default="")
    hosting: Mapped[str] = mapped_column(String(16))
    """platform：平台托管；local：参与方本地（客户端）。"""
    builtin: Mapped[bool] = mapped_column(default=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(default=None)
    client_plugins: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=now)


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    participant_id: Mapped[str] = mapped_column(ForeignKey("participants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(240), default="")
    origin: Mapped[str | None] = mapped_column(String(120), default=None)
    scenario: Mapped[str] = mapped_column(String(32))
    task_type: Mapped[str] = mapped_column(String(64))
    resource_space: Mapped[str] = mapped_column(String(16), default="workspace")
    schema_version: Mapped[str] = mapped_column(String(32), default="1.0")
    source_hash: Mapped[str | None] = mapped_column(String(64), default=None)
    source: Mapped[str] = mapped_column(String(16))
    """builtin：内置数据；upload：上传到平台；local：留在参与方本地。"""
    count: Mapped[int] = mapped_column(default=0)
    answered: Mapped[int] = mapped_column(default=0)
    sample: Mapped[dict[str, Any] | None] = mapped_column(default=None)
    content_path: Mapped[str | None] = mapped_column(String(400), default=None)
    content_hash: Mapped[str | None] = mapped_column(String(64), default=None)
    item_ids: Mapped[list[Any] | None] = mapped_column(default=None)
    """本地数据集：客户端上报的样本 id（不含内容）。"""
    created_at: Mapped[datetime] = mapped_column(default=now)


class Endpoint(Base):
    __tablename__ = "endpoints"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(16), default="openai")
    resource_space: Mapped[str] = mapped_column(String(16), default="workspace")
    """openai：OpenAI 兼容接口；fake：测试用的假模型。"""
    base_url: Mapped[str] = mapped_column(String(400), default="")
    models: Mapped[list[Any]] = mapped_column(default=list)
    concurrency: Mapped[int] = mapped_column(default=8)
    price: Mapped[float | None] = mapped_column(Float, default=None)
    """元 / 百万 token。"""
    api_key_enc: Mapped[str | None] = mapped_column(Text, default=None)
    timeout: Mapped[float] = mapped_column(Float, default=600.0)
    max_retries: Mapped[int] = mapped_column(default=8)
    builtin: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(default=now)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    scenario: Mapped[str] = mapped_column(String(32))
    task_type: Mapped[str] = mapped_column(String(64))
    algorithm: Mapped[str] = mapped_column(String(64))
    plugin_version: Mapped[str] = mapped_column(String(32))
    plugin_hash: Mapped[str] = mapped_column(String(64))
    config: Mapped[dict[str, Any]] = mapped_column()
    """冻结的配置（和前端的 TaskConfig 同样的字段）。"""
    audit: Mapped[dict[str, Any]] = mapped_column(default=dict)
    """提示词、数据的哈希等。"""
    status: Mapped[str] = mapped_column(String(16), index=True)
    """queued、running、paused、completed、canceled。"""
    command: Mapped[str | None] = mapped_column(String(16), default=None)
    """API 发给任务进程的命令：pause、cancel。"""
    error: Mapped[str | None] = mapped_column(Text, default=None)
    cursor_round: Mapped[int] = mapped_column(default=1)
    cursor_step: Mapped[str | None] = mapped_column(String(64), default=None)
    restarts: Mapped[int] = mapped_column(default=0)
    pid: Mapped[int | None] = mapped_column(default=None)
    budget: Mapped[float | None] = mapped_column(Float, default=None)
    fake: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(default=now)
    started_at: Mapped[datetime | None] = mapped_column(default=None)
    finished_at: Mapped[datetime | None] = mapped_column(default=None)


class TaskSite(Base):
    __tablename__ = "task_sites"

    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    ordinal: Mapped[int] = mapped_column()
    kind: Mapped[str] = mapped_column(String(16))
    """participant 或 server。"""
    role: Mapped[str] = mapped_column(String(32))
    executor: Mapped[str] = mapped_column(String(16))
    """platform：平台执行；client：本地客户端领取；agent：平台调度自有 Agent API。"""
    participant_id: Mapped[str | None] = mapped_column(String(64), default=None)
    participant_name: Mapped[str] = mapped_column(String(80), default="")
    dataset_id: Mapped[str | None] = mapped_column(String(64), default=None)
    dataset_name: Mapped[str] = mapped_column(String(80), default="")
    dataset_hash: Mapped[str | None] = mapped_column(String(64), default=None)
    items: Mapped[list[Any]] = mapped_column(default=list)
    """参加这个任务的样本 id（试跑时只取前几条）。"""
    labeled: Mapped[int] = mapped_column(default=0)
    model_ref: Mapped[str | None] = mapped_column(String(160), default=None)


class WorkUnit(Base):
    __tablename__ = "work_units"
    __table_args__ = (
        UniqueConstraint("task_id", "round", "step", "site_id", "unit_key"),
        Index("ix_units_status", "task_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    round: Mapped[int] = mapped_column()
    step: Mapped[str] = mapped_column(String(64))
    site_id: Mapped[str] = mapped_column(String(64))
    unit_key: Mapped[str] = mapped_column(String(200))
    """样本 id；按站点拆的步骤是 _。"""
    executor: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    """pending、running、claimed（客户端领取）、done、failed。"""
    attempts: Mapped[int] = mapped_column(default=0)
    lease_until: Mapped[datetime | None] = mapped_column(default=None)
    claimed_by: Mapped[str | None] = mapped_column(String(64), default=None)
    error: Mapped[str | None] = mapped_column(Text, default=None)
    started_at: Mapped[datetime | None] = mapped_column(default=None)
    finished_at: Mapped[datetime | None] = mapped_column(default=None)


class SiteState(Base):
    """平台托管的参与方和服务端私有的中间结果（ctx.keep）。本地参与方的留在客户端，不在这里。"""

    __tablename__ = "site_state"

    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    site_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    round: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    item_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    """按站点存的是空字符串。"""
    value: Mapped[Any] = mapped_column(JSON)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_inbox", "task_id", "round", "channel"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    round: Mapped[int] = mapped_column()
    step: Mapped[str] = mapped_column(String(64))
    channel: Mapped[str] = mapped_column(String(64))
    sender_site: Mapped[str] = mapped_column(String(64))
    sender_role: Mapped[str] = mapped_column(String(32))
    receiver_site: Mapped[str | None] = mapped_column(String(64), default=None)
    receiver_role: Mapped[str | None] = mapped_column(String(32), default=None)
    item_id: Mapped[str | None] = mapped_column(String(200), default=None)
    payload: Mapped[Any] = mapped_column(JSON)
    size: Mapped[int] = mapped_column(default=0)
    sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(default=now)


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (Index("ix_reports_task", "task_id", "round", "step"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    round: Mapped[int] = mapped_column()
    step: Mapped[str] = mapped_column(String(64))
    site_id: Mapped[str] = mapped_column(String(64))
    unit_key: Mapped[str] = mapped_column(String(200))
    name: Mapped[str] = mapped_column(String(64))
    value: Mapped[Any] = mapped_column(JSON)


class Artifact(Base):
    __tablename__ = "artifacts"

    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    version: Mapped[int] = mapped_column(primary_key=True)
    round: Mapped[int] = mapped_column()
    kind: Mapped[str] = mapped_column(String(64))
    content: Mapped[Any] = mapped_column(JSON)
    plugin_version: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(default=now)


class App(Base):
    """发布的应用：记下产出版本和分类，并复制一份产出内容，来源任务删掉后仍然可用。"""

    __tablename__ = "apps"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[int] = mapped_column()
    built_after_round: Mapped[int] = mapped_column()
    name: Mapped[str] = mapped_column(String(120))
    scenario: Mapped[str] = mapped_column(String(32))
    task_type: Mapped[str] = mapped_column(String(64))
    algorithm: Mapped[str] = mapped_column(String(64))
    plugin_version: Mapped[str] = mapped_column(String(32))
    kind: Mapped[str] = mapped_column(String(64))
    content: Mapped[Any] = mapped_column(JSON)
    published_at: Mapped[datetime] = mapped_column(default=now)


class CallRecord(Base):
    """模型调用账本：每次调用一行；续跑时同一个工作单元里的同一次调用直接取这里的结果。"""

    __tablename__ = "calls"
    __table_args__ = (Index("ix_calls_unit", "task_id", "site_id", "round", "step", "unit_key", "ordinal"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str | None] = mapped_column(String(64), default=None)
    site_id: Mapped[str | None] = mapped_column(String(64), default=None)
    round: Mapped[int | None] = mapped_column(default=None)
    step: Mapped[str | None] = mapped_column(String(64), default=None)
    unit_key: Mapped[str | None] = mapped_column(String(200), default=None)
    ordinal: Mapped[int] = mapped_column(default=0)
    purpose: Mapped[str] = mapped_column(String(32), default="task")
    """task：任务里的调用；apply：应用试用；test：测试接口。"""
    endpoint_id: Mapped[str] = mapped_column(String(64))
    model: Mapped[str] = mapped_column(String(160))
    request_hash: Mapped[str] = mapped_column(String(64))
    response: Mapped[Any] = mapped_column(JSON, default=None, nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(default=0)
    completion_tokens: Mapped[int] = mapped_column(default=0)
    latency_ms: Mapped[int] = mapped_column(default=0)
    cost: Mapped[float | None] = mapped_column(Float, default=None)
    status: Mapped[str] = mapped_column(String(16), default="ok")
    """ok：成功，续跑时可以取回；error：调用失败；discarded：所在的单元这次尝试失败了，重试时不再取回（费用照记）。"""
    error: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(default=now)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    message: Mapped[str] = mapped_column(Text)
    data: Mapped[dict[str, Any] | None] = mapped_column(default=None)
    created_at: Mapped[datetime] = mapped_column(default=now)


class ClientToken(Base):
    """参与方客户端的令牌：只存哈希，签发时显示一次；可以吊销。"""

    __tablename__ = "client_tokens"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    participant_id: Mapped[str] = mapped_column(ForeignKey("participants.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(default=now)
    revoked_at: Mapped[datetime | None] = mapped_column(default=None)
    last_used_at: Mapped[datetime | None] = mapped_column(default=None)


class AgentEndpoint(Base):
    __tablename__ = "agent_endpoints"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    base_url: Mapped[str] = mapped_column(String(400))
    resource_space: Mapped[str] = mapped_column(String(16), default="workspace")
    api_key_enc: Mapped[str | None] = mapped_column(Text, default=None)
    capabilities: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    revision: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(default=now)


class AgentRun(Base):
    __tablename__ = "agent_runs"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), default=None, index=True)
    unit_id: Mapped[int | None] = mapped_column(ForeignKey("work_units.id", ondelete="CASCADE"), default=None, index=True)
    agent_id: Mapped[str] = mapped_column(String(64))
    request_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="queued")
    created_at: Mapped[datetime] = mapped_column(default=now)


class TaskCheck(Base):
    __tablename__ = "task_checks"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="queued")
    results: Mapped[list[Any]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(default=now)
    finished_at: Mapped[datetime | None] = mapped_column(default=None)
