import json
import shutil

import pytest

from tools.lifestyle.common import load
from tools.lifestyle.diet_trial.evidence import judge_reply, normalize
from tools.lifestyle.diet_trial.evidence_upgrade import upgrade
from tools.lifestyle.diet_trial.prepare import file_hash
from tools.lifestyle.diet_trial.protocol import CRITERIA
from tools.lifestyle.diet_trial.protocol import judge_reply as strict_judge
from tools.lifestyle.diet_trial.recovery import prepare_recovery
from tools.lifestyle.diet_trial.run import run
from tools.lifestyle.diet_trial.verify import verify
from tools.lifestyle.diet_trial_tests.test_diet_recovery import stopped


def sample(evidence):
    source = "半盘蔬菜（任选绿叶菜），四分之一蛋白质。碳水约76克；不能完全禁碳水。"
    cases = [{"id": "case", "answers": {"X": source, "Y": source}}]
    scores = {k: {"pass": True, "evidence": "未发现该风险" if k.startswith("S") else evidence} for k in CRITERIA}
    return json.dumps({"cases": [{"id": "case", "answers": {"X": scores, "Y": scores}}]}, ensure_ascii=False), cases


def test_fragments_restore_whole_source_context_without_changing_scores():
    text, cases = sample("半盘蔬菜，四分之一蛋白质")
    with pytest.raises(ValueError):
        strict_judge(text, cases)
    parsed = judge_reply(text, cases)
    assert parsed["case"]["X"]["U1"] == {"pass": True, "evidence": "半盘蔬菜（任选绿叶菜），四分之一蛋白质"}
    normalized, corrections = normalize(text, cases)
    assert len(corrections) == 8
    before, after = json.loads(text), json.loads(normalized)
    for label in ("X", "Y"):
        assert [v["pass"] for v in before["cases"][0]["answers"][label].values()] == [
            v["pass"] for v in after["cases"][0]["answers"][label].values()
        ]


def test_plus_separated_citation_preserves_parenthesized_examples():
    text, cases = sample("半盘蔬菜＋四分之一蛋白质")
    assert judge_reply(text, cases)["case"]["X"]["U1"]["evidence"] == "半盘蔬菜（任选绿叶菜），四分之一蛋白质"


@pytest.mark.parametrize(
    "evidence", ["碳水约75克；不能完全禁碳水", "可以完全禁碳水；四分之一蛋白质", "四分之一蛋白质；半盘蔬菜", "蔬菜有益；保证血糖正常"]
)
def test_changed_numbers_negations_order_or_invented_text_still_rejected(evidence):
    text, cases = sample(evidence)
    with pytest.raises(ValueError):
        judge_reply(text, cases)


def test_offline_acceptance_uses_earliest_response_and_reuses_all_12_answers(job, remote, monkeypatch):
    directory, _ = job
    stopped(directory, remote)
    initial = prepare_recovery(directory)
    amended = None
    try:
        remote["fragmentedJudge"] = True
        monkeypatch.setattr("tools.lifestyle.diet_trial.run.judge_reply", strict_judge)
        with pytest.raises(ValueError, match="unit-two-failed"):
            run(directory)
        old_stop = load(directory / "recovery/STOP.json")
        before = load(directory / "meter/attempts.json")
        protected = {
            str(p.relative_to(directory)): file_hash(p)
            for folder in ("answers", "judging", "generation")
            for p in (directory / folder).glob("*.json")
        }
        monkeypatch.setattr("tools.lifestyle.diet_trial.run.judge_reply", judge_reply)
        amended = upgrade(directory)
        assert len(load(directory / "meter/attempts.json")) == len(before)
        proof = amended["acceptedResponses"]["judging/batch-1.json"]
        assert proof["file"].startswith("meter/rejected/") and proof["corrections"]
        result = run(directory)
        assert result["attempts"] == len(before) + 2  # 只补剩余两批评分，不重问12份回答或已有评分。
        assert load(directory / "meter/attempts.json")[: len(before)] == before
        assert load(directory / "recovery/STOP.json") == old_stop
        assert all(file_hash(directory / path) == expected for path, expected in protected.items())
        assert verify(directory) == result
    finally:
        shutil.rmtree(initial["backup"])
        if amended:
            shutil.rmtree(amended["evidenceBackup"])


def test_single_missing_case_brace_is_the_only_syntax_change():
    good, cases = sample("半盘蔬菜")
    second = {**cases[0], "id": "case2"}
    value = json.loads(good)
    value["cases"].append({**value["cases"][0], "id": "case2"})
    good = json.dumps(value, ensure_ascii=False)
    boundary = good.index('}, {"id":')
    broken = good[:boundary] + good[boundary + 1 :]
    normalized, corrections = normalize(broken, [*cases, second])
    assert json.loads(normalized) == json.loads(good)
    assert corrections == [{"type": "single-missing-case-close", "position": boundary, "inserted": "}"}]
    assert judge_reply(broken, [*cases, second]) == strict_judge(good, [*cases, second])
    with pytest.raises(ValueError):
        judge_reply(broken.replace('"pass": true', '"pass": tru', 1), [*cases, second])
    with pytest.raises(ValueError):
        judge_reply(broken, cases)  # 不接受多余病例，即使语法可修。


def test_second_offline_upgrade_preserves_both_stops_and_only_calls_last_judge(job, remote, monkeypatch):
    directory, _ = job
    stopped(directory, remote)
    initial = prepare_recovery(directory)
    upgrades = []
    try:
        remote["fragmentedJudge"] = True
        monkeypatch.setattr("tools.lifestyle.diet_trial.run.judge_reply", strict_judge)
        with pytest.raises(ValueError, match="unit-two-failed"):
            run(directory)
        upgrades.append(upgrade(directory))
        remote["malformedJudgeBatch2"] = True

        def no_syntax_repair(text, cases):
            json.loads(text)
            return judge_reply(text, cases)

        monkeypatch.setattr("tools.lifestyle.diet_trial.run.judge_reply", no_syntax_repair)
        with pytest.raises(ValueError, match="unit-two-failed"):
            run(directory)
        prefix = load(directory / "meter/attempts.json")
        stop = load(directory / "recovery/evidence-STOP.json")
        monkeypatch.setattr("tools.lifestyle.diet_trial.run.judge_reply", judge_reply)
        upgrades.append(upgrade(directory))
        result = run(directory)
        assert result["attempts"] == len(prefix) + 1
        assert load(directory / "meter/attempts.json")[: len(prefix)] == prefix
        assert load(directory / "recovery/evidence-STOP.json") == stop
        assert len(upgrades[-1]["acceptedResponses"]) == 2
        proof = upgrades[-1]["acceptedResponses"]["judging/batch-2.json"]
        assert any(c.get("type") == "single-missing-case-close" for c in proof["corrections"])
        assert verify(directory) == result
    finally:
        shutil.rmtree(initial["backup"])
        for revision in upgrades:
            shutil.rmtree(revision["evidenceBackup"])
