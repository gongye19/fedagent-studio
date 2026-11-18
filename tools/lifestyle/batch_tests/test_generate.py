import json

import pytest
from fedagent_sdk import ChatResult

from tools.lifestyle.batch.generate import generate
from tools.lifestyle.common import load, save


def training():
    return {
        "training": [
            {
                "id": f"{group}-{i:02d}",
                "site": group,
                "input": {"profile": "未提供个人健康资料", "question": f"{group}-{i:02d}如何活动？"},
                "knowledge": {
                    "id": f"unit-{group}-{i}",
                    "documentId": f"doc-{group}-{i}",
                    "fullArticleText": "Original full article. Ask about limitations.",
                    "finalUrl": "https://example.org/guide",
                    "bodySha256": "known",
                    "region": "US",
                    "sourceDates": ["Reviewed 2026"],
                    "reuse": {"license": "public"},
                },
            }
            for group in ("NIH", "CDC", "NHS")
            for i in range(1, 11)
        ]
    }


class Model:
    name = "test"

    def __init__(self):
        self.identity = {"model": "test"}
        self.calls = []
        self.rejects = 0

    def chat(self, messages, **settings):
        data = json.loads(messages[1]["content"])
        self.calls.append(data["id"])
        assert data["knowledge"]["fullArticleText"].startswith("Original full article")
        role = "patient" if data["id"] == "NIH-01" and self.calls.count("NIH-01") == 1 else "advisor"
        return ChatResult(json.dumps({"events": [{"role": role, "content": "确认活动能力和限制。"}], "output": "循序渐进，按个人条件调整。"}), "test")

    def reject_last(self):
        self.rejects += 1


def test_generation_preserves_context_rejects_invented_dialogue_and_resumes(tmp_path):
    model = Model()
    manifest = training()
    records = generate(tmp_path, manifest, model)
    assert all(len(group) == 10 for group in records.values()) and model.rejects == 1 and len(model.calls) == 31
    assert all(row["provenance"]["synthetic"] and row["provenance"]["referenceUsed"] for group in records.values() for row in group)
    generate(tmp_path, manifest, model)
    assert len(model.calls) == 31
    path = tmp_path / "generated/NIH-01.json"
    value = load(path)
    value["value"]["output"] = "changed"
    save(path, value)
    with pytest.raises(ValueError, match="corrupted"):
        generate(tmp_path, manifest, model)
    assert len(model.calls) == 31
