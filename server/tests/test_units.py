"""发给一方的消息按固定的顺序读出，和各单元完成的先后无关（续跑和一次跑完读到的一样）。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from fedagent import models as m
from fedagent.platform import Platform
from fedagent.units import inbox, load_sites


def test_inbox_order_does_not_depend_on_completion_order(client: TestClient, platform: Platform) -> None:
    body = {
        "scenario": "horizontal",
        "taskType": "math-reasoning",
        "algorithm": "fot",
        "participants": [{"participantId": "p-a", "datasetId": "ds-aime24"}, {"participantId": "p-b", "datasetId": "ds-aime25"}],
        "clientModel": "fake:fake",
        "serverModel": "fake:fake",
        "rounds": 2,
        "mode": "trial",
        "trialCap": 2,
    }
    task_id = client.post("/v1/tasks", json=body).json()["id"]
    with platform.db.session() as session:
        sites = load_sites(session, task_id)
        server = next(view for view in sites if view.kind == "server")
        first, second = (view for view in sites if view.kind == "participant")
        # 写入的先后：第二方的第 2 条、第一方的第 2 条、第二方的第 1 条、第一方的第 1 条；每条样本发两条
        for view, index in [(second, 1), (first, 1), (second, 0), (first, 0)]:
            for part in ("x", "y"):
                session.add(
                    m.Message(
                        task_id=task_id,
                        round=1,
                        step="extract",
                        channel="trace",
                        sender_site=view.id,
                        sender_role=view.role,
                        receiver_site=server.id,
                        item_id=view.items[index],
                        payload={"name": f"{view.id}/{index}/{part}"},
                        size=1,
                        sha256="0",
                    )
                )
        session.flush()
        names = [message.payload["name"] for message in inbox(session, task_id, server, "trace", 1)]
    assert names == [f"{view.id}/{index}/{part}" for view in (first, second) for index in (0, 1) for part in ("x", "y")]


def test_stale_attempt_cannot_store_over_a_newer_one(client: TestClient, platform: Platform) -> None:
    from fedagent_sdk.context import UnitResult
    from sqlalchemy import select

    from fedagent.units import Graded, store_result

    body = {
        "scenario": "horizontal",
        "taskType": "math-reasoning",
        "algorithm": "fot",
        "participants": [{"participantId": "p-a", "datasetId": "ds-aime24"}, {"participantId": "p-b", "datasetId": "ds-aime25"}],
        "clientModel": "fake:fake",
        "serverModel": "fake:fake",
        "rounds": 2,
        "mode": "trial",
        "trialCap": 1,
    }
    task_id = client.post("/v1/tasks", json=body).json()["id"]
    manifest = platform.registry.algorithm("fot").manifest
    with platform.db.session() as session:
        sites = {view.id: view for view in load_sites(session, task_id)}
        site = next(view for view in sites.values() if view.kind == "participant")
        # 第一次执行领到单元后任务暂停；续跑时同一个单元又被领走（第 2 次尝试）
        unit = m.WorkUnit(task_id=task_id, round=1, step="solve", site_id=site.id, unit_key=site.items[0], executor="platform", status="running", attempts=2)
        session.add(unit)
        session.flush()

        def store(attempt: int) -> bool:
            return store_result(
                session,
                unit=unit,
                manifest=manifest,
                site=site,
                sites=sites,
                result=UnitResult(),
                graded=[Graded(site.items[0], True, False)],
                plugin_version=manifest.version,
                keep_private=True,
                run_dir=None,
                expected="running",
                attempt=attempt,
            )

        assert store(1) is False  # 过期的第 1 次执行回来了：不保存
        assert store(2) is True
        assert store(2) is False  # 已经保存过
        reports = session.scalars(select(m.Report).where(m.Report.task_id == task_id)).all()
    assert sorted(report.name for report in reports) == ["correct", "labeled"]
