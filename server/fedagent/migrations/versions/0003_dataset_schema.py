"""数据规范版本与原始上传哈希；旧数学数据兼容规范 1.0。"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("datasets", sa.Column("schema_version", sa.String(32), nullable=False, server_default="1.0"))
    op.add_column("datasets", sa.Column("source_hash", sa.String(64), nullable=True))


def downgrade():
    op.drop_column("datasets", "source_hash")
    op.drop_column("datasets", "schema_version")
