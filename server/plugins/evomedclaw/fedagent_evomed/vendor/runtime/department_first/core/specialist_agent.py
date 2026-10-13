"""Department-specialist consultation service."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import replace
import re
import time
from typing import Any, Dict, List, Optional

from fedagent_evomed.vendor.runtime.skill_runtime import EvoMedSkillRuntime
from fedagent_evomed.vendor.runtime.department_first.standalone import BAgent
from fedagent_evomed.vendor.runtime.department_first.telemetry import timed_operation
from fedagent_evomed.vendor.runtime.memory.retrieval import applicable_departments, build_runtime_state

from .arbiter_agent import DepartmentArbiterAgent
from .department_memory import DepartmentMemoryBank
from .department_router import DepartmentRouter
from .prompt_composer import PromptComposer
from .types import ConsultationBundle, RouteDecision, SpecialistOpinion
from .verifier import StructuredOutputVerifier


class DepartmentSpecialistService:
    """Routes, consults, and arbitrates specialist opinions."""

    def __init__(
        self,
        default_model: str,
        prompt_composer: PromptComposer,
        router: DepartmentRouter,
        memory_bank: DepartmentMemoryBank,
        verifier: StructuredOutputVerifier,
        department_model_overrides: Optional[Dict[str, str]] = None,
        specialist_expert_models: Optional[List[str]] = None,
        single_expert_mode: bool = False,
        department_panel_overrides: Optional[Dict[str, List[str]]] = None,
        department_consensus_model: Optional[str] = None,
        arbiter_model: Optional[str] = None,
        strategy_model: Optional[str] = None,
        consultation_mode: str = "multi",
        arbiter_mode: str = "conflict_only",
        secondary_gate_mode: str = "off",
        secondary_gate_min_ratio: float = 0.75,
        secondary_gate_max_primary_confidence: float = 0.8,
        skill_memory_bank: Optional[Dict[str, Any]] = None,
        memory_top_k: int = 4,
        semantic_skill_model: Optional[str] = None,
        semantic_matching_enabled: bool = True,
        config_path: Optional[str] = None,
    ):
        self.default_model = default_model
        self.prompt_composer = prompt_composer
        self.router = router
        self.memory_bank = memory_bank
        self.verifier = verifier
        self.department_model_overrides = dict(department_model_overrides or {})
        self.single_expert_mode = bool(single_expert_mode)
        self.specialist_expert_models = self._normalize_panel_models(
            specialist_expert_models or [default_model],
            fallback_model=default_model,
        )
        self.department_panel_overrides = {
            department: self._normalize_panel_models(models, fallback_model=default_model)
            for department, models in (department_panel_overrides or {}).items()
        }
        self.department_consensus_model = department_consensus_model or self.specialist_expert_models[0]
        self.strategy_model = strategy_model or self.department_consensus_model
        self.consultation_mode = self._normalize_consultation_mode(consultation_mode)
        self.arbiter_mode = self._normalize_arbiter_mode(arbiter_mode)
        self.secondary_gate_mode = self._normalize_secondary_gate_mode(secondary_gate_mode)
        self.secondary_gate_min_ratio = max(float(secondary_gate_min_ratio), 0.0)
        self.secondary_gate_max_primary_confidence = min(
            max(float(secondary_gate_max_primary_confidence), 0.0),
            1.0,
        )
        self.arbiter = DepartmentArbiterAgent(
            model_name=arbiter_model or default_model,
            prompt_composer=prompt_composer,
            verifier=verifier,
        )
        self.consultation_history: list[dict[str, object]] = []
        self._pipes: Dict[str, BAgent] = {}
        self.skill_memory_bank = skill_memory_bank
        self.memory_top_k = memory_top_k
        self.retrieved_guidance = ""
        self.learned_strategy = ""
        self.few_shot_examples = ""
        runtime_model = semantic_skill_model or self.strategy_model
        self.skill_runtime = EvoMedSkillRuntime(
            model_name=runtime_model if runtime_model != "mock" else "mock",
            config_path=config_path,
            enabled=semantic_matching_enabled,
        )

    def set_memory_bank(
        self,
        memory_bank: Optional[Dict[str, Any]],
        top_k: Optional[int] = None,
    ) -> None:
        """Sets the runtime EvoMed skill memory bank used by co-evolve."""
        self.skill_memory_bank = memory_bank
        if top_k is not None:
            self.memory_top_k = top_k

    def route(
        self,
        consultation_request: str,
        scenario_id: Optional[int] = None,
    ) -> RouteDecision:
        return self.router.route(consultation_request, scenario_id=scenario_id)

    def system_prompt(self) -> str:
        """Builds a generic hospital-side prompt for co-evolve strategy generation."""
        base_prompt = self.prompt_composer.compose(
            role="specialist",
            stage="department_consult",
            department="general_internal_medicine",
        )
        return self._augment_specialist_system_prompt(base_prompt)

    def query_strategy(self, prompt: str, system_prompt: str) -> str:
        """Queries the strategy model for co-evolve role exchange."""
        pipe = self._pipe_for_model(self.strategy_model)
        return pipe.query_model(
            prompt,
            system_prompt,
            telemetry_source="llm.specialist_strategy",
        )

    def consult(
        self,
        anonymized_case: str,
        scenario_id: int = 0,
        route_decision: Optional[RouteDecision] = None,
    ) -> ConsultationBundle:
        route_decision = route_decision or self.route(anonymized_case, scenario_id=scenario_id)
        route_decision = self._apply_consultation_mode(route_decision)
        route_decision = self._apply_secondary_gate(route_decision)
        retrieved_guidance = self._refresh_retrieved_guidance(
            anonymized_case=anonymized_case,
            scenario_id=scenario_id,
        )
        opinions = []
        for department in route_decision.departments():
            entries = self.memory_bank.retrieve(
                department=department,
                owner_role="specialist",
                stage="department_consult",
                text=anonymized_case,
                top_k=2,
            )
            overlay = self.memory_bank.render_overlay(
                entries,
                title="Department memory: validated specialty cues",
            )
            system_prompt = self._build_specialist_system_prompt(
                department,
                overlay,
                retrieved_guidance=retrieved_guidance,
            )
            prompt = (
                f"Anonymized case:\n{anonymized_case}\n\n"
                f"Assigned department: {department}\n"
                "Provide a specialty consultation from this department only. "
                "If cross-specialty escalation is required, state it explicitly in the final section."
            )
            opinion_text, panel_models, expert_opinions, consensus_model = self._query_department_panel(
                prompt=prompt,
                system_prompt=system_prompt,
                department=department,
                anonymized_case=anonymized_case,
                scenario_id=scenario_id,
            )
            top_diagnosis = self.verifier.extract_top_diagnosis(opinion_text)
            opinions.append(
                SpecialistOpinion(
                    department=department,
                    model_name=consensus_model,
                    raw_opinion=opinion_text,
                    memory_ids=[entry.entry_id for entry in entries],
                    top_diagnosis=top_diagnosis,
                    expert_models=panel_models,
                    expert_opinions=expert_opinions,
                    consensus_model=consensus_model,
                )
            )

        arbiter_used = False
        final_opinion = next((op.raw_opinion for op in opinions if op.raw_opinion.strip()), "")
        if self._should_run_arbiter(route_decision, opinions):
            final_opinion = self.arbiter.arbitrate(
                anonymized_case,
                route_decision,
                opinions,
                scenario_id=scenario_id,
            )
            arbiter_used = True
        if not final_opinion.strip() and opinions:
            final_opinion = self._fallback_opinion(
                anonymized_case=anonymized_case,
                department=opinions[0].department,
            )

        bundle = ConsultationBundle(
            scenario_id=scenario_id,
            consultation_request=anonymized_case,
            route_decision=route_decision,
            opinions=opinions,
            final_opinion=final_opinion,
            arbiter_used=arbiter_used,
        )
        self.consultation_history.append(bundle.to_dict())
        return bundle

    def _normalize_consultation_mode(self, mode: str) -> str:
        cleaned = (mode or "multi").strip().lower()
        if cleaned not in {"single", "multi"}:
            raise ValueError(f"Unsupported consultation_mode: {mode!r}")
        return cleaned

    def _normalize_arbiter_mode(self, mode: str) -> str:
        cleaned = (mode or "conflict_only").strip().lower()
        if cleaned not in {"off", "conflict_only", "always_if_multi"}:
            raise ValueError(f"Unsupported arbiter_mode: {mode!r}")
        return cleaned

    def _normalize_secondary_gate_mode(self, mode: str) -> str:
        cleaned = (mode or "off").strip().lower()
        if cleaned not in {"off", "conservative"}:
            raise ValueError(f"Unsupported secondary_gate_mode: {mode!r}")
        return cleaned

    def _apply_consultation_mode(self, route_decision: RouteDecision) -> RouteDecision:
        if self.consultation_mode != "single":
            return route_decision
        return replace(
            route_decision,
            secondary_department=None,
            should_arbitrate=False,
        )

    def _apply_secondary_gate(self, route_decision: RouteDecision) -> RouteDecision:
        if self.secondary_gate_mode == "off":
            return self._with_secondary_gate_metadata(
                route_decision,
                status="off",
                reason="Secondary gate disabled; preserving original routing behavior.",
            )

        secondary_department = route_decision.secondary_department
        if not secondary_department or secondary_department == route_decision.primary_department:
            return self._with_secondary_gate_metadata(
                route_decision,
                status="not_applicable",
                reason="No distinct secondary department remained after consultation-mode filtering.",
            )

        primary_score = self._route_score_for_department(
            route_decision,
            route_decision.primary_department,
            fallback=route_decision.confidence,
        )
        secondary_score = self._route_score_for_department(
            route_decision,
            secondary_department,
            fallback=max(primary_score - 0.1, 0.0),
        )
        ratio = round(
            secondary_score / primary_score,
            3,
        ) if primary_score > 0 else 0.0

        keep_secondary = (
            ratio >= self.secondary_gate_min_ratio
            and route_decision.confidence <= self.secondary_gate_max_primary_confidence
        )
        if keep_secondary:
            return self._with_secondary_gate_metadata(
                route_decision,
                status="kept",
                reason=(
                    "Kept secondary branch because the route remained cross-specialty ambiguous "
                    f"(ratio={ratio:.3f} >= {self.secondary_gate_min_ratio:.3f}, "
                    f"confidence={route_decision.confidence:.3f} <= "
                    f"{self.secondary_gate_max_primary_confidence:.3f})."
                ),
                primary_score=primary_score,
                secondary_score=secondary_score,
                secondary_to_primary_ratio=ratio,
            )

        failure_reasons: List[str] = []
        if ratio < self.secondary_gate_min_ratio:
            failure_reasons.append(
                f"secondary/primary ratio {ratio:.3f} < {self.secondary_gate_min_ratio:.3f}"
            )
        if route_decision.confidence > self.secondary_gate_max_primary_confidence:
            failure_reasons.append(
                "primary confidence "
                f"{route_decision.confidence:.3f} > {self.secondary_gate_max_primary_confidence:.3f}"
            )
        pruned_route = replace(
            route_decision,
            secondary_department=None,
            should_arbitrate=False,
        )
        return self._with_secondary_gate_metadata(
            pruned_route,
            status="pruned",
            reason=(
                "Pruned secondary branch because "
                + " and ".join(failure_reasons)
                + "."
            ),
            primary_score=primary_score,
            secondary_score=secondary_score,
            secondary_to_primary_ratio=ratio,
        )

    def _with_secondary_gate_metadata(
        self,
        route_decision: RouteDecision,
        *,
        status: str,
        reason: str,
        primary_score: Optional[float] = None,
        secondary_score: Optional[float] = None,
        secondary_to_primary_ratio: Optional[float] = None,
    ) -> RouteDecision:
        metadata = dict(route_decision.metadata or {})
        gate_payload: Dict[str, Any] = {
            "mode": self.secondary_gate_mode,
            "status": status,
            "reason": reason,
            "thresholds": {
                "min_ratio": round(self.secondary_gate_min_ratio, 3),
                "max_primary_confidence": round(self.secondary_gate_max_primary_confidence, 3),
            },
        }
        if primary_score is not None:
            gate_payload["primary_score"] = round(primary_score, 3)
        if secondary_score is not None:
            gate_payload["secondary_score"] = round(secondary_score, 3)
        if secondary_to_primary_ratio is not None:
            gate_payload["secondary_to_primary_ratio"] = round(secondary_to_primary_ratio, 3)
        metadata["secondary_gate"] = gate_payload
        return replace(route_decision, metadata=metadata)

    def _route_score_for_department(
        self,
        route_decision: RouteDecision,
        department: str,
        fallback: float,
    ) -> float:
        try:
            return float(route_decision.score_breakdown.get(department, fallback))
        except (TypeError, ValueError, AttributeError):
            return float(fallback)

    def _should_run_arbiter(
        self,
        route_decision: RouteDecision,
        opinions: List[SpecialistOpinion],
    ) -> bool:
        if self.arbiter_mode == "off":
            return False
        if len(opinions) <= 1 or not route_decision.secondary_department:
            return False
        if self.arbiter_mode == "always_if_multi":
            return True
        diagnoses: List[str] = []
        for opinion in opinions:
            valid, _ = self.verifier.validate_specialist_opinion(opinion.raw_opinion)
            top_diagnosis = opinion.top_diagnosis or self.verifier.extract_top_diagnosis(opinion.raw_opinion) or ""
            normalized = re.sub(r"\s+", " ", top_diagnosis.lower()).strip()
            if not valid or not normalized:
                return False
            diagnoses.append(normalized)
        return len(set(diagnoses)) > 1

    def _normalize_panel_models(self, models: List[str], fallback_model: str) -> List[str]:
        """Expands a model list into a fixed three-expert panel."""
        cleaned = [model.strip() for model in models if model and model.strip()]
        if not cleaned:
            cleaned = [fallback_model]
        while len(cleaned) < 3:
            cleaned.append(cleaned[-1])
        return cleaned[:3]

    def _augment_specialist_system_prompt(
        self,
        base_prompt: str,
        extra_guidance: str = "",
    ) -> str:
        blocks = []
        if extra_guidance.strip():
            blocks.append(extra_guidance.strip())
        if self.learned_strategy.strip():
            blocks.append(f"Learned Strategy:\n{self.learned_strategy.strip()}")
        if self.few_shot_examples.strip():
            blocks.append(f"Reference Cases:\n{self.few_shot_examples.strip()}")
        if not blocks:
            return base_prompt
        return f"{base_prompt}\n\n" + "\n\n".join(blocks)

    def _build_specialist_system_prompt(
        self,
        department: str,
        overlay: str,
        retrieved_guidance: str = "",
    ) -> str:
        """Builds a specialist prompt with a hard MedSim-style output contract."""
        prompt = self.prompt_composer.compose(
            role="specialist",
            stage="department_consult",
            department=department,
            overlays=[overlay],
        )
        contract = (
            "RULES:\n"
            "1. Provide your assessment in this EXACT format:\n"
            "   OPINION:\n"
            "   Assessment: [1-2 sentences summarizing the case]\n"
            "   Differential Ranking: [ordered list of 3-5 diagnoses with brief rationale]\n"
            "   Recommended Tests: [specific tests to confirm or exclude the top diagnoses]\n"
            "   Red Flags to Exclude: [critical conditions that must still be ruled out]\n"
            "   Need Cross-Specialty Escalation: [yes/no, with one short reason]\n"
            "2. Do NOT ask questions. You cannot communicate with the patient.\n"
            "3. Stay within the assigned department's perspective and name exact diseases.\n"
            "4. Use the consult request's working differential and state where you agree or disagree.\n"
            "5. If evidence is limited, still provide the best-ranked working diagnoses instead of refusing.\n"
            "6. Output only the structured OPINION.\n"
        )
        return self._augment_specialist_system_prompt(
            f"{prompt}\n\n{contract}",
            extra_guidance=retrieved_guidance,
        )

    def _refresh_retrieved_guidance(self, anonymized_case: str, scenario_id: int) -> str:
        """Renders EvoMed skill guidance learned by co-evolve."""
        if not self.skill_memory_bank:
            self.retrieved_guidance = ""
            return ""
        state = build_runtime_state(
            scenario_id=scenario_id,
            owner_role="HospitalAgent",
            dialogue_text=anonymized_case,
            question_count=0,
            tests_done=[],
            has_hospital_opinion=False,
            uncertainty=0.5,
            stage="consult",
        )
        with timed_operation(
            "step.semantic_guidance_specialist",
            metadata={"scenario_id": scenario_id},
        ):
            self.retrieved_guidance = self.skill_runtime.render_guidance(
                self.skill_memory_bank,
                state,
                top_k=self.memory_top_k,
            )
        return self.retrieved_guidance

    def _query_department_panel(
        self,
        prompt: str,
        system_prompt: str,
        department: str,
        anonymized_case: str,
        scenario_id: int,
    ) -> tuple[str, List[str], List[str], str]:
        """Queries a three-expert department panel, then synthesizes consensus."""
        with timed_operation(
            "step.department_panel",
            metadata={
                "scenario_id": scenario_id,
                "department": department,
            },
        ):
            expert_models = self._expert_models_for_department(department)
            expert_opinions: List[str] = []
            for index, model_name in enumerate(expert_models, start=1):
                expert_prompt = (
                    f"{prompt}\n\n"
                    f"Department expert {index} model: {model_name}\n"
                    "Provide your own structured opinion before seeing any consensus."
                )
                opinion = self._query_specialist(
                    model_name=model_name,
                    prompt=expert_prompt,
                    system_prompt=system_prompt,
                    department=department,
                    anonymized_case=anonymized_case,
                    scenario_id=scenario_id,
                    expert_index=index,
                )
                expert_opinions.append(opinion)

            consensus_model = self._consensus_model_for_department(department)
            final_opinion = expert_opinions[0]
            if len(expert_opinions) > 1:
                final_opinion = self._query_department_consensus(
                    anonymized_case=anonymized_case,
                    department=department,
                    system_prompt=system_prompt,
                    expert_models=expert_models,
                    expert_opinions=expert_opinions,
                    consensus_model=consensus_model,
                    scenario_id=scenario_id,
                )
            if not final_opinion.strip():
                final_opinion = self._fallback_opinion(
                    anonymized_case=anonymized_case,
                    department=department,
                )
            return final_opinion, expert_models, expert_opinions, consensus_model

    def _query_specialist(
        self,
        model_name: str,
        prompt: str,
        system_prompt: str,
        department: str,
        anonymized_case: str,
        scenario_id: int,
        expert_index: int,
    ) -> str:
        pipe = self._pipe_for_model(model_name)
        prompts = [
            prompt,
            (
                f"{prompt}\n\n"
                "Respond again. Output only the exact OPINION format with Assessment, "
                "Differential Ranking, Recommended Tests, Red Flags to Exclude, and "
                "Need Cross-Specialty Escalation."
            ),
        ]
        for attempt, candidate_prompt in enumerate(prompts, start=1):
            answer = (
                pipe.query_model(
                    candidate_prompt,
                    system_prompt,
                    telemetry_source="llm.specialist_expert",
                    telemetry_metadata={
                        "scenario_id": scenario_id,
                        "department": department,
                        "expert_index": expert_index,
                        "expert_attempt": attempt,
                    },
                ) or ""
            ).strip()
            valid, _ = self.verifier.validate_specialist_opinion(answer)
            if answer and valid:
                return answer
            if attempt < len(prompts):
                time.sleep(1.0)
        return self._fallback_opinion(anonymized_case=anonymized_case, department=department)

    def _query_department_consensus(
        self,
        anonymized_case: str,
        department: str,
        system_prompt: str,
        expert_models: List[str],
        expert_opinions: List[str],
        consensus_model: str,
        scenario_id: int,
    ) -> str:
        """Synthesizes a single department opinion from expert panel outputs."""
        rendered = []
        for index, (model_name, opinion) in enumerate(zip(expert_models, expert_opinions), start=1):
            rendered.append(
                f"Expert {index} ({model_name}) opinion:\n{opinion}"
            )
        consensus_prompt = (
            f"Anonymized case:\n{anonymized_case}\n\n"
            f"Assigned department: {department}\n\n"
            "Department expert opinions:\n"
            + "\n\n---\n\n".join(rendered)
            + "\n\nSynthesize these same-department expert opinions into one structured OPINION. "
            "Resolve disagreements by clinical evidence strength and keep only decisive next tests."
        )
        consensus_system_prompt = (
            f"{system_prompt}\n\n"
            "You are the department consensus synthesizer. "
            "Read the expert panel outputs and return one final structured OPINION only."
        )
        pipe = self._pipe_for_model(consensus_model)
        prompts = [
            consensus_prompt,
            (
                f"{consensus_prompt}\n\n"
                "Respond again using only the exact OPINION format."
            ),
        ]
        for attempt, candidate_prompt in enumerate(prompts, start=1):
            answer = (
                pipe.query_model(
                    candidate_prompt,
                    consensus_system_prompt,
                    telemetry_source="llm.specialist_consensus",
                    telemetry_metadata={
                        "scenario_id": scenario_id,
                        "department": department,
                        "consensus_attempt": attempt,
                    },
                ) or ""
            ).strip()
            valid, _ = self.verifier.validate_specialist_opinion(answer)
            if answer and valid:
                return answer
            if attempt < len(prompts):
                time.sleep(1.0)
        for opinion in expert_opinions:
            if opinion.strip():
                return opinion
        return self._fallback_opinion(anonymized_case=anonymized_case, department=department)

    def _fallback_opinion(self, anonymized_case: str, department: str) -> str:
        """Builds a deterministic structured opinion when the model fails."""
        chief_complaint = self._extract_section(anonymized_case, "Chief Complaint")
        positives = self._extract_bullets(
            self._extract_section(anonymized_case, "Key Positive Findings")
        )
        differential = self._extract_ranked_items(
            self._extract_section(anonymized_case, "Working Differential")
        )
        recommended_tests = self._default_tests_for_department(department)
        red_flags = self._default_red_flags_for_department(department)

        assessment_parts = []
        if chief_complaint:
            assessment_parts.append(chief_complaint)
        if positives:
            assessment_parts.append(f"Key findings include {', '.join(positives[:3])}.")
        assessment = (
            " ".join(assessment_parts)
            or "Department review is based on the available anonymized consultation summary."
        )

        if not differential:
            differential = ["Most likely working diagnosis from current evidence"]
        differential_lines = [
            f"{index}. {item} - prioritized from the current consultation summary."
            for index, item in enumerate(differential[:3], start=1)
        ]
        test_lines = [f"- {test}" for test in recommended_tests]
        red_flag_lines = [f"- {item}" for item in red_flags]
        return (
            "OPINION:\n"
            f"Assessment: {assessment}\n"
            "Differential Ranking:\n"
            + "\n".join(differential_lines)
            + "\nRecommended Tests:\n"
            + "\n".join(test_lines)
            + "\nRed Flags to Exclude:\n"
            + "\n".join(red_flag_lines)
            + "\nNeed Cross-Specialty Escalation: yes, if decisive findings point away from "
            + department.replace("_", " ")
            + "."
        )

    def _extract_section(self, text: str, label: str) -> str:
        pattern = re.compile(
            rf"{re.escape(label)}\s*:\s*(.+?)(?=\n[A-Z][A-Za-z \-]+:\s|\Z)",
            flags=re.IGNORECASE | re.DOTALL,
        )
        match = pattern.search(text or "")
        return match.group(1).strip() if match else ""

    def _extract_bullets(self, text: str) -> list[str]:
        bullets = []
        for raw_line in (text or "").splitlines():
            line = raw_line.strip(" -*")
            if line:
                bullets.append(line)
        return bullets

    def _extract_ranked_items(self, text: str) -> list[str]:
        items = []
        for raw_line in (text or "").splitlines():
            cleaned = re.sub(r"^\d+\.\s*", "", raw_line).strip(" -*")
            if cleaned:
                items.append(cleaned)
        return items

    def _default_tests_for_department(self, department: str) -> list[str]:
        defaults = {
            "cardiology": ["ECG", "echocardiogram", "cardiac biomarkers when clinically indicated"],
            "dermatology": ["Focused skin exam", "skin scraping or biopsy if morphology is unclear"],
            "emergency": ["Immediate stabilization assessment", "urgent imaging or labs guided by instability"],
            "gastro_hepatology": ["Targeted abdominal imaging", "liver panel or endoscopic evaluation as indicated"],
            "general_internal_medicine": ["Most decisive confirmatory test for the top diagnosis", "basic imaging or lab review only if it changes management"],
            "hematology_oncology": ["Peripheral smear or pathology review", "targeted biopsy or staging studies"],
            "infectious_disease": ["Directed cultures or PCR", "source-focused imaging if needed"],
            "neurology": ["Focused neurologic exam", "MRI or electrodiagnostic testing as indicated"],
            "obgyn": ["Pregnancy testing when relevant", "pelvic imaging or targeted gynecologic evaluation"],
            "pediatrics": ["Age-appropriate confirmatory testing", "review newborn or developmental screening data"],
            "rheumatology": ["Inflammatory markers", "autoantibody testing only when it changes the ranking"],
            "surgery_orthopedics": ["Targeted X-ray or MRI", "focused tendon or ligament exam"],
        }
        return defaults.get(
            department,
            ["Most decisive confirmatory test for the leading diagnosis"],
        )

    def _default_red_flags_for_department(self, department: str) -> list[str]:
        defaults = {
            "cardiology": ["Acute coronary syndrome", "decompensated heart failure", "malignant arrhythmia"],
            "dermatology": ["Stevens-Johnson syndrome or TEN", "necrotizing soft tissue infection"],
            "emergency": ["Shock", "airway compromise", "rapid clinical deterioration"],
            "gastro_hepatology": ["Bowel ischemia or perforation", "ascending cholangitis", "massive GI bleeding"],
            "general_internal_medicine": ["Pulmonary embolism", "severe infection", "occult malignancy"],
            "hematology_oncology": ["Acute leukemia complications", "neutropenic sepsis", "tumor lysis syndrome"],
            "infectious_disease": ["Sepsis", "meningitis", "rapidly progressive opportunistic infection"],
            "neurology": ["Stroke", "spinal cord compression", "status epilepticus"],
            "obgyn": ["Ectopic pregnancy", "ovarian torsion", "septic abortion"],
            "pediatrics": ["Sepsis", "child abuse or neglect when relevant", "rapid dehydration"],
            "rheumatology": ["Giant cell arteritis", "diffuse alveolar hemorrhage", "rapidly progressive vasculitis"],
            "surgery_orthopedics": ["Compartment syndrome", "open fracture", "septic joint"],
        }
        return defaults.get(department, ["Immediate life-threatening alternative diagnoses"])

    def _pipe_for_model(self, model_name: str) -> BAgent:
        if model_name not in self._pipes:
            self._pipes[model_name] = BAgent(model_name=model_name, telemetry_source="llm.specialist")
        return self._pipes[model_name]

    def _model_for_department(self, department: str) -> str:
        return self.department_model_overrides.get(department, self.default_model)

    def _expert_models_for_department(self, department: str) -> List[str]:
        if self.single_expert_mode:
            if department in self.department_panel_overrides:
                return [self.department_panel_overrides[department][0]]
            override = self.department_model_overrides.get(department)
            if override:
                return [override]
            return [self.specialist_expert_models[0]]
        if department in self.department_panel_overrides:
            return self.department_panel_overrides[department]
        override = self.department_model_overrides.get(department)
        if override:
            return self._normalize_panel_models([override], fallback_model=override)
        return list(self.specialist_expert_models)

    def _consensus_model_for_department(self, department: str) -> str:
        override = self.department_model_overrides.get(department)
        return override or self.department_consensus_model
