from fedagent_math import MathReasoning, PaperCompatibleGrader, StrictGrader
from fedagent_math.grading import extract_boxed

from fedagent.data import parse_jsonl

PAPER = PaperCompatibleGrader()
STRICT = StrictGrader()


def item(answer: str, agent: str | None = None) -> dict:
    row = {"id": "x", "question": "q", "answer": answer}
    if agent:
        row["agent"] = agent
    return row


def test_extract_boxed_handles_nested_braces() -> None:
    assert extract_boxed("so \\boxed{\\frac{1}{2}} and later \\boxed{2\\sqrt{2}-2}") == "2\\sqrt{2}-2"
    assert extract_boxed("no answer") is None


def test_strict_grader() -> None:
    assert STRICT.grade("The answer is \\boxed{540}.", item("540"))
    assert STRICT.grade("\\boxed{\\dfrac{1}{2}}", item("0.5"))
    assert STRICT.grade("\\boxed{2\\sqrt{2}-2}", item("2\\sqrt{2}-2"))
    assert not STRICT.grade("\\boxed{54}", item("540"))
    assert not STRICT.grade("the answer is 540", item("540"))
    assert not STRICT.grade("\\boxed{540}", item(""))


def test_paper_grader_follows_upstream_rules() -> None:
    # AIME：按上游，数字有一个对上就算对
    assert PAPER.grade("\\boxed{540}", item("540", "AIME24"))
    assert PAPER.grade("Final answer: 70", item("70", "AIME25"))
    # LiveMathBench：多个数字按顺序比对
    assert PAPER.grade("\\boxed{n=18}", item("n=18", "WLPMC"))
    assert not PAPER.grade("\\boxed{17}", item("n=18", "WLPMC"))
    assert not PAPER.grade("", item("1"))


def test_check_rows_same_rules_as_frontend() -> None:
    text = (
        '{"id": 1, "question": "a", "answer": 2}\n\nnot json\n{"id": 1, "question": "b"}\n'
        '{"question": "c"}\n{"id": 3, "question": " "}\n{"id": 4, "question": "d"}\n'
    )
    report = MathReasoning().check(parse_jsonl(text))
    assert report.count == 2 and report.answered == 1
    assert [(issue.line, issue.message) for issue in report.issues] == [
        (3, "不是合法的 JSON，检查引号和逗号"),
        (4, "id 与第 1 行重复"),
        (5, "缺少 id"),
        (6, "缺少 question，或 question 不是文本"),
    ]
    assert not report.ok
    assert report.items[0] == {"id": "1", "question": "a", "answer": "2"}
