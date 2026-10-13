"""Output validation and lightweight parsing helpers."""

from __future__ import annotations

import re
from typing import Iterable, List, Optional

from .types import SpecialistOpinion


SPECIALIST_REQUIRED_SECTIONS = (
    "Assessment",
    "Differential Ranking",
    "Recommended Tests",
    "Red Flags to Exclude",
)


class StructuredOutputVerifier:
    """Validates structured outputs and extracts salient fields."""

    def extract_section(self, text: str, label: str) -> str:
        pattern = re.compile(
            rf"{re.escape(label)}\s*:\s*(.+?)(?=\n[A-Z][A-Za-z \-]+:\s|\Z)",
            flags=re.IGNORECASE | re.DOTALL,
        )
        match = pattern.search(text or "")
        return match.group(1).strip() if match else ""

    def validate_specialist_opinion(self, text: str) -> tuple[bool, List[str]]:
        missing = [
            section for section in SPECIALIST_REQUIRED_SECTIONS
            if not self.extract_section(text, section)
        ]
        return (not missing, missing)

    def extract_top_diagnosis(self, text: str) -> Optional[str]:
        patterns = [
            r"1\.\s*\*\*([^*\n]+)\*\*",
            r"1\.\s*([^\n\-–]+)",
            r"Most Likely Diagnosis\s*:\s*([^\n]+)",
            r"DIAGNOSIS READY:\s*([^\n]+)",
        ]
        for pattern in patterns:
            match = re.search(pattern, text or "", flags=re.IGNORECASE)
            if match:
                candidate = match.group(1).strip(" .:-[]")
                if candidate:
                    return candidate
        return None

    def opinions_conflict(self, opinions: Iterable[SpecialistOpinion]) -> bool:
        diagnoses = {
            self._normalize(self.extract_top_diagnosis(op.raw_opinion) or op.top_diagnosis or "")
            for op in opinions
        }
        diagnoses.discard("")
        return len(diagnoses) > 1

    def normalize_diagnosis_output(self, text: str) -> str:
        text = (text or "").strip()
        if not text:
            return "DIAGNOSIS READY: Most likely working diagnosis"
        if "DIAGNOSIS READY" in text.upper():
            return text
        return f"DIAGNOSIS READY: {text}"

    def _normalize(self, text: str) -> str:
        return re.sub(r"\s+", " ", (text or "").lower()).strip()

