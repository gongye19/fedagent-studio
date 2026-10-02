"""从模型回答里取出 JSON 对象的通用工具：模型常在 JSON 外面加说明、代码块，或在字符串里写不合法的反斜杠（LaTeX）。"""

from __future__ import annotations

import json
import re
from typing import Any

_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.S)
_VALID_ESCAPES = set('"\\/bfnrtu')


def balanced_object(text: str, start: int) -> str | None:
    """从 start 处的 { 开始，按括号配对取出完整的对象（跳过字符串里的括号）。"""
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def repair_backslashes(text: str) -> str:
    """把 JSON 字符串里不合法的转义（例如 LaTeX 的 \\frac）改成转义的反斜杠。"""
    out: list[str] = []
    in_string = False
    index = 0
    while index < len(text):
        char = text[index]
        if char == '"' and (index == 0 or text[index - 1] != "\\" or _escaped_quote_is_literal(text, index)):
            in_string = not in_string
            out.append(char)
        elif char == "\\" and in_string:
            following = text[index + 1] if index + 1 < len(text) else ""
            if following in _VALID_ESCAPES and following != "u":
                out.append(char + following)
                index += 1
            elif following == "u" and re.match(r"[0-9a-fA-F]{4}", text[index + 2 : index + 6]):
                out.append(char)
            else:
                out.append("\\\\")
        else:
            out.append(char)
        index += 1
    return "".join(out)


def _escaped_quote_is_literal(text: str, index: int) -> bool:
    """引号前的反斜杠个数为偶数时，引号没有被转义。"""
    count = 0
    cursor = index - 1
    while cursor >= 0 and text[cursor] == "\\":
        count += 1
        cursor -= 1
    return count % 2 == 0


def _candidates(text: str) -> list[str]:
    stripped = text.strip()
    found: list[str] = []
    fenced = _FENCE.search(stripped)
    if fenced:
        found.append(fenced.group(1))
    start = stripped.find("{")
    if start != -1:
        balanced = balanced_object(stripped, start)
        if balanced:
            found.append(balanced)
        end = stripped.rfind("}")
        if end > start:
            found.append(stripped[start : end + 1])
    return found


def extract_json_object(text: str) -> dict[str, Any] | None:
    """取出回答里的第一个 JSON 对象；解析失败时先修复反斜杠再试。取不到返回 None。"""
    for candidate in _candidates(text):
        for attempt in (candidate, re.sub(r",\s*([}\]])", r"\1", candidate)):
            for body in (attempt, repair_backslashes(attempt)):
                try:
                    value = json.loads(body)
                except json.JSONDecodeError:
                    continue
                if isinstance(value, dict):
                    return value
    return None
