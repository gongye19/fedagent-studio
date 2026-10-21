"""从0006迁移：保留资源、任务与凭据，公共绑定仅转为归属。"""
from alembic import command
from sqlalchemy import text

from fedagent.db import Database
from fedagent.migrate import alembic_config, upgrade


def test_0007_removes_permanent_binding_without_losing_resources(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'migration.db'}")
    config = alembic_config(db)
    with db.engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0006")
    with db.engine.begin() as connection:
        connection.execute(text("""INSERT INTO participants (id,name,org,intro,hosting,builtin,client_plugins,created_at)
          VALUES ('peer','peer','','','platform',0,'{}',CURRENT_TIMESTAMP)"""))
        connection.execute(text("""INSERT INTO agent_endpoints (id,name,base_url,resource_space,revision,created_at,api_key_enc)
          VALUES ('api','团队医疗系统','http://127.0.0.1:9032','public',7,CURRENT_TIMESTAMP,'CIPHER-CANARY')"""))
        connection.execute(text("""INSERT INTO datasets (id,participant_id,name,description,scenario,task_type,resource_space,
          schema_version,source,count,answered,created_at,agent_id) VALUES
          ('cases','peer','公开病例','','horizontal','medical-diagnosis','public','1.0','upload',54,54,CURRENT_TIMESTAMP,'api')"""))
    upgrade(db)
    with db.engine.connect() as connection:
        agent = connection.execute(text("SELECT owner_id,shared,api_key_enc,revision FROM agent_endpoints")).one()
        data = connection.execute(text("SELECT owner_id,shared,count FROM datasets")).one()
        assert agent == ('shared:api', 1, 'CIPHER-CANARY', 7)
        assert data == ('shared:api', 1, 54)
        assert 'agent_id' not in [row[1] for row in connection.execute(text('PRAGMA table_info(datasets)'))]
        assert connection.execute(text('PRAGMA foreign_key_check')).all() == []
