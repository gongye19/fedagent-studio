"""假模型的回答：格式正确、内容固定（按请求哈希决定），让 FoT 在不调用真实模型时也能跑通全流程。

只用于开发、测试和演示，结果没有意义。
"""

from __future__ import annotations

import json
import re

_TOPICS = ["substitution", "casework", "symmetry", "invariants", "modular", "telescoping", "bounding", "factoring"]


def _number(seed: str, modulo: int) -> int:
    return int(seed[:8], 16) % modulo


def fake_reply(step_id: str | None, prompt: str, seed: str) -> str | None:
    if step_id == "solve" or (step_id is None and prompt.lstrip().startswith(("Problem:", "Available Insights"))):
        return f"We work through the problem step by step and simplify.\n\nTherefore the answer is \\boxed{{{_number(seed, 50)}}}."
    if step_id == "reflect":
        topic = _TOPICS[_number(seed, len(_TOPICS))]
        return (
            "### I. Procedural Knowledge\n- Restate the problem and reduce it with " + topic + ".\n\n"
            "### II. Reusable Techniques and Methods\n- Apply " + topic + " when the structure repeats.\n\n"
            "### III. Critical Insights and Guidelines\n- Verify the final value against the constraints."
        )
    if step_id == "extract":
        first = _TOPICS[_number(seed, len(_TOPICS))]
        second = _TOPICS[_number(seed[8:], len(_TOPICS))]
        traces = {
            f"trace_{first}{seed[:4]}": f"Core idea: use {first} to reduce the problem. When to use: the expression has a repeated structure.",
            f"trace_{second}Check{seed[4:8]}": f"Core idea: confirm the result with {second}. When to use: after finding a candidate answer.",
        }
        return json.dumps(traces)
    if step_id == "profile":
        names = re.findall(r"^- (insight_[\w]+):", prompt, flags=re.M)
        clusters = []
        for index in range(0, len(names), 4):
            members = names[index : index + 4]
            clusters.append({"cluster_id": len(clusters), "cluster_name": f"Group {len(clusters) + 1}", "traces": members, "theme": "Shared technique"})
        relationships = [
            {"trace_a": names[index], "trace_b": names[index + 1], "relationship_type": "complementary", "description": "Used together."}
            for index in range(0, len(names) - 1, 2)
        ]
        return json.dumps({"clusters": clusters, "relationships": relationships})
    if step_id == "library":
        count = 3 + _number(seed, 4)
        library = {
            f"insight_{_TOPICS[index % len(_TOPICS)]}{index + 1}": (
                f"Fake insight {index + 1}: apply {_TOPICS[index % len(_TOPICS)]} when the problem structure allows it."
            )
            for index in range(count)
        }
        return json.dumps(library)
    return None
