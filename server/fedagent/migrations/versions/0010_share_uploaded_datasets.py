"""将已有上传登记为联邦任务可用的数据。"""
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("UPDATE datasets SET shared = TRUE WHERE source = 'upload' AND shared = FALSE")


def downgrade():
    # 保留当前共享设置，无法区分升级前已共享的数据和升级后新增的上传。
    pass
