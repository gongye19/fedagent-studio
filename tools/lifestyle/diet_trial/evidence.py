"""片段引文还原成回答中的完整连续原句；不改评分、规则或模型提示。"""

import json
import re

from .protocol import judge_reply as strict_judge_reply


def normalize(text, cases):
    repairs = []
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        # 本次模型在两病例边界漏一个}；只允许这一种单字符、唯一可解析的结构修复。
        candidates = []
        quoted, escaped = False, False
        outside = set()
        for i, char in enumerate(text):
            if not quoted:
                outside.add(i)
            if escaped:
                escaped = False
            elif char == "\\" and quoted:
                escaped = True
            elif char == '"':
                quoted = not quoted
        for match in re.finditer(r',(?=\s*\{\s*"id"\s*:)', text):
            if match.start() not in outside:
                continue
            try:
                parsed = json.loads(text[: match.start()] + "}" + text[match.start() :])
                candidates.append((parsed, match.start()))
            except json.JSONDecodeError:
                continue
        if len(candidates) != 1:
            raise ValueError("judge-json-not-a-unique-single-missing-case-close") from None
        value, position = candidates[0]
        repairs = [{"type": "single-missing-case-close", "position": position, "inserted": "}"}]
    expected = {c["id"]: c for c in cases}
    corrections = repairs
    # 非标准结构仍交给原严格解析器拒绝，不从残缺结果补分。
    if not isinstance(value, dict) or not isinstance(value.get("cases"), list):
        return text, corrections
    for case in value["cases"]:
        if not isinstance(case, dict) or case.get("id") not in expected or not isinstance(case.get("answers"), dict):
            continue
        for label, scores in case["answers"].items():
            if label not in expected[case["id"]]["answers"] or not isinstance(scores, dict):
                continue
            source = expected[case["id"]]["answers"][label]
            for key, score in scores.items():
                if not isinstance(score, dict) or not isinstance(score.get("evidence"), str):
                    continue
                quote = score["evidence"]
                if quote in source:
                    continue
                parts = [p.strip() for p in re.split(r"[，、；;,。\n＋+…“”]", quote) if p.strip()]
                if len(parts) < 2 or any(len(p) < 2 for p in parts):
                    continue
                spans, offset = [], 0
                for part in parts:
                    start = source.find(part, offset)
                    if start < 0:
                        break
                    offset = start + len(part)
                    spans.append([start, offset])
                if len(spans) != len(parts) and key == "U2":
                    # U2是多项事实的列举，不要求引用顺序等于原段落顺序；每项仍必须逐字存在。
                    spans = [[source.find(p), source.find(p) + len(p)] for p in parts]
                    if any(start < 0 for start, _ in spans):
                        spans = []
                if len(spans) != len(parts):
                    continue
                full = source[min(s[0] for s in spans) : max(s[1] for s in spans)]
                if len(full) > 500:
                    continue
                score["evidence"] = full  # 保留被省略的上下文，不拼造新句或删条件。
                corrections.append({"case": case["id"], "label": label, "criterion": key, "raw": quote, "spans": spans, "full": full})
    return json.dumps(value, ensure_ascii=False), corrections


def judge_reply(text, cases):
    normalized, _ = normalize(text, cases)
    return strict_judge_reply(normalized, cases)
