"""解析和校验模型回答，规则照抄已审计复现器 run_paper_reproduction.py：

- 解题经验：extract_trace_object（先按 JSON 取，取不到再用正则兜底）+ valid_trace_dict（描述至少 20 个字符，键补成 insight_ 开头）；
- 归类：validate_profile_object（每条经验恰好归入一类、不能引用不存在的经验、至少一条关系）+ normalize_profile_for_library；
- 经验库：validate_library_object（非空对象，键以 insight_ 开头，描述至少 20 个字符，不悄悄修补）。
"""

from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any

from fedagent_sdk.jsonutil import extract_json_object


def extract_trace_object(text: str) -> dict[str, Any] | None:
    parsed = extract_json_object(text)
    if parsed is not None:
        return parsed
    out: dict[str, str] = {}
    pattern = r'"((?:insight|trace)_\w+)"\s*:\s*"((?:[^"\\]|\\.)*)"'
    for name, description in re.findall(pattern, text, flags=re.S):
        try:
            description = json.loads(f'"{description}"')
        except json.JSONDecodeError:
            description = description.replace('\\"', '"').replace("\\n", " ")
        out[name] = re.sub(r"\s+", " ", description).strip()
    return out or None


def valid_trace_dict(value: dict[str, Any] | None) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    out: dict[str, str] = {}
    for key, description in value.items():
        if not isinstance(description, str) or len(description.strip()) < 20:
            continue
        name = str(key)
        if not name.startswith("insight_"):
            name = f"insight_{name}"
        out[name] = description.strip()
    return out


def normalize_profile_for_library(profile: dict[str, Any]) -> dict[str, Any]:
    """Prompt 4 的输出用 traces，Prompt 5 的模板读 insights：补一份。"""
    normalized = json.loads(json.dumps(profile))
    for cluster in normalized.get("clusters", []):
        if not isinstance(cluster, dict):
            continue
        members = cluster.get("traces")
        if isinstance(members, list) and not isinstance(cluster.get("insights"), list):
            cluster["insights"] = list(members)
    return normalized


def validate_profile_object(profile: dict[str, Any] | None, trace_store: dict[str, str]) -> tuple[bool, str]:
    if not isinstance(profile, dict) or profile.get("raw_parse_failed"):
        return False, "profile is missing or marked parse-failed"
    clusters = profile.get("clusters")
    relationships = profile.get("relationships")
    if not isinstance(clusters, list) or not clusters:
        return False, "profile has no clusters"
    if not isinstance(relationships, list) or not relationships:
        return False, "profile has no relationships"
    known = set(trace_store)
    referenced: list[str] = []
    for cluster in clusters:
        if not isinstance(cluster, dict):
            return False, "profile contains a non-object cluster"
        members = cluster.get("traces", cluster.get("insights"))
        if not isinstance(members, list) or not members:
            return False, "profile contains an empty cluster"
        referenced.extend(str(member) for member in members)
    counts = Counter(referenced)
    duplicates = {name for name, count in counts.items() if count != 1}
    if duplicates:
        return False, f"profile assigns {len(duplicates)} traces more than once"
    referenced_set = set(referenced)
    unknown = referenced_set - known
    if unknown:
        return False, f"profile references {len(unknown)} unknown traces"
    missing = known - referenced_set
    if missing:
        return False, f"profile omits {len(missing)} of {len(known)} traces"
    for relationship in relationships:
        if not isinstance(relationship, dict):
            return False, "profile contains a non-object relationship"
        trace_a, trace_b = relationship.get("trace_a"), relationship.get("trace_b")
        if not isinstance(trace_a, str) or not isinstance(trace_b, str) or trace_a not in known or trace_b not in known:
            return False, "profile relationship references an unknown trace"
        if trace_a == trace_b:
            return False, "profile contains a self-relationship"
        if not str(relationship.get("relationship_type", "")).strip():
            return False, "profile relationship is missing its type"
        if not str(relationship.get("description", "")).strip():
            return False, "profile relationship is missing its description"
    return True, "ok"


def validate_library_object(value: dict[str, Any] | None) -> tuple[dict[str, str] | None, str]:
    if not isinstance(value, dict) or not value:
        return None, "Prompt 5 did not return a non-empty JSON object"
    library: dict[str, str] = {}
    for key, description in value.items():
        if not isinstance(key, str) or not key.startswith("insight_"):
            return None, f"Prompt 5 key does not start with insight_: {key!r}"
        if not isinstance(description, str) or len(description.strip()) < 20:
            return None, f"Prompt 5 insight has an invalid description: {key}"
        library[key] = description.strip()
    return library, "ok"


def retry_note(reason: str) -> str:
    """汇总结果不合法、重试时附在提示词后面的说明。复现器的原文没有保存下来，这是平台写的说明。"""
    return f"\n\nYour previous response could not be used: {reason}. Return the complete JSON object again, following the required format exactly."
