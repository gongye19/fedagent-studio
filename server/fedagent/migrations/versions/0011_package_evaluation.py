"""允许同一源任务保留多个已发布包的评测。"""
import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tasks", sa.Column("evaluation_package_id", sa.String(64)))
    op.drop_index("ix_tasks_evaluation_source", table_name="tasks")
    op.create_index("ix_tasks_evaluation_source", "tasks", ["source_task_id"])
    op.create_index("ix_tasks_legacy_evaluation", "tasks", ["source_task_id"], unique=True,
                    sqlite_where=sa.text("evaluation_package_id IS NULL"),
                    postgresql_where=sa.text("evaluation_package_id IS NULL"))
    op.create_index("ix_tasks_active_package_evaluation", "tasks", ["evaluation_package_id"], unique=True,
                    sqlite_where=sa.text("status IN ('queued', 'running', 'paused')"),
                    postgresql_where=sa.text("status IN ('queued', 'running', 'paused')"))


def downgrade():
    if op.get_bind().execute(sa.text("SELECT 1 FROM tasks WHERE evaluation_package_id IS NOT NULL LIMIT 1")).first():
        raise RuntimeError("已保存经验包评测，请使用升级前备份回滚")
    op.drop_index("ix_tasks_active_package_evaluation", table_name="tasks")
    op.drop_index("ix_tasks_legacy_evaluation", table_name="tasks")
    op.drop_index("ix_tasks_evaluation_source", table_name="tasks")
    op.drop_column("tasks", "evaluation_package_id")
    op.create_index("ix_tasks_evaluation_source", "tasks", ["source_task_id"], unique=True)
