"""单工作区接入资源与平台公用资源；不表示多用户隔离。"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("datasets", "endpoints"):
        op.add_column(table, sa.Column("resource_space", sa.String(16), nullable=False, server_default="workspace"))
    op.execute("UPDATE datasets SET resource_space='public' WHERE source='builtin'")
    op.execute("UPDATE endpoints SET resource_space='public' WHERE builtin=1")
    # T75 用户指定的公开基准：仅识别已记录的 ID 与原始哈希，不把其他医疗上传划为公用。
    op.execute("UPDATE datasets SET resource_space='public' WHERE "
               "(id='ds-7cda527c' AND source_hash='53cf0d249a44c14c1487c26b8c26c766632e390eb39d7f61dc3167b8f0fe208e') OR "
               "(id='ds-73dafbc1' AND source_hash='24a5b868ad80996111704a85823876b7803bf5201d33f24edf6a4e1d128ce361')")


def downgrade():
    for table in ("datasets", "endpoints"):
        op.drop_column(table, "resource_space")
