"""Agent 接口、幂等调用与配置测试记录。"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("agent_endpoints",
        sa.Column("id", sa.String(64), primary_key=True), sa.Column("name", sa.String(80), nullable=False),
        sa.Column("base_url", sa.String(400), nullable=False), sa.Column("resource_space", sa.String(16), nullable=False),
        sa.Column("api_key_enc", sa.Text()), sa.Column("capabilities", sa.JSON()),
        sa.Column("revision", sa.Integer(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("agent_runs",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("task_id", sa.String(64), sa.ForeignKey("tasks.id", ondelete="CASCADE")),
        sa.Column("unit_id", sa.Integer(), sa.ForeignKey("work_units.id", ondelete="CASCADE")),
        sa.Column("agent_id", sa.String(64), nullable=False), sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_agent_runs_task_id", "agent_runs", ["task_id"])
    op.create_index("ix_agent_runs_unit_id", "agent_runs", ["unit_id"])
    op.create_table("task_checks",
        sa.Column("id", sa.String(64), primary_key=True), sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False), sa.Column("results", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("finished_at", sa.DateTime(timezone=True)))


def downgrade():
    for name in ("task_checks", "agent_runs", "agent_endpoints"):
        op.drop_table(name)
