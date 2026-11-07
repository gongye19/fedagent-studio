"""关联经验评测作业与其来源任务。"""
import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    # SQLite 支持新增可空的带引用列，保留任务和全部子表原数据。
    op.execute("ALTER TABLE tasks ADD COLUMN source_task_id VARCHAR(64) REFERENCES tasks(id) ON DELETE CASCADE")
    op.create_index("ix_tasks_evaluation_source", "tasks", ["source_task_id"], unique=True)


def downgrade():
    op.drop_index("ix_tasks_evaluation_source", table_name="tasks")
    with op.batch_alter_table("tasks") as batch:
        batch.drop_column("source_task_id")
