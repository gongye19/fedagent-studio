import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from fedagent import models as m
from fedagent.platform import Platform
from fedagent.seed import BUILTIN, import_fot_bundle, remove_legacy_demo


def legacy(platform: Platform) -> None:
    with platform.db.session() as session:
        session.add(m.Participant(id="p-local-example", name="示例合作方", org="示例机构", hosting="local", builtin=True))
        session.flush()
        session.add(
            m.Dataset(
                id="ds-local-example", participant_id="p-local-example", name="合作方题库", scenario="horizontal", task_type="math-reasoning", source="local"
            )
        )
        row = session.get(m.Participant, "p-a")
        assert row
        row.org = "内置示例"


def bundle(tmp_path: Path) -> Path:
    root = tmp_path / "bundle" / "audited_math_reproduction" / "data"
    root.mkdir(parents=True)
    for _, name, _, _, count in BUILTIN:
        rows = [{"id": str(i), "question": f"fixture {name} {i}", "answer": "1"} for i in range(count)]
        (root / f"{name}.jsonl").write_text("\n".join(json.dumps(row) for row in rows))
    return root.parent.parent


def test_seed_has_only_actual_benchmark_resources(platform: Platform):
    with platform.db.session() as session:
        assert session.scalar(select(func.count()).select_from(m.Participant)) == 8
        assert session.get(m.Participant, "p-local-example") is None
        c = session.get(m.Dataset, "ds-amc")
        assert c and c.count == 46 and c.answered == 46 and c.sample is not None


def test_remove_demo_is_idempotent_and_preserves_actual_resources(platform: Platform):
    legacy(platform)
    report = remove_legacy_demo(platform)
    assert set(report["removed"]) == {"p-local-example", "ds-local-example"}
    assert report["updated"] == ["p-a"]
    assert remove_legacy_demo(platform) == {"updated": [], "removed": []}
    with platform.db.session() as session:
        assert session.get(m.Dataset, "ds-local-example") is None
        assert session.get(m.Dataset, "ds-aime24") is not None
        a = session.get(m.Participant, "p-a")
        assert a and a.org == "平台托管"


def test_remove_demo_refuses_custom_or_populated_data(platform: Platform):
    legacy(platform)
    with platform.db.session() as session:
        d = session.get(m.Dataset, "ds-local-example")
        assert d
        d.item_ids = ["real-case"]
    with pytest.raises(ValueError, match="实际数据"):
        remove_legacy_demo(platform)
    with platform.db.session() as session:
        assert session.get(m.Participant, "p-local-example") is not None
        p = session.get(m.Participant, "p-local-example")
        assert p
        p.name = "真实合作方"
    with pytest.raises(ValueError, match="已修改"):
        remove_legacy_demo(platform)


def test_remove_demo_refuses_task_references(platform: Platform):
    legacy(platform)
    with platform.db.session() as session:
        session.add(
            m.Task(
                id="task-ref",
                name="fixture",
                scenario="horizontal",
                task_type="math-reasoning",
                algorithm="fot",
                plugin_version="1",
                plugin_hash="fixture",
                config={},
                status="completed",
            )
        )
        session.flush()
        session.add(
            m.TaskSite(
                task_id="task-ref", id="p-local-example", ordinal=0, kind="participant", role="participant", executor="client", participant_id="p-local-example"
            )
        )
    with pytest.raises(ValueError, match="已参加任务"):
        remove_legacy_demo(platform)
    with platform.db.session() as session:
        assert session.get(m.Participant, "p-local-example") is not None


def test_import_all_files_and_use_real_preview(platform: Platform, tmp_path: Path):
    root = bundle(tmp_path)
    assert import_fot_bundle(platform, root) == [entry[1] for entry in BUILTIN]
    with platform.db.session() as session:
        for key, name, _, _, count in BUILTIN:
            d = session.get(m.Dataset, f"ds-{key}")
            assert d and d.count == count and d.content_hash and d.sample
            assert d.sample["question"] == f"fixture {name} 0"


@pytest.mark.parametrize("invalid", ["missing", "bad-last-file"])
def test_import_preflight_does_not_partially_replace_data(platform: Platform, tmp_path: Path, invalid: str):
    root = bundle(tmp_path)
    target = root / "audited_math_reproduction" / "data" / "V202505Hard.jsonl"
    if invalid == "missing":
        target.unlink()
    else:
        rows = [{"id": str(i), "question": "fixture"} for i in range(100)]
        rows[-1]["id"] = "0"
        target.write_text("\n".join(json.dumps(row) for row in rows))
    with platform.db.session() as session:
        a = session.get(m.Dataset, "ds-aime24")
        assert a
        original = a.content_hash
        c = session.get(m.Dataset, "ds-amc")
        assert c
        original_c = c.content_hash
    with pytest.raises(ValueError):
        import_fot_bundle(platform, root)
    with platform.db.session() as session:
        a = session.get(m.Dataset, "ds-aime24")
        c = session.get(m.Dataset, "ds-amc")
        assert a and a.content_hash == original
        assert c and c.content_hash == original_c
