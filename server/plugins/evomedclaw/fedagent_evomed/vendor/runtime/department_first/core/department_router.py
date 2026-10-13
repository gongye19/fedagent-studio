"""Department-first consultation routing."""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from typing import Dict, List, Optional

from fedagent_evomed.vendor.runtime.department_first.standalone import BAgent
from fedagent_evomed.vendor.runtime.department_first.telemetry import timed_operation

from .types import RouteDecision


DEPARTMENT_KEYWORDS: Dict[str, set[str]] = {
    "pediatrics": {
        "newborn", "neonate", "infant", "child", "pediatric", "feeding", "meconium",
        "bilious", "congenital", "development", "screening", "hearing",
    },
    "gastro_hepatology": {
        "abdominal", "distension", "vomiting", "stool", "constipation", "meconium",
        "bowel", "obstruction", "rectal", "jaundice", "ileus",
    },
    "infectious_disease": {
        "fever", "infection", "infectious", "torch", "rubella", "cmv", "viral",
        "bacterial", "sepsis", "antibiotic", "serology",
    },
    "cardiology": {
        "murmur", "pda", "cardiac", "heart", "tachycardia", "chest", "dyspnea",
        "echocardiogram", "cyanosis", "palpitations",
    },
    "neurology": {
        "seizure", "weakness", "numbness", "diplopia", "ataxia", "headache",
        "neuro", "neurologic", "confusion", "paresthesia",
    },
    "hematology_oncology": {
        "mass", "tumor", "biopsy", "bleeding", "bruising", "anemia", "lymphoma",
        "malignancy", "oncology", "leukemia", "stromal",
    },
    "surgery_orthopedics": {
        "trauma", "injury", "fracture", "dislocation", "tendon", "ligament",
        "avulsion", "orthopedic", "finger", "knee", "sports", "flexion",
    },
    "dermatology": {
        "rash", "lesion", "skin", "ulcer", "scale", "papule", "blister", "plaque",
        "eczema", "dermatology",
    },
    "obgyn": {
        "pregnancy", "postpartum", "pelvic", "vaginal", "uterine", "ovarian",
        "cervix", "menses", "obstetric", "gynecologic",
    },
    "rheumatology": {
        "arthritis", "arthralgia", "autoimmune", "vasculitis", "lupus", "inflammatory",
        "joint", "myalgia", "rheumatology", "morning",
    },
    "general_internal_medicine": {
        "fatigue", "malaise", "dyspnea", "cough", "wheezing", "spirometry",
        "obstructive", "smoking", "smoker", "asthma", "copd", "hypertension",
        "diabetes", "metabolic", "renal", "thyroid", "anemia",
    },
    "emergency": {
        "acute", "unstable", "shock", "airway", "hemorrhage", "severe", "emergency",
        "altered", "urgent", "hypotension", "cyanosis",
    },
}

SECTION_WEIGHTS = {
    "Chief Complaint": 3.0,
    "Key Positive Findings": 2.5,
    "Working Differential": 1.75,
    "Specific Question": 1.25,
    "Tests Performed": 0.75,
    "Key Negative Findings": 0.5,
}

SECTION_ORDER = list(SECTION_WEIGHTS.keys())


class DepartmentRouter:
    """Routes structured consultation requests to departments."""

    def __init__(
        self,
        mode: str = "keyword",
        model_name: Optional[str] = None,
    ) -> None:
        self.mode = (mode or "keyword").strip().lower()
        if self.mode not in {"keyword", "llm", "hybrid"}:
            raise ValueError(f"Unsupported router mode: {mode!r}")
        self.model_name = model_name or "mock"
        self.pipe = (
            BAgent(model_name=self.model_name, telemetry_source="llm.department_router")
            if self.mode in {"llm", "hybrid"} else None
        )

    def route(
        self,
        consultation_request: str,
        scenario_id: Optional[int] = None,
    ) -> RouteDecision:
        with timed_operation(
            "step.department_route",
            metadata={
                "scenario_id": scenario_id,
                "router_mode": self.mode,
            },
        ):
            keyword_route = self._route_keyword(consultation_request)
            if self.mode == "keyword":
                return keyword_route
            llm_route = self._route_llm(
                consultation_request,
                keyword_route=keyword_route,
                scenario_id=scenario_id,
            )
            if llm_route is not None:
                return llm_route
            keyword_route.routing_method = "keyword_fallback" if self.mode == "hybrid" else "keyword"
            return keyword_route

    def _route_keyword(self, consultation_request: str) -> RouteDecision:
        sections = self._extract_sections(consultation_request)
        score_breakdown: Dict[str, float] = defaultdict(float)
        reason_map: Dict[str, List[str]] = defaultdict(list)

        for section, text in sections.items():
            if not text:
                continue
            counts = Counter(self._tokenize(text))
            for department, keywords in DEPARTMENT_KEYWORDS.items():
                matches = sorted(token for token in counts if token in keywords)
                if not matches:
                    continue
                section_score = SECTION_WEIGHTS.get(section, 1.0) * sum(counts[token] for token in matches)
                score_breakdown[department] += section_score
                for token in matches[:3]:
                    reason_map[department].append(f"{section}: {token}")

        if not score_breakdown:
            return RouteDecision(
                primary_department="general_internal_medicine",
                confidence=0.2,
                reasons=["Fallback: no department-specific evidence matched."],
                score_breakdown={},
                routing_method="keyword",
            )

        adjusted_scores = self._adjust_scores(dict(score_breakdown))
        ranked = sorted(adjusted_scores.items(), key=lambda item: item[1], reverse=True)
        top_department, top_score = ranked[0]
        second_department = None
        second_score = 0.0
        if len(ranked) > 1:
            second_department, second_score = ranked[1]

        confidence = self._compute_confidence(top_score, second_score)
        should_arbitrate = bool(second_department) and (
            confidence < 0.8
            or top_department == "general_internal_medicine"
            or (top_score - second_score) <= 2.0
        )

        if top_score < 2.0:
            top_department = "general_internal_medicine"
            confidence = min(confidence, 0.35)
            should_arbitrate = False
            second_department = None

        reasons = list(dict.fromkeys(reason_map.get(top_department, [])))
        if second_department and should_arbitrate:
            reasons.append(
                f"Secondary candidate {second_department} remained active "
                f"(score={second_score:.2f} vs top={top_score:.2f})."
            )

        return RouteDecision(
            primary_department=top_department,
            secondary_department=second_department if should_arbitrate else None,
            confidence=confidence,
            reasons=reasons[:8],
            score_breakdown=dict(ranked),
            should_arbitrate=should_arbitrate,
            routing_method="keyword",
        )

    def _route_llm(
        self,
        consultation_request: str,
        keyword_route: RouteDecision,
        scenario_id: Optional[int] = None,
    ) -> Optional[RouteDecision]:
        if self.pipe is None:
            return None
        departments = list(DEPARTMENT_KEYWORDS.keys())
        fallback_json = json.dumps(keyword_route.to_dict(), ensure_ascii=False)
        prompt = (
            "You are choosing which department(s) should handle a structured hospital consultation.\n"
            f"Valid departments: {', '.join(departments)}\n\n"
            "Consultation request:\n"
            f"{consultation_request}\n\n"
            "Keyword-router fallback suggestion:\n"
            f"{fallback_json}\n\n"
            "Return ONLY JSON with this schema:\n"
            "{\n"
            '  "primary_department": "one valid department",\n'
            '  "secondary_department": "another valid department or null",\n'
            '  "confidence": 0.00,\n'
            '  "reasons": ["short reason with exact quoted evidence", "..."],\n'
            '  "score_breakdown": {"department": 0.00, "department2": 0.00},\n'
            '  "should_arbitrate": true\n'
            "}\n\n"
            "Rules:\n"
            "1. Cite exact snippets from the consultation request inside quotes in each reason.\n"
            "2. Only return a secondary department when genuinely distinct cross-specialty evidence remains active.\n"
            "3. If the fallback suggestion is already well supported, you may keep it.\n"
            "4. Confidence must be between 0.15 and 0.95.\n"
            "5. Return JSON only."
        )
        system_prompt = (
            "You are a medical routing controller. "
            "Choose clinically appropriate department routing for a consultation request. "
            "Return only valid JSON."
        )
        raw_response = (
            self.pipe.query_model(
                prompt,
                system_prompt,
                telemetry_metadata={"scenario_id": scenario_id},
            ) or ""
        ).strip()
        payload = self._parse_json_object(raw_response)
        if not payload:
            return None

        primary = str(payload.get("primary_department", "")).strip()
        if primary not in DEPARTMENT_KEYWORDS:
            return None
        secondary_raw = payload.get("secondary_department")
        secondary = str(secondary_raw).strip() if secondary_raw is not None else ""
        if secondary not in DEPARTMENT_KEYWORDS or secondary == primary:
            secondary = None
        confidence = self._clamp_confidence(payload.get("confidence"), fallback=keyword_route.confidence)
        reasons = self._normalize_reasons(payload.get("reasons"), fallback=keyword_route.reasons)
        score_breakdown = self._normalize_score_breakdown(
            payload.get("score_breakdown"),
            primary=primary,
            secondary=secondary,
            fallback=keyword_route.score_breakdown,
            confidence=confidence,
        )
        should_arbitrate = bool(payload.get("should_arbitrate")) and secondary is not None
        return RouteDecision(
            primary_department=primary,
            secondary_department=secondary,
            confidence=confidence,
            reasons=reasons,
            score_breakdown=score_breakdown,
            should_arbitrate=should_arbitrate,
            routing_method="llm",
        )

    def _adjust_scores(self, scores: Dict[str, float]) -> Dict[str, float]:
        """Prevents general medicine from dominating when specialty evidence exists."""
        adjusted = dict(scores)
        gim_score = adjusted.get("general_internal_medicine", 0.0)
        specialty_scores = [
            score for department, score in adjusted.items()
            if department != "general_internal_medicine"
        ]
        top_specialty = max(specialty_scores, default=0.0)
        if gim_score and top_specialty >= 2.5:
            adjusted["general_internal_medicine"] = round(gim_score * 0.6, 3)
        return adjusted

    def _extract_sections(self, text: str) -> Dict[str, str]:
        positions = {}
        for label in SECTION_ORDER:
            match = re.search(rf"{re.escape(label)}\s*:\s*", text, flags=re.IGNORECASE)
            if match:
                positions[label] = match.start()

        ordered = sorted(positions.items(), key=lambda item: item[1])
        sections: Dict[str, str] = {label: "" for label in SECTION_ORDER}
        for index, (label, start) in enumerate(ordered):
            end = len(text)
            if index + 1 < len(ordered):
                end = ordered[index + 1][1]
            block = text[start:end]
            sections[label] = re.sub(rf"^{re.escape(label)}\s*:\s*", "", block, flags=re.IGNORECASE).strip()
        return sections

    def _tokenize(self, text: str) -> List[str]:
        return re.findall(r"[a-zA-Z_]+", (text or "").lower())

    def _compute_confidence(self, top_score: float, second_score: float) -> float:
        if top_score <= 0:
            return 0.2
        margin = (top_score - second_score) / max(top_score + second_score, 1.0)
        confidence = 0.55 + 0.4 * max(0.0, margin)
        if top_score < 4.0:
            confidence -= 0.1
        return round(max(0.15, min(0.95, confidence)), 3)

    def _parse_json_object(self, text: str) -> Optional[Dict[str, object]]:
        if not text:
            return None
        candidates = [text]
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if match:
            candidates.insert(0, match.group(0))
        for candidate in candidates:
            try:
                payload = json.loads(candidate)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                return payload
        return None

    def _clamp_confidence(self, value: object, fallback: float) -> float:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            numeric = float(fallback)
        return round(max(0.15, min(0.95, numeric)), 3)

    def _normalize_reasons(self, value: object, fallback: List[str]) -> List[str]:
        if isinstance(value, list):
            reasons = [str(item).strip() for item in value if str(item).strip()]
            if reasons:
                return reasons[:8]
        return list(fallback[:8])

    def _normalize_score_breakdown(
        self,
        value: object,
        primary: str,
        secondary: Optional[str],
        fallback: Dict[str, float],
        confidence: float,
    ) -> Dict[str, float]:
        if isinstance(value, dict):
            normalized: Dict[str, float] = {}
            for department, score in value.items():
                if department not in DEPARTMENT_KEYWORDS:
                    continue
                try:
                    normalized[str(department)] = round(float(score), 3)
                except (TypeError, ValueError):
                    continue
            if normalized:
                return normalized
        synthesized = {primary: confidence}
        if secondary:
            synthesized[secondary] = round(max(0.15, confidence - 0.1), 3)
        if fallback:
            for department, score in fallback.items():
                synthesized.setdefault(department, float(score))
        return synthesized
