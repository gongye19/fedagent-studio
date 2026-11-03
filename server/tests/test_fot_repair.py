"""用故障注入验证超量提取和局部修补不会把坏数据交给下一步。"""

import json
from unittest.mock import Mock

import pytest
from fedagent_fot import FoT
from fedagent_sdk import StepFailed


def test_extract_retries_over_limit_instead_of_uploading_first_three():
    ctx = Mock()
    ctx.params = {"maxTracesPerItem": None}
    ctx.item = {"question": "Solve for x"}
    desc = "A decisive technique with clear conditions."
    too_many = {f"trace_{i}": desc for i in range(4)}
    chosen = {"trace_decisive": desc}
    ctx.model.chat.side_effect = [Mock(text=json.dumps(value)) for value in (too_many, chosen)]
    FoT().extract(ctx)
    first, second = ctx.model.chat.call_args_list
    assert "at most 3 highest-value" in first.args[0]
    assert first.args[0] != second.args[0]
    ctx.send.assert_called_once_with("trace", {"name": "insight_trace_decisive", "description": desc})

    ctx.send.reset_mock()
    ctx.model.chat.side_effect = None
    ctx.model.chat.return_value.text = json.dumps(too_many)
    with pytest.raises(StepFailed, match="最多 3 条"):
        FoT().extract(ctx)
    ctx.send.assert_not_called()


def test_profile_only_repairs_affected_ids_and_keeps_valid_memberships():
    ctx = Mock()
    ctx.params = {}
    store = {name: f"Technique description for {name}" for name in ("stable_a", "stable_b", "dup", "missing")}
    relationship = {"trace_a": "stable_a", "trace_b": "stable_b", "relationship_type": "similar", "description": "Same principle."}
    initial = {
        "clusters": [
            {"cluster_id": 40, "cluster_name": "A", "traces": ["stable_a", "dup"]},
            {"cluster_id": 30, "cluster_name": "B", "traces": ["stable_b", "dup", "mistyped"]},
        ],
        "relationships": [relationship, {**relationship, "trace_a": "mistyped"}],
    }
    ctx.recall.side_effect = [store, dict.fromkeys(store, "p-a")]
    replies = [initial, {"stable_a": 1, "dup": 1, "missing": 0}, {"dup": 1, "missing": 0}]
    ctx.model.chat.side_effect = [Mock(text=json.dumps(value)) for value in replies]
    FoT().profile(ctx)
    first, *repairs = ctx.model.chat.call_args_list
    assert "stable_a" in first.args[0]
    for call in repairs:
        prompt = call.args[0]
        assert all(name not in prompt for name in ("stable_a", "stable_b", "mistyped"))
        assert "dup" in prompt and "missing" in prompt
    key, result = ctx.keep.call_args.args
    assert key == "profile"
    assert [c["traces"] for c in result["clusters"]] == [["stable_a", "missing"], ["stable_b", "dup"]]
    assert [c["cluster_id"] for c in result["clusters"]] == [40, 30]
    assert result["relationships"] == [relationship]


def test_unparseable_profile_pauses_without_regenerating():
    ctx = Mock()
    ctx.params = {}
    ctx.recall.side_effect = [{"x": "technique"}, {"x": "p-a"}]
    ctx.model.chat.return_value.text = "Not JSON"
    with pytest.raises(StepFailed, match="无法局部修正"):
        FoT().profile(ctx)
    assert ctx.model.chat.call_count == 1
    ctx.keep.assert_not_called()
