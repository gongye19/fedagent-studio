"""数学答案的判分。

- 论文兼容（math-answer）：照搬上游 FoT 实验代码（dixiyao/FoT @ b02753c，experiment/task_benchmark_domain.py
  的 _extract_answer_from_solution、_check_answer_match，以及 math_datasets/livemathbench.py 的 livemathbench_evaluator）。
  这套规则比较宽松（例如数字只要有一个对上就算对），和论文报告的分数口径一致。
- 严格（math-answer-strict）：只认最后一个 \\boxed{} 里的答案，规范化后整体相等，或者都是单个数值且相等。
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping
from fractions import Fraction
from typing import Any

LIVEMATHBENCH = {"AMC", "CCEE", "CNMO", "WLPMC", "V202412Hard", "V202505Hard"}
"""内置题库里来自 LiveMathBench 的几份（样本的 agent 字段），按上游代码用 LiveMathBench 的比对规则。"""


def extract_numbers(text: str) -> list[float]:
    """上游 math_datasets/utils.py：取出所有数字（含小数和负号）。"""
    return [float(value) for value in re.findall(r"-?\d+\.?\d*", text) if value]


def extract_boxed(text: str) -> str | None:
    """最后一个 \\boxed{...} 里的内容，按括号配对。"""
    marker = "\\boxed{"
    start = text.rfind(marker)
    if start == -1:
        return None
    index = start + len(marker)
    depth = 1
    while index < len(text) and depth > 0:
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
        index += 1
    if depth != 0:
        return None
    return text[start + len(marker) : index - 1].strip()


def _number_text(value: float) -> str:
    return str(int(value)) if math.isfinite(value) and value == int(value) else str(value)


_BOXED_PATTERNS = [
    r"\\\(\\boxed\{([^}]+)\}\\\)",
    r"\\\[\\boxed\{([^}]+)\}\\\]",
    r"\\boxed\{([^}]+)\}",
]


def paper_extract(solution: str, dataset: str | None) -> str | None:
    """上游 _extract_answer_from_solution（dataset 为 aime24、aime25、livemathbench 或 None）。"""
    if not solution:
        return None
    boxed = extract_boxed(solution)
    if boxed:
        boxed = boxed.replace("\\,", "").replace("\\:", "").replace("\\;", "")
        return boxed.replace("\\text{", "").replace("}", "")
    for pattern in _BOXED_PATTERNS:
        match = re.search(pattern, solution)
        if match:
            answer = match.group(1).strip().replace("\\,", "").replace("\\:", "").replace("\\;", "")
            return answer.replace("\\text{", "").replace("}", "")
    if "## Answer:" in solution:
        start = solution.find("## Answer:") + len("## Answer:")
        end = solution.find("## End of Answer:")
        if end == -1:
            following = solution.find("##", start)
            end = following if following != -1 else len(solution)
        section = solution[start:end].strip()
        boxed = extract_boxed(section)
        if boxed:
            return boxed
        for pattern in _BOXED_PATTERNS:
            match = re.search(pattern, section)
            if match:
                return match.group(1).strip()
        return section
    if dataset in ("aime24", "aime25"):
        tail = solution[-1000:]
        for pattern in (
            r"(?:the answer is|answer:|final answer:?)\s*\$?([^.$\n]+)\$?",
            r"(?:therefore|thus|so),?\s+(?:the answer is)?\s*\$?([^.$\n]+)\$?",
        ):
            last = None
            for match in re.finditer(pattern, tail, re.IGNORECASE):
                last = match
            if last:
                numbers = extract_numbers(last.group(1).strip().replace("\\,", "").replace("$", ""))
                if numbers:
                    return _number_text(numbers[-1])
    numbers = extract_numbers(solution)
    if numbers:
        return _number_text(numbers[-1])
    lines = [line.strip() for line in solution.split("\n") if line.strip()]
    if lines:
        last = re.sub(r"\.$", "", lines[-1]).replace("\\)", "").replace("\\(", "")
        return last[:100]
    return None


def paper_normalize(answer: str) -> str:
    """上游 _normalize_answer_for_comparison。"""
    if not answer:
        return ""
    answer = answer.replace("$", "").replace("\\(", "").replace("\\)", "")
    answer = answer.replace("\\[", "").replace("\\]", "")
    answer = answer.replace("\\left", "").replace("\\right", "")
    answer = answer.replace("\\dfrac", "\\frac").replace("\\tfrac", "\\frac")
    answer = re.sub(r"\\text\{([^}]+)\}", r"\1", answer)
    answer = re.sub(r"\\displaystyle\s*", "", answer)
    answer = re.sub(r"^\s*[a-zA-Z]\w*\s*=\s*", "", answer)
    answer = re.sub(r"^\s*(?:answer|finalanswer|ans)\s*[:=]\s*", "", answer, flags=re.IGNORECASE)
    answer = re.sub(r"\\frac\{([^}]+)\}\{([^}]+)\}", r"(\1)/(\2)", answer)
    answer = re.sub(r"\s+", "", answer)
    return answer.lower().strip()


def livemathbench_match(prediction: str, truth: str) -> bool:
    """上游 livemathbench_evaluator。"""
    if not prediction or not truth:
        return False
    pred = prediction.strip()
    gold = truth.strip()
    if pred.lower() == gold.lower():
        return True
    for pattern in (r"\\boxed\{([^}]*)\}", r"boxed\(([^)]*)\)", r"\$([^$]*)\$"):
        pred_match = re.search(pattern, pred)
        gold_match = re.search(pattern, gold)
        if pred_match:
            pred = pred_match.group(1)
        if gold_match:
            gold = gold_match.group(1)
    if pred.strip().lower() == gold.strip().lower():
        return True
    pred_numbers = extract_numbers(pred)
    gold_numbers = extract_numbers(gold)
    if pred_numbers and gold_numbers:
        if len(pred_numbers) == 1 and len(gold_numbers) == 1:
            return abs(pred_numbers[0] - gold_numbers[0]) < 1e-6
        if len(pred_numbers) == len(gold_numbers):
            return all(abs(p - g) < 1e-6 for p, g in zip(pred_numbers, gold_numbers, strict=True))
        return abs(pred_numbers[0] - gold_numbers[0]) < 1e-6
    if len(pred) > 1 and len(gold) > 1:
        lower_pred, lower_gold = pred.lower(), gold.lower()
        if lower_pred in lower_gold or lower_gold in lower_pred:
            return True
    choices = ["a", "b", "c", "d", "e"]
    if pred.lower() in choices and gold.lower() in choices:
        return pred.lower() == gold.lower()
    return False


def standard_match(prediction: str, truth: str) -> bool:
    """上游 _check_answer_match 的标准数据集分支。"""
    if not prediction or not truth:
        return False
    normalized_pred = paper_normalize(prediction)
    normalized_gold = paper_normalize(truth)
    if normalized_pred and normalized_gold and normalized_pred == normalized_gold:
        return True
    pred_numbers = extract_numbers(prediction)
    gold_numbers = extract_numbers(truth)
    if pred_numbers and gold_numbers:
        return any(abs(p - g) < 1e-6 for p in pred_numbers for g in gold_numbers)
    return prediction.strip().lower() == truth.strip().lower()


def dataset_of(item: Mapping[str, Any]) -> str | None:
    """样本属于哪个上游数据集（决定用哪套比对规则）；上传的数据集没有这个信息，按通用规则。"""
    agent = str(item.get("agent") or "")
    if agent == "AIME24":
        return "aime24"
    if agent == "AIME25":
        return "aime25"
    if agent in LIVEMATHBENCH:
        return "livemathbench"
    return None


def paper_grade(solution: str, item: Mapping[str, Any]) -> bool:
    truth = item.get("answer")
    if truth is None or str(truth).strip() == "":
        return False
    dataset = dataset_of(item)
    predicted = paper_extract(str(solution or ""), dataset)
    if not predicted:
        return False
    if dataset == "livemathbench":
        return livemathbench_match(predicted, str(truth))
    return standard_match(predicted, str(truth))


# —— 严格口径 ——


def _read_argument(value: str, index: int) -> tuple[str, int] | None:
    while index < len(value) and value[index] == " ":
        index += 1
    if index >= len(value) or value[index] != "{":
        return None
    depth = 0
    for cursor in range(index, len(value)):
        if value[cursor] == "{":
            depth += 1
        elif value[cursor] == "}":
            depth -= 1
            if depth == 0:
                return value[index + 1 : cursor], cursor + 1
    return None


def _rewrite_fractions(value: str) -> str:
    """\\frac{a}{b} → (a)/(b)，支持嵌套括号。"""
    out = []
    index = 0
    while index < len(value):
        if value.startswith("\\frac", index):
            numerator = _read_argument(value, index + 5)
            if numerator:
                denominator = _read_argument(value, numerator[1])
                if denominator:
                    out.append(f"({_rewrite_fractions(numerator[0])})/({_rewrite_fractions(denominator[0])})")
                    index = denominator[1]
                    continue
        out.append(value[index])
        index += 1
    return "".join(out)


def strict_normalize(text: str) -> str:
    value = text.strip()
    value = re.sub(r"\\text\{([^}]*)\}", r"\1", value)
    value = re.sub(r"\\(?:mathrm|textbf|mathbf)\{([^}]*)\}", r"\1", value)
    for old, new in (
        ("\\dfrac", "\\frac"),
        ("\\tfrac", "\\frac"),
        ("\\left", ""),
        ("\\right", ""),
        ("\\!", ""),
        ("\\,", ""),
        ("\\;", ""),
        ("\\:", ""),
        ("$", ""),
        ("\\(", ""),
        ("\\)", ""),
        ("\\[", ""),
        ("\\]", ""),
        ("^\\circ", ""),
        ("^{\\circ}", ""),
    ):
        value = value.replace(old, new)
    value = re.sub(r"\\displaystyle\s*", "", value)
    value = re.sub(r"^\s*[a-zA-Z]\w*\s*=\s*", "", value)
    value = _rewrite_fractions(value)
    value = re.sub(r"\s+", "", value).rstrip(".").lower()
    return value


def _as_number(text: str) -> Fraction | None:
    value = text.replace(",", "")
    match = re.fullmatch(r"\(?(-?\d+(?:\.\d+)?)\)?(?:/\(?(-?\d+(?:\.\d+)?)\)?)?", value)
    if not match:
        return None
    try:
        number = Fraction(match.group(1))
        if match.group(2) is not None:
            denominator = Fraction(match.group(2))
            if denominator == 0:
                return None
            number /= denominator
        return number
    except (ValueError, ZeroDivisionError):
        return None


def strict_grade(solution: str, item: Mapping[str, Any]) -> bool:
    truth = item.get("answer")
    if truth is None or str(truth).strip() == "":
        return False
    boxed = extract_boxed(str(solution or ""))
    if boxed is None:
        return False
    predicted = strict_normalize(boxed)
    gold = strict_normalize(str(truth))
    if not predicted:
        return False
    if predicted == gold:
        return True
    left, right = _as_number(predicted), _as_number(gold)
    return left is not None and right is not None and left == right
