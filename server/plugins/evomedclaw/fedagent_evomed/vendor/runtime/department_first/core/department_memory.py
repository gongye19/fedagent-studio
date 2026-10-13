"""Department-scoped memory retrieval."""

from __future__ import annotations

import json
import re
from pathlib import Path
from dataclasses import asdict
from typing import Dict, Iterable, List, Optional

from .types import MemoryEntry


class DepartmentMemoryBank:
    """In-memory validated skill notebook keyed by department."""

    def __init__(self, entries: Optional[Iterable[MemoryEntry]] = None):
        self.entries = list(entries) if entries is not None else self.bootstrap_entries()

    @classmethod
    def from_path(
        cls,
        path: Optional[str],
        include_bootstrap: bool = True,
    ) -> "DepartmentMemoryBank":
        """Builds a memory bank from an optional JSON file."""
        entries: List[MemoryEntry] = []
        if include_bootstrap:
            entries.extend(cls.bootstrap_entries())
        if path:
            entries.extend(cls.load_entries(path))
        return cls(entries=entries)

    @classmethod
    def bootstrap_entries(cls) -> List[MemoryEntry]:
        return [
            MemoryEntry(
                entry_id="ped_torch_rubella_v1",
                department="pediatrics",
                owner_role="specialist",
                stage="department_consult",
                summary="Congenital infection pattern in a newborn with PDA and extra-cardiac findings.",
                guidance=(
                    "When PDA co-occurs with petechiae, cataracts, or failed hearing screening in a newborn, "
                    "prioritize congenital rubella or CMV and recommend TORCH-directed testing before anchoring on a structural syndrome."
                ),
                required_evidence=["newborn", "pda", "hearing"],
                contraindications=["isolated sports trauma"],
                source_cases=[7],
                heldout_success_rate=1.0,
            ),
            MemoryEntry(
                entry_id="gastro_hirschsprung_v1",
                department="gastro_hepatology",
                owner_role="specialist",
                stage="department_consult",
                summary="Neonatal distal obstruction pattern with delayed meconium passage.",
                guidance=(
                    "When bilious vomiting, no meconium passage, and distal obstruction on X-ray co-occur, "
                    "keep Hirschsprung disease high and recommend contrast enema plus rectal suction biopsy."
                ),
                required_evidence=["bilious", "meconium", "obstruction"],
                contraindications=["normal stooling history"],
                source_cases=[13],
                heldout_success_rate=1.0,
            ),
            MemoryEntry(
                entry_id="ortho_jersey_finger_v1",
                department="surgery_orthopedics",
                owner_role="specialist",
                stage="department_consult",
                summary="Finger pull injury with loss of active DIP flexion.",
                guidance=(
                    "When forced extension during active flexion is followed by inability to flex the DIP joint, "
                    "treat flexor digitorum profundus avulsion as the lead diagnosis even if X-ray is normal."
                ),
                required_evidence=["injury", "finger", "tendon"],
                contraindications=["atraumatic warm swollen joint"],
                source_cases=[14],
                heldout_success_rate=1.0,
            ),
            MemoryEntry(
                entry_id="heme_phyllodes_v1",
                department="hematology_oncology",
                owner_role="specialist",
                stage="department_consult",
                summary="Rapidly growing breast mass with leaf-like stromal overgrowth.",
                guidance=(
                    "When a breast biopsy shows leaf-like structures with stromal overgrowth, "
                    "prioritize phyllodes tumor and recommend definitive surgical excision with margin assessment."
                ),
                required_evidence=["mass", "biopsy", "stromal"],
                contraindications=["diffuse inflammatory skin changes without biopsy"],
                source_cases=[8],
                heldout_success_rate=1.0,
            ),
            MemoryEntry(
                entry_id="local_high_yield_tests_v1",
                department="general_internal_medicine",
                owner_role="local_doctor",
                stage="evidence_build",
                summary="Prefer decisive tests over benchmark-unavailable workup.",
                guidance=(
                    "Prefer one decisive, benchmark-supported test over a chain of low-yield normal studies. "
                    "If a pathology clue or classic imaging discriminator is available, ask for that first."
                ),
                required_evidence=[],
                contraindications=[],
                source_cases=[],
                heldout_success_rate=0.8,
            ),
            MemoryEntry(
                entry_id="local_post_consult_weighting_v1",
                department="general_internal_medicine",
                owner_role="local_doctor",
                stage="post_consult_synthesis",
                summary="Hospital opinion should be weighed against objective evidence.",
                guidance=(
                    "After consultation, compare the specialist top diagnosis against existing objective findings before ordering more generic tests. "
                    "Do not ask the patient to repeat the specialist recommendation."
                ),
                required_evidence=[],
                contraindications=[],
                source_cases=[],
                heldout_success_rate=0.8,
            ),
        ]

    @classmethod
    def load_entries(cls, path: str) -> List[MemoryEntry]:
        """Loads additional memory entries from a JSON file."""
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            raw_entries = payload.get("entries", [])
        elif isinstance(payload, list):
            raw_entries = payload
        else:
            raise ValueError("Memory JSON must be a list or an object with an 'entries' field.")

        entries: List[MemoryEntry] = []
        for item in raw_entries:
            if not isinstance(item, dict):
                raise ValueError("Each memory entry must be a JSON object.")
            entries.append(MemoryEntry(**item))
        return entries

    def retrieve(
        self,
        department: str,
        owner_role: str,
        stage: str,
        text: str,
        top_k: int = 2,
    ) -> List[MemoryEntry]:
        tokens = set(self._tokenize(text))
        candidates = []
        for entry in self.entries:
            if entry.owner_role != owner_role:
                continue
            if entry.stage != stage:
                continue
            if entry.department not in {department, "general_internal_medicine"}:
                continue
            required_hits = len(set(entry.required_evidence) & tokens)
            required_floor = max(1, min(2, len(entry.required_evidence)))
            if entry.required_evidence and required_hits < required_floor:
                continue
            if entry.contraindications and set(entry.contraindications) & tokens:
                continue
            score = self._score_entry(entry, tokens)
            candidates.append((score, entry))

        candidates.sort(key=lambda item: item[0], reverse=True)
        return [entry for _, entry in candidates[:top_k] if _ > 0]

    def render_overlay(self, entries: Iterable[MemoryEntry], title: str) -> str:
        rows = list(entries)
        if not rows:
            return ""
        lines = [title]
        for entry in rows:
            lines.append(f"- {entry.guidance}")
            if entry.required_evidence:
                lines.append(f"  Required evidence: {', '.join(entry.required_evidence)}")
            if entry.contraindications:
                lines.append(f"  Avoid when: {', '.join(entry.contraindications)}")
        return "\n".join(lines)

    def to_dict(self) -> Dict[str, List[Dict[str, object]]]:
        return {"entries": [asdict(entry) for entry in self.entries]}

    def _score_entry(self, entry: MemoryEntry, tokens: set[str]) -> float:
        overlap = len(set(entry.required_evidence) & tokens)
        guidance_overlap = len(set(self._tokenize(entry.guidance)) & tokens)
        department_bonus = 0.25 if entry.department != "general_internal_medicine" else 0.1
        return overlap * 1.5 + guidance_overlap * 0.1 + department_bonus + entry.heldout_success_rate * 0.05

    def _tokenize(self, text: str) -> List[str]:
        return re.findall(r"[a-zA-Z_]+", (text or "").lower())
