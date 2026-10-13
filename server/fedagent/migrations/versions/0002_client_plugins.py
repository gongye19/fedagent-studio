"""参与方客户端的已安装算法能力。"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("participants", sa.Column("client_plugins", sa.JSON(), nullable=False, server_default="{}"))


def downgrade():
    op.drop_column("participants", "client_plugins")
