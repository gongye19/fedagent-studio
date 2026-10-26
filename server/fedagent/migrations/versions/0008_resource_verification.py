"""资源接入验证；旧记录保留，重新验证后方可用于新任务。"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("endpoints", sa.Column("verification_hash", sa.String(64), nullable=True))
    op.add_column("agent_endpoints", sa.Column("verifications", sa.JSON(), nullable=False, server_default="{}"))


def downgrade():
    with op.batch_alter_table("agent_endpoints") as batch:
        batch.drop_column("verifications")
    with op.batch_alter_table("endpoints") as batch:
        batch.drop_column("verification_hash")
