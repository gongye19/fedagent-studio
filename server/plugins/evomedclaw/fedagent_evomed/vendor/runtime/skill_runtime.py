"""Adapter: optional semantic tool matching is disabled in this integration.

The original module needs an independent provider SDK; this adapter uses
upstream department-scoped ProcessCard retrieval and the shared model bridge.
"""
class EvoMedSkillRuntime:
    def __init__(self, enabled=False, **kwargs):
        if enabled:
            raise ValueError("当前接入版本不支持独立语义工具匹配")

    def render_guidance(self, memory_bank, state, top_k=4):
        return ""
