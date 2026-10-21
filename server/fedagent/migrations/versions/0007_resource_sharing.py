"""独立资源的归属和共享；配对回到任务配置。"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None
TABLES = ("datasets", "endpoints", "agent_endpoints")


def upgrade():
    for table in TABLES:
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("owner_id", sa.String(100), nullable=False, server_default="workspace"))
            batch.add_column(sa.Column("owner_name", sa.String(100), nullable=False, server_default="当前工作区"))
            batch.add_column(sa.Column("shared", sa.Boolean(), nullable=False, server_default="0"))
        op.execute(sa.text(f"UPDATE {table} SET owner_id='platform', owner_name='平台资源', shared=1 WHERE resource_space='public'"))
    # 原公共绑定只用于迁移所属方，不保留数据→Agent关系；不触碰任何任务快照。
    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT id, name FROM agent_endpoints WHERE resource_space='public'")).all()
    for agent_id, name in rows:
        params = {"id": agent_id, "owner": f"shared:{agent_id}", "name": f"{name}（团队接入）"}
        connection.execute(sa.text("UPDATE agent_endpoints SET owner_id=:owner, owner_name=:name WHERE id=:id"), params)
        connection.execute(sa.text("UPDATE datasets SET owner_id=:owner, owner_name=:name WHERE agent_id=:id AND resource_space='public'"), params)
    with op.batch_alter_table("datasets") as batch:
        batch.drop_constraint("fk_datasets_agent_id", type_="foreignkey")
        batch.drop_column("agent_id")


def downgrade():
    with op.batch_alter_table("datasets") as batch:
        batch.add_column(sa.Column("agent_id", sa.String(64), nullable=True))
        batch.create_foreign_key("fk_datasets_agent_id", "agent_endpoints", ["agent_id"], ["id"], ondelete="RESTRICT")
    for table in TABLES:
        with op.batch_alter_table(table) as batch:
            for column in ("shared", "owner_name", "owner_id"):
                batch.drop_column(column)
