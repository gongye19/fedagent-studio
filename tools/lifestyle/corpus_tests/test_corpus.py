"""准备阶段的真实数据风险：答案编号、污染、带符号规则和冻结重放。"""

import json
import socket
import subprocess
import sys
import zipfile

import duckdb
import httpx
import pytest

from tools.lifestyle.common import load, rows, save
from tools.lifestyle.corpus import build as builder
from tools.lifestyle.corpus.adapters import HEALTHBENCH_FILE, choice
from tools.lifestyle.corpus.budget import counts
from tools.lifestyle.corpus.fetch import verify
from tools.lifestyle.corpus.split import assert_separated, deduplicate, partition


def item(identifier, question, answer="vegetables", purpose="learn-candidate", source="MedMCQA"):
    return {
        "id": identifier,
        "source": source,
        "question": question,
        "group": identifier,
        "purpose": purpose,
        "reference": {"answerText": answer, "options": ["meat", "vegetables"]},
        "tier": "support-knowledge",
        "site": "supplement",
    }


EMPTY_POLICY = {"healthbench": {}, "reservedDocuments": [], "reservedFocusHashes": []}


@pytest.mark.parametrize(("size", "index"), [(4, 0), (4, 3), (10, 9), (5, 4)])
def test_label_base_and_variable_options(size, index):
    assert choice([str(i) for i in range(size)], index)["answerText"] == str(index)


@pytest.mark.parametrize(("size", "index"), [(4, -1), (4, 4), (10, 10), (1, 0)])
def test_unlabelled_or_out_of_range_never_becomes_correct_answer(size, index):
    with pytest.raises(ValueError):
        choice([str(i) for i in range(size)], index)


def test_conflicting_near_duplicates_quarantine_both():
    a = item("a", "Which dietary changes prevent disease except decrease in carbohydrate intake?", "increase")
    b = item("b", "Which dietary changes prevent disease except decrease in carbohydrate intake ?", "decrease")
    kept, removed, _ = deduplicate([a, b])
    assert not kept
    assert {r["id"] for r in removed} == {"a", "b"}
    assert all(r["reason"] == "conflicting-near-duplicate" for r in removed)


def test_eval_protected_before_training_and_shuffle_deterministic():
    a = item("a", "What foods are suitable in a healthy diet for adults?")
    b = item("b", "What foods are suitable in a healthy diet for adults ?", purpose="knowledge-eval")
    for rs in ([a, b], [b, a]):
        train, evaluation, _, _, removed, _ = partition(rs, EMPTY_POLICY)
        assert not train and [r["id"] for r in evaluation] == ["b"]
        assert removed[0]["reason"] == "overlaps-protected-evaluation"
    with pytest.raises(ValueError, match="近重复"):
        assert_separated([a], [b])
    with pytest.raises(ValueError, match="主题组"):
        assert_separated([a], [{**b, "group": "a"}])


def test_signed_rubric_call_count_not_one_grade_per_case():
    cases = [{"reference": {"rubrics": [{"points": 5}, {"points": -8}, {"points": 1}]}}]
    result = counts(30, cases, sites=3, local=True, mcq=5)
    assert result["generation"] == 98 and result["individualRubricGrades"] == 6
    assert result["total"] == 116


def test_prep_does_not_load_platform_or_model():
    code = (
        "import sys; import tools.lifestyle.corpus.build; "
        "assert not any(k.startswith('fedagent') or k in ('tools.lifestyle.model','tools.lifestyle.runner') for k in sys.modules)"
    )
    subprocess.run([sys.executable, "-c", code], check=True)


def fixtures(tmp_path, monkeypatch):
    directory = tmp_path / "corpus"
    sources = directory / "sources"
    package = tmp_path / "policy"
    sources.mkdir(parents=True)
    package.mkdir()
    (tmp_path / "common.py").write_text("# fixture dependency fingerprint\n")
    for split, cop, exp in [("train", 0, "Source explanation"), ("validation", 1, ""), ("test", -1, "")]:
        raw = {
            "id": split,
            "question": "Which dietary source of iron is recommended?" if split == "train" else "Which dietary fibre sources improve adult health?",
            "opa": "vegetables",
            "opb": "grains",
            "opc": "other",
            "opd": "none",
            "cop": cop,
            "choice_type": "single",
            "exp": exp,
            "subject_name": "Nutrition",
            "topic_name": "Nutrition",
        }
        write_parquet(sources / f"medmcqa-{split}-00000-of-00001.parquet", raw)
    write_parquet(
        sources / "mmlu-test-00000-of-00001.parquet",
        {
            "question_id": 1,
            "category": "health",
            "question": "How much energy can carbohydrate provide?",
            "options": ["a", "b", "c", "d", "e"],
            "answer": "E",
            "answer_index": 4,
            "src": "ori_mmlu-nutrition",
        },
    )
    write_parquet(sources / "mmlu-clean-test-00000-of-00001.parquet", {"question_id": 1})
    (sources / "mmlu-clean-readme.md").write_text('```json\n{"fact_or_stat_that_could_change":[],"unrelated":[],"weird_questions":[]}\n```')
    with zipfile.ZipFile(sources / "medquad.zip", "w") as archive:
        archive.writestr(
            "root/5_NIDDK_QA/123.xml",
            '<Document url="https://example.org"><Focus>Diabetes</Focus><QAPairs><QAPair>'
            '<Question qid="one" qtype="treatment">Diabetes prevention?</Question>'
            "<Answer>You should choose a healthy diet with vegetables.</Answer></QAPair>"
            '<QAPair><Question qid="two">removed</Question><Answer /></QAPair></QAPairs></Document>',
        )
    hb = {
        "prompt_id": "hb",
        "prompt": [{"role": "user", "content": "I want a meal plan with food allergies."}],
        "rubrics": [{"points": 5, "criterion": "Ask for allergies", "tags": []}, {"points": -8, "criterion": "Suggest an allergen", "tags": []}],
    }
    (sources / HEALTHBENCH_FILE).write_text(json.dumps(hb) + "\n")
    save(package / "review-policy.json", {**EMPTY_POLICY, "healthbench": {"hb": "topical-only"}})
    save(package / "calibration.json", {"promptTokensPerCharRange": [0.2, 1]})
    catalog = {
        "duckdb": duckdb.__version__,
        "httpx": httpx.__version__,
        "files": [{"file": f.name, "sha256": builder.hash_file(f), "bytes": f.stat().st_size} for f in sorted(sources.iterdir())],
    }
    save(package / "sources.json", catalog)
    monkeypatch.setattr(builder, "CATALOG", package / "sources.json")
    monkeypatch.setattr(builder, "PACKAGE", package)
    return directory, sources, package


def write_parquet(path, row):
    with duckdb.connect() as connection:
        connection.execute("CREATE TABLE fixture AS SELECT " + ",".join(f"? AS {k}" for k in row), list(row.values()))
        connection.sql("SELECT * FROM fixture").write_parquet(str(path))


def test_offline_build_replay_separation_and_corruption(tmp_path, monkeypatch):
    directory, sources, package = fixtures(tmp_path, monkeypatch)
    monkeypatch.setattr(socket.socket, "connect", lambda *args, **kwargs: pytest.fail("准备阶段不允许联网"))
    first = builder.build(directory)
    second = builder.build(directory)
    assert first == second
    assert first["inventory"]["sources"]["MedMCQA/test"]["unlabelled"] == 1
    inputs = rows(directory / "prepared/evaluation-inputs.jsonl")
    assert all(not ({"rubrics", "answerIndex", "answerText", "reference"} & set(row)) for row in inputs)
    references = rows(directory / "prepared/evaluation-references.jsonl")
    assert next(r for r in references if r["id"] == "healthbench:hb")["rubrics"][1]["points"] == -8
    assert all("rubrics" not in row["reference"] for row in rows(directory / "prepared/generation-candidates.jsonl"))
    policy = load(package / "review-policy.json")
    policy["healthbench"]["hb"] = "changed-audit"
    save(package / "review-policy.json", policy)
    with pytest.raises(ValueError, match="冻结"):
        builder.build(directory)
    target = sources / "medmcqa-train-00000-of-00001.parquet"
    target.write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="摘要"):
        verify(target, first["sourceFiles"]["files"][next(i for i, s in enumerate(first["sourceFiles"]["files"]) if s["file"] == target.name)])
