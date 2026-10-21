"""数据与 Agent 成组接入。"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("datasets") as batch:
        batch.add_column(sa.Column("agent_id", sa.String(64), nullable=True))
        batch.create_foreign_key("fk_datasets_agent_id", "agent_endpoints", ["agent_id"], ["id"], ondelete="RESTRICT")


def downgrade():
    with op.batch_alter_table("datasets") as batch:
        batch.drop_constraint("fk_datasets_agent_id", type_="foreignkey")
        batch.drop_column("agent_id")
