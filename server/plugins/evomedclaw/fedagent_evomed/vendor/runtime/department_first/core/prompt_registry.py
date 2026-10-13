"""Prompt file loader for the department-first variant."""

from __future__ import annotations

from pathlib import Path


class PromptRegistry:
    """Loads prompt templates from the local prompt tree."""

    def __init__(self, prompt_root: Path | None = None):
        runtime_root = Path(__file__).resolve().parents[2]
        self.prompt_root = prompt_root or (runtime_root / "prompts")

    def read(self, category: str, name: str) -> str:
        path = self.prompt_root / category / name
        if not path.exists():
            raise FileNotFoundError(f"Missing prompt file: {path}")
        return path.read_text(encoding="utf-8").strip()
