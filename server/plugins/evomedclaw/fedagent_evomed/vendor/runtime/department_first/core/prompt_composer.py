"""Composable prompt builder."""

from __future__ import annotations

from typing import Iterable, Optional

from .prompt_registry import PromptRegistry


ROLE_TO_BASE = {
    "local_doctor": "local_doctor.md",
    "specialist": "specialist.md",
    "arbiter": "arbiter.md",
}

ROLE_TO_CONTRACT = {
    "local_doctor": "local_output.md",
    "specialist": "specialist_output.md",
    "arbiter": "arbiter_output.md",
}


class PromptComposer:
    """Builds full system prompts from prompt fragments."""

    def __init__(self, registry: PromptRegistry):
        self.registry = registry

    def compose(
        self,
        role: str,
        stage: str,
        department: Optional[str] = None,
        overlays: Optional[Iterable[str]] = None,
    ) -> str:
        if role not in ROLE_TO_BASE:
            raise ValueError(f"Unsupported role: {role}")

        parts = [
            self.registry.read("base", ROLE_TO_BASE[role]),
            self.registry.read("stages", f"{stage}.md"),
        ]
        if department:
            parts.append(self.registry.read("departments", f"{department}.md"))
        for overlay in overlays or ():
            overlay = (overlay or "").strip()
            if overlay:
                parts.append(overlay)
        parts.append(self.registry.read("contracts", ROLE_TO_CONTRACT[role]))
        return "\n\n".join(part for part in parts if part)

