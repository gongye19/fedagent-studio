import json

import pytest
from fedagent_sdk import ChatResult, ModelError

from tools.lifestyle.batch.evaluate import evaluate, summarize
from tools.lifestyle.batch.healthbench import answer_messages, grade_prompt, grader_template, parse_grade, score
from tools.lifestyle.batch.report import report
from tools.lifestyle.common import jsonl, load, save
from tools.lifestyle.model import CachedModel


def fixture(tmp_path):
    inp = tmp_path / "inputs"
    inp.mkdir()
    messages = [
        {"role": "user", "content": "Earlier question"},
        {"role": "assistant", "content": "Earlier answer"},
        {"role": "user", "content": "Latest diet question"},
    ]
    case = {"id": "healthbench:one", "question": "Latest diet question", "messages": messages}
    rubrics = [{"points": 2, "criterion": "PRIOR_RULE", "tags": []}, {"points": -4, "criterion": "NEGATIVE_RULE", "tags": []}]
    jsonl(inp / "evaluation-inputs.jsonl", [case])
    jsonl(inp / "evaluation-references.jsonl", [{"id": case["id"], "rubrics": rubrics}])
    (inp / "grader-source.py").write_text('GRADER_TEMPLATE = """GRADER\n<<conversation>>\n<<rubric_item>>""".strip()')
    manifest = {"fingerprint": "fixture", "protocol": "test", "modelRef": "test:test", "callLimit": 850}
    save(inp / "prepared.json", manifest)
    return manifest, case, rubrics


class Model:
    name = "test"

    def __init__(self, failure=None):
        self.identity = {"model": "test"}
        self.requests = []
        self.rejects = 0
        self.failure = failure

    def chat(self, messages, **settings):
        self.requests.append(messages)
        text = messages[0]["content"]
        if text.startswith("LIFESTYLE_COMPARISON_V1"):
            assert len(messages) == 4 and messages[-1]["content"] == "Latest diet question"
            assert "PRIOR_RULE" not in text and "NEGATIVE_RULE" not in text
            return ChatResult("shared answer" if "library-marker" in text else "base answer", "test")
        assert "Earlier answer" in text and "library-marker" not in text and '"experience"' not in text
        if self.failure == "format":
            self.failure = None
            return ChatResult("bad json", "test")
        if self.failure == "transport" and len(self.requests) == 6:
            self.failure = None
            raise ModelError("test transport")
        return ChatResult(json.dumps({"criteria_met": "NEGATIVE_RULE" not in text, "explanation": "fixture explanation"}), "test")

    def reject_last(self):
        self.rejects += 1


def test_original_prompt_shape_and_signed_negative_scores():
    template = grader_template('GRADER_TEMPLATE = """<<conversation>>\n<<rubric_item>>""".strip()')
    prompt = grade_prompt(template, [{"role": "user", "content": "question"}], "answer", {"points": -3, "criterion": "avoid"})
    assert prompt == "user: question\n\nassistant: answer\n[-3] avoid"
    assert score([{"points": 1}, {"points": -3}], [{"criteria_met": True}, {"criteria_met": True}]) == -2
    assert score([{"points": 1}], [None]) is None
    for text in ['{"criteria_met":1,"explanation":"reason"}', '{"criteria_met":false,"explanation":""}']:
        with pytest.raises(ValueError):
            parse_grade(text)


def test_full_context_pair_order_blind_judge_and_resume(tmp_path):
    manifest, case, _ = fixture(tmp_path)
    model = Model(failure="format")
    values = evaluate(tmp_path, manifest, {"library-marker": "conditional guidance"}, model)
    assert summarize(values)["completePairedCases"] == 1 and model.rejects == 1
    assert len(model.requests) == 7
    # Both answers precede any rubric, then rubric 0 for both arms before rubric 1.
    assert all(r[0]["content"].startswith("LIFESTYLE_COMPARISON_V1") for r in model.requests[:2])
    assert all("PRIOR_RULE" in r[0]["content"] for r in model.requests[2:5])
    assert all("NEGATIVE_RULE" in r[0]["content"] for r in model.requests[5:])
    evaluate(tmp_path, manifest, {"library-marker": "conditional guidance"}, model)
    assert len(model.requests) == 7
    assert answer_messages(case["messages"], {})[1:] == case["messages"]


def test_failed_grade_is_missing_and_resume_keeps_successes(tmp_path):
    manifest, _, _ = fixture(tmp_path)
    model = Model(failure="transport")
    first = evaluate(tmp_path, manifest, {"library-marker": "guidance"}, model)
    assert summarize(first)["incompleteCases"] == 1
    assert summarize(first)["arms"]["without"]["rawMacroScore"] is None
    second = evaluate(tmp_path, manifest, {"library-marker": "guidance"}, model)
    assert summarize(second)["completePairedCases"] == 1 and len(model.requests) == 7


def test_report_escapes_content_and_preserves_missing_denominator(tmp_path, monkeypatch):
    fixture(tmp_path)
    save(tmp_path / "run.json", {"status": "incomplete", "error": "<script>bad()</script>"})
    monkeypatch.setattr("tools.lifestyle.batch.report.plot", lambda *args: None)
    value = report(tmp_path)
    assert value["summary"]["completePairedCases"] == 0
    text = (tmp_path / "report.html").read_text()
    assert "&lt;script&gt;bad()&lt;/script&gt;" in text and "<script>bad()" not in text
    assert value["summary"]["arms"]["shared"]["rawMacroScore"] is None


def test_corrupted_answer_never_reaches_grader(tmp_path):
    manifest, _, _ = fixture(tmp_path)
    model = Model()
    evaluate(tmp_path, manifest, {"library-marker": "guidance"}, model)
    path = tmp_path / "answers/one-shared.json"
    saved = load(path)
    saved["value"] = "changed"
    save(path, saved)
    count = len(model.requests)
    value = evaluate(tmp_path, manifest, {"library-marker": "guidance"}, model)
    assert "unit-checkpoint-corrupted" in value[0]["error"] and len(model.requests) == count
    assert summarize(value)["completePairedCases"] == 0


@pytest.mark.parametrize("stage", ["answer", "grade"])
def test_truncated_answer_or_grade_cannot_spend_again_on_rerun(tmp_path, monkeypatch, stage):
    manifest, _, _ = fixture(tmp_path)
    calls = []

    def remote(body):
        if body.get("inspect"):
            return {"endpoint": "test", "model": "test", "kind": "openai", "baseUrl": "https://test.invalid"}
        calls.append(body)
        answering = body["messages"][0]["content"].startswith("LIFESTYLE_COMPARISON_V1")
        broken = (stage == "answer" and answering) or (stage == "grade" and not answering)
        text = "partial" if broken else "valid answer" if answering else '{"criteria_met":true,"explanation":"ok"}'
        return {"text": text, "finish_reason": "length" if broken else "stop", "model": "test", "usage": {}}

    monkeypatch.setattr("tools.lifestyle.model.remote", remote)
    model = CachedModel(tmp_path, "test:test")
    first = evaluate(tmp_path, manifest, {"entry": "guide"}, model)
    before = len(calls)
    assert summarize(first)["incompleteCases"] == 1 and first[0]["permanentMissing"]
    evaluate(tmp_path, manifest, {"entry": "guide"}, model)
    assert len(calls) == before
