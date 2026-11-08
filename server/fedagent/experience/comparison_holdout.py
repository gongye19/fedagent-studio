"""按冻结来源核验同一病例是否用于生成经验。"""
import re
from dataclasses import dataclass
from difflib import SequenceMatcher

from sqlalchemy.orm import Session

from ..errors import ServiceError
from ..platform import Platform
from .cases import case_fingerprint, source_sites, training_records
from .comparison_case import SOURCE_SHA256, HeldoutCase

# 已核验扩展版前 107 行与原版逐条相同，两个历史分组分别使用奇数行和偶数行。
SOURCE_OFFSETS = {
    SOURCE_SHA256: (1, 0, 214),
    "1a4397418e6ce9c68b7c85974b79b6171fede7398bcf2c07e6b373e4c2aef36b": (1, 0, 107),
    "53cf0d249a44c14c1487c26b8c26c766632e390eb39d7f61dc3167b8f0fe208e": (2, 0, 54),
    "24a5b868ad80996111704a85823876b7803bf5201d33f24edf6a4e1d128ce361": (2, 1, 53),
}


def _history(record: dict) -> str:
    patient = record.get("patient")
    history = str(patient.get("History", "")) if isinstance(patient, dict) else ""
    return " ".join(re.findall(r"\w+", history.casefold()))


@dataclass(frozen=True)
class TrainingCases:
    source_indices: set[int]
    ids: set[str]
    fingerprints: set[str]
    histories: set[str]

    def overlaps(self, case: HeldoutCase) -> bool:
        record = case.record
        if (case.source_index in self.source_indices
                or str(record["id"]).strip().casefold() in self.ids
                or case_fingerprint(record) in self.fingerprints):
            return True
        history = _history(record)
        if not history:
            return False
        for other in self.histories:
            matcher = SequenceMatcher(None, history, other)
            if matcher.real_quick_ratio() >= 0.92 and matcher.quick_ratio() >= 0.92 and matcher.ratio() >= 0.92:
                return True
        return False


def frozen_training_cases(platform: Platform, session: Session, task_id: str) -> TrainingCases:
    rows = training_records(platform, source_sites(session, task_id))
    if not rows:
        raise ServiceError(409, "缺少冻结的来源记录，无法核验留出病例")
    result = TrainingCases(set(), set(), set(), set())
    for row in rows:
        provenance = row.get("provenance") or {}
        source_hash, index = provenance.get("sourceHash"), provenance.get("sourceIndex")
        if not isinstance(source_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", source_hash) or type(index) is not int or index < 0:
            raise ServiceError(409, "生成记录缺少公开病例来源，无法核验留出病例")
        if known := SOURCE_OFFSETS.get(source_hash):
            stride, offset, count = known
            if index >= count:
                raise ServiceError(409, "生成记录的公开病例索引无效，无法核验留出病例")
            result.source_indices.add(index * stride + offset)
        record = row["input"]
        result.ids.add(str(row["id"]).strip().casefold())
        result.fingerprints.add(case_fingerprint(record))
        if history := _history(record):
            result.histories.add(history)
    return result
