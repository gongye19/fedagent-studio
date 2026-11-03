"""局部纠正归类：保留正确归属，只让模型决定有争议或遗漏的经验归属。"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from typing import Any


@dataclass
class ProfileRepair:
    clusters: list[dict[str, Any]]
    relationships: list[Any]
    pending: dict[str, list[int]]
    missing: int
    duplicates: int
    unknown: int
    removed_relationships: int

    @classmethod
    def from_profile(cls, profile: dict[str, Any] | None, store: dict[str, str]) -> ProfileRepair | None:
        if not profile or profile.get("raw_parse_failed"):
            return None
        groups, links = profile.get("clusters"), profile.get("relationships")
        if not isinstance(groups, list) or not groups or not isinstance(links, list):
            return None
        memberships: dict[str, list[int]] = defaultdict(list)
        unknown: set[str] = set()
        clusters = []
        for index, group in enumerate(groups):
            if not isinstance(group, dict):
                return None
            members = group.get("traces", group.get("insights"))
            if not isinstance(members, list) or not all(isinstance(name, str) for name in members):
                return None
            for name in members:
                if name in store:
                    memberships[name].append(index)
                else:
                    unknown.add(name)
            clusters.append({k: v for k, v in group.items() if k not in ("traces", "insights")} | {"traces": []})
        pending = {}
        missing = duplicates = 0
        for name in store:
            indices = memberships[name]
            if not indices:
                pending[name] = list(range(len(clusters)))
                missing += 1
            elif len(set(indices)) > 1:
                pending[name] = sorted(set(indices))
                duplicates += 1
            else:
                clusters[indices[0]]["traces"].append(name)
                duplicates += int(len(indices) > 1)
        # Do not guess which experience an unknown endpoint was meant to reference.
        relationships = [
            link for link in links if not isinstance(link, dict) or
            all(isinstance(link.get(key), str) and link[key] in store for key in ("trace_a", "trace_b"))
        ]
        return cls(clusters, relationships, pending, missing, duplicates, len(unknown), len(links) - len(relationships))

    def summary(self) -> str:
        return (f"局部修正：重复 {self.duplicates} 条、遗漏 {self.missing} 条、未知编号 {self.unknown} 个；"
                f"移除 {self.removed_relationships} 条无法引用的关系")

    def prompt(self, store: dict[str, str], feedback: str) -> str:
        groups = [{"index": i, "name": g.get("cluster_name"), "theme": g.get("theme")} for i, g in enumerate(self.clusters)]
        items = {
            name: {"description": store[name], "candidate_clusters": choices}
            for name, choices in self.pending.items()
        }
        return (
            "Repair only the listed FoT trace assignments. Keep all other assignments unchanged. "
            "Return one JSON object mapping each listed trace ID to one allowed integer cluster index. "
            "Use the IDs exactly as written; do not return clusters, relationships, or additional keys.\n"
            f"{feedback}\nExisting clusters: {json.dumps(groups, ensure_ascii=False)}\n"
            f"Trace assignments to repair: {json.dumps(items, ensure_ascii=False)}"
        )

    def apply(self, patch: dict[str, Any] | None) -> dict[str, Any] | None:
        patch = patch if patch is not None else {}
        if patch.keys() != self.pending.keys():
            return None
        if any(type(index) is not int or index not in self.pending[name] for name, index in patch.items()):
            return None
        groups = [{**group, "traces": list(group["traces"])} for group in self.clusters]
        for name, index in patch.items():
            groups[index]["traces"].append(name)
        return {"clusters": [group for group in groups if group["traces"]], "relationships": self.relationships}
