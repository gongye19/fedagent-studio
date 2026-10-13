"""Runtime orchestration for department-first MedAgentSim."""

from __future__ import annotations

import json
import re
import time
from typing import Any, Dict, List, Optional

from fedagent_evomed.vendor.runtime.skill_runtime import EvoMedSkillRuntime
from fedagent_evomed.vendor.runtime.department_first.telemetry import timed_operation
from fedagent_evomed.vendor.runtime.department_first.standalone import StandaloneLocalAgent, compare_results
from fedagent_evomed.vendor.runtime.memory.retrieval import build_runtime_state

from .department_memory import DepartmentMemoryBank
from .prompt_composer import PromptComposer
from .types import ConsultationBundle, RouteDecision
from .verifier import StructuredOutputVerifier


def _log_line(message: str = "") -> None:
    pass  # Private logs are retained by the platform step, not printed globally.


def _read_prompt_fragment(composer: PromptComposer, category: str, name: str) -> str:
    """Reads an optional prompt fragment and returns an empty string if missing."""
    try:
        return composer.registry.read(category, name)
    except FileNotFoundError:
        return ""


def _format_memory_usage(department: str, memory_ids: List[str]) -> str:
    joined = ",".join(memory_ids) if memory_ids else "none"
    return f"{department}:{joined}"


def _log_route_decision(bundle: ConsultationBundle) -> None:
    route = bundle.route_decision
    _log_line(
        "[Hospital Route]: "
        f"primary={route.primary_department}, "
        f"secondary={route.secondary_department or 'none'}, "
        f"confidence={route.confidence:.3f}, "
        f"arbiter_candidate={'yes' if route.should_arbitrate else 'no'}, "
        f"method={route.routing_method}"
    )
    if route.reasons:
        _log_line(f"[Hospital Route Reasons]: {' | '.join(route.reasons)}")
    if route.score_breakdown:
        _log_line(
            "[Hospital Route Scores]: "
            f"{json.dumps(route.score_breakdown, ensure_ascii=False)}"
        )
    gate_payload = (route.metadata or {}).get("secondary_gate", {})
    if gate_payload:
        _log_line(
            "[Hospital Secondary Gate]: "
            f"mode={gate_payload.get('mode', 'off')}, "
            f"status={gate_payload.get('status', 'unknown')}, "
            f"reason={gate_payload.get('reason', '')}"
        )


def _log_specialist_bundle(bundle: ConsultationBundle) -> None:
    _log_line("[Consult Request]:")
    _log_line(bundle.consultation_request)
    _log_route_decision(bundle)
    for opinion in bundle.opinions:
        _log_line(
            "[Hospital Specialist]: "
            f"department={opinion.department}, "
            f"model={opinion.model_name}, "
            f"memory_ids={','.join(opinion.memory_ids) if opinion.memory_ids else 'none'}, "
            f"top_diagnosis={opinion.top_diagnosis or 'unknown'}"
        )
        _log_line(opinion.raw_opinion)
    if bundle.arbiter_used:
        _log_line("[Hospital Arbiter]: arbitration applied")
    _log_line("[Hospital Final]:")
    _log_line(bundle.final_opinion)


class DepartmentFirstLocalAgent(StandaloneLocalAgent):
    """Local agent with stage-aware prompt composition."""

    def __init__(
        self,
        backend_str: str,
        prompt_composer: PromptComposer,
        memory_bank: Optional[DepartmentMemoryBank] = None,
        verifier: Optional[StructuredOutputVerifier] = None,
        skill_memory_bank: Optional[Dict[str, Any]] = None,
        skill_memory_top_k: int = 4,
        semantic_skill_model: Optional[str] = None,
        semantic_matching_enabled: bool = True,
        config_path: Optional[str] = None,
        **kwargs,
    ):
        super().__init__(backend_str=backend_str, **kwargs)
        self.prompt_composer = prompt_composer
        self.memory_bank = memory_bank or DepartmentMemoryBank()
        self.verifier = verifier or StructuredOutputVerifier()
        self.skill_memory_bank = skill_memory_bank
        self.skill_memory_top_k = skill_memory_top_k
        self.retrieved_guidance = ""
        runtime_model = semantic_skill_model or backend_str
        self.skill_runtime = EvoMedSkillRuntime(
            model_name=runtime_model if runtime_model != "mock" else "mock",
            config_path=config_path,
            enabled=semantic_matching_enabled,
        )
        self.last_route_decision: Optional[RouteDecision] = None
        self.last_stage_name: str = "intake"
        self.last_overlay_department: str = "general_internal_medicine"
        self.last_overlay_entry_ids: List[str] = []

    def set_memory_bank(
        self,
        memory_bank: Optional[Dict[str, Any]],
        top_k: Optional[int] = None,
    ) -> None:
        """Sets the runtime EvoMed skill memory bank used by co-evolve."""
        self.skill_memory_bank = memory_bank
        if top_k is not None:
            self.skill_memory_top_k = top_k

    def set_last_route(self, route_decision: Optional[RouteDecision]) -> None:
        self.last_route_decision = route_decision

    def update_scenario(self, *args, **kwargs) -> None:
        super().update_scenario(*args, **kwargs)
        self.last_route_decision = None
        self.last_stage_name = "intake"
        self.last_overlay_department = "general_internal_medicine"
        self.last_overlay_entry_ids = []
        self.retrieved_guidance = ""

    def _extract_tests_from_history(self) -> List[str]:
        tests: List[str] = []
        for line in self.agent_hist.splitlines():
            if "REQUEST TEST:" not in line.upper():
                continue
            _, _, test_name = line.partition(":")
            test_name = test_name.strip(" .")
            if test_name:
                tests.append(test_name)
        return tests

    def _extract_working_differential(self) -> List[str]:
        findings: List[str] = []
        for source in (self.agent_hist, self.hospital_consultation):
            if not source:
                continue
            for label in ("Working Differential", "Differential Ranking"):
                for line in source.splitlines():
                    if label.lower() not in line.lower():
                        continue
                    _, _, tail = line.partition(":")
                    findings.extend(
                        item.strip(" -*")
                        for item in re.split(r"[;\n]", tail)
                        if item.strip(" -*")
                    )
        deduped: List[str] = []
        for item in findings:
            if item not in deduped:
                deduped.append(item)
        return deduped[:5]

    def _extract_evidence_lines(self) -> List[str]:
        evidence: List[str] = []
        for source in (self.presentation, self.agent_hist):
            for raw_line in source.splitlines():
                cleaned = raw_line.strip()
                if not cleaned:
                    continue
                if ":" in cleaned:
                    prefix, _, tail = cleaned.partition(":")
                    if prefix.strip().lower() in {"doctor", "dialogue history"}:
                        continue
                    if prefix.strip().lower() in {"patient", "results", "measurement"}:
                        cleaned = tail.strip()
                cleaned = cleaned.strip(" -*")
                if cleaned and cleaned not in evidence:
                    evidence.append(cleaned)
        return evidence

    def _extract_consult_section(self, text: str, label: str) -> str:
        pattern = re.compile(
            rf"{re.escape(label)}\s*:\s*(.+?)(?=\n[A-Z][A-Za-z \-]+:\s|\Z)",
            flags=re.IGNORECASE | re.DOTALL,
        )
        match = pattern.search(text or "")
        return match.group(1).strip() if match else ""

    def build_structured_consultation_request(self, doctor_response: str) -> str:
        response = (doctor_response or "").strip()
        if "REQUEST CONSULTATION" in response.upper():
            response = response.split("REQUEST CONSULTATION:", 1)[-1].strip()

        evidence_lines = self._extract_evidence_lines()
        chief_complaint = self._extract_consult_section(response, "Chief Complaint")
        if not chief_complaint:
            chief_complaint = evidence_lines[0] if evidence_lines else "Diagnostic clarification request"

        positives = self._extract_consult_section(response, "Key Positive Findings")
        if not positives:
            positives = "\n".join(
                f"- {item}"
                for item in evidence_lines[:5]
            ) or "- No major positives documented yet"

        negatives = self._extract_consult_section(response, "Key Negative Findings")
        if not negatives:
            negatives = "- No major negatives documented yet"

        tests = self._extract_consult_section(response, "Tests Performed")
        if not tests:
            performed_tests = self._extract_tests_from_history()
            tests = ", ".join(performed_tests) if performed_tests else "none"

        differential = self._extract_consult_section(response, "Working Differential")
        if not differential:
            working_differential = self._extract_working_differential()
            differential = (
                "\n".join(f"- {item}" for item in working_differential)
                if working_differential else
                "- Need specialty help to rank the leading diagnosis"
            )

        specific_question = self._extract_consult_section(response, "Specific Question")
        if not specific_question:
            specific_question = (
                "Which department should take lead, what is the most likely diagnosis, "
                "and what single decisive confirmatory test should be prioritized next?"
            )

        return (
            "REQUEST CONSULTATION:\n"
            f"Chief Complaint: {chief_complaint}\n"
            f"Key Positive Findings:\n{positives}\n"
            f"Key Negative Findings:\n{negatives}\n"
            f"Tests Performed: {tests}\n"
            f"Working Differential:\n{differential}\n"
            f"Specific Question: {specific_question}"
        ).strip()

    def extract_consultation_request(self, doctor_response: str, epsilon: float = 1.0) -> str:
        structured_request = self.build_structured_consultation_request(doctor_response)
        anonymized_summary = super().extract_consultation_request(doctor_response, epsilon=epsilon)
        self.sanitized_hist = (
            f"{structured_request}\n\n"
            "Anonymized Case Summary:\n"
            f"{anonymized_summary}"
        )
        return self.sanitized_hist

    def current_stage(self) -> str:
        if self.infs >= self.max_infs - 2:
            return "final_diagnosis"
        if self.hospital_consultation:
            return "post_consult_synthesis"
        if self.infs < 2:
            return "intake"
        if self.infs < self.min_questions_before_consult:
            return "evidence_build"
        return "consult_request"

    def _skill_runtime_stage(self) -> str:
        stage = self.current_stage()
        if stage == "post_consult_synthesis":
            return "post_consult"
        if stage == "final_diagnosis":
            return "diagnosis"
        return "pre_consult"

    def _build_skill_runtime_state(self):
        dialogue_text = f"{self.presentation}\n{self.agent_hist}".strip()
        if self.hospital_consultation:
            dialogue_text += f"\nHospital Opinion: {self.hospital_consultation}"
        return build_runtime_state(
            scenario_id=getattr(self.scenario, "scenario_id", -1) if self.scenario is not None else -1,
            owner_role="LocalAgent",
            dialogue_text=dialogue_text,
            question_count=self.infs,
            tests_done=self._extract_tests_from_history(),
            has_hospital_opinion=bool(self.hospital_consultation),
            uncertainty=max(0.05, 1.0 - min(self.infs / max(self.max_infs, 1), 1.0)),
            stage=self._skill_runtime_stage(),
            working_differential=self._extract_working_differential(),
        )

    def refresh_retrieved_guidance(self) -> str:
        """Refreshes EvoMed skill guidance learned by co-evolve."""
        if not self.skill_memory_bank:
            self.retrieved_guidance = ""
            return ""
        state = self._build_skill_runtime_state()
        with timed_operation(
            "step.semantic_guidance_local",
            metadata={"scenario_id": getattr(self.scenario, "scenario_id", None)},
        ):
            self.retrieved_guidance = self.skill_runtime.render_guidance(
                self.skill_memory_bank,
                state,
                top_k=self.skill_memory_top_k,
            )
        return self.retrieved_guidance

    def system_prompt(self) -> str:
        stage = self.current_stage()
        department = (
            self.last_route_decision.primary_department
            if self.last_route_decision and self.hospital_consultation
            else "general_internal_medicine"
        )
        overlay_entries = self.memory_bank.retrieve(
            department=department,
            owner_role="local_doctor",
            stage=stage,
            text=f"{self.presentation}\n{self.agent_hist}\n{self.hospital_consultation}",
            top_k=2,
        )
        self.last_stage_name = stage
        self.last_overlay_department = department
        self.last_overlay_entry_ids = [entry.entry_id for entry in overlay_entries]
        overlay = self.memory_bank.render_overlay(
            overlay_entries,
            title="Local doctor memory: validated control cues",
        )
        base_prompt = super().system_prompt()
        stage_guidance = _read_prompt_fragment(
            self.prompt_composer,
            "stages",
            f"{stage}.md",
        )
        department_guidance = _read_prompt_fragment(
            self.prompt_composer,
            "departments",
            f"{department}.md",
        )
        retrieved_guidance = self.refresh_retrieved_guidance()
        guidance_blocks = [
            block.strip()
            for block in (retrieved_guidance, stage_guidance, department_guidance, overlay)
            if block and block.strip()
        ]
        if not guidance_blocks:
            return base_prompt

        guidance = (
            "Department-first guidance (secondary to the RULES above):\n\n"
            + "\n\n".join(guidance_blocks)
        ).strip()
        marker = "\nContext:"
        if marker in base_prompt:
            head, tail = base_prompt.rsplit(marker, 1)
            return f"{head}\n\n{guidance}\nContext:{tail}"
        return f"{base_prompt}\n\n{guidance}"


def run_department_first_interaction(
    scenario,
    local_agent: DepartmentFirstLocalAgent,
    specialist_service,
    patient_agent,
    meas_agent,
    moderator_pipe,
    total_inferences: int,
    scenario_id: int,
    total_correct: int,
    total_scenarios: int,
) -> Dict[str, Any]:
    """Runs one hierarchical interaction using department-first consultation control."""

    patient_response = ""
    local_response = ""
    predicted_diag = ""
    is_correct = False
    dialogue_history: List[Dict[str, Any]] = []
    num_turns = 0
    num_tests = 0
    num_consultations = 0
    consultation_records: List[Dict[str, Any]] = []

    for inf_id in range(total_inferences):
        with timed_operation(
            "step.local_doctor_turn",
            metadata={
                "scenario_id": scenario_id,
                "turn_index": inf_id + 1,
            },
        ) as local_span:
            local_response = local_agent.inference_local(patient_response)
        num_turns += 1
        progress = int(((inf_id + 1) / total_inferences) * 100)
        _log_line(
            f"[Local Doctor {inf_id + 1}/{total_inferences} ({progress}%)]"
            f"[stage={local_agent.last_stage_name}]"
            f"[memory={_format_memory_usage(local_agent.last_overlay_department, local_agent.last_overlay_entry_ids)}]: "
            f"{local_response}"
            f" [elapsed={local_span.duration_seconds:.3f}s]"
        )
        dialogue_history.append(
            {
                "speaker": "LocalDoctor",
                "text": local_response,
                "turn_index": inf_id,
                "stage": local_agent.last_stage_name,
                "memory_department": local_agent.last_overlay_department,
                "memory_entry_ids": list(local_agent.last_overlay_entry_ids),
            }
        )

        if local_agent.needs_consultation(local_response):
            anonymized_case = local_agent.extract_consultation_request(local_response)
            with timed_operation(
                "step.consultation_bundle",
                metadata={
                    "scenario_id": scenario_id,
                    "turn_index": inf_id + 1,
                },
            ) as consult_span:
                bundle: ConsultationBundle = specialist_service.consult(
                    anonymized_case=anonymized_case,
                    scenario_id=scenario_id,
                )
            num_consultations += 1
            consultation_records.append(bundle.to_dict())
            local_agent.set_last_route(bundle.route_decision)
            _log_specialist_bundle(bundle)
            _log_line(f"[Timing] consultation_bundle_elapsed={consult_span.duration_seconds:.3f}s")
            dialogue_history.append(
                {
                    "speaker": "ConsultationRequest",
                    "text": bundle.consultation_request,
                }
            )
            dialogue_history.append(
                {
                    "speaker": "HospitalRoute",
                    "text": json.dumps(bundle.route_decision.to_dict(), ensure_ascii=False),
                }
            )
            dialogue_history.append({"speaker": "HospitalExpert", "text": bundle.final_opinion})
            local_agent.receive_hospital_opinion(bundle.final_opinion)
            patient_response = ""
            continue

        if "DIAGNOSIS READY" in local_response.upper():
            turns_remaining = total_inferences - (inf_id + 1)
            if not local_agent.can_diagnose_after_consult() and turns_remaining > 0:
                _log_line("[Protocol] Diagnosis deferred: need more questions after consultation")
                with timed_operation(
                    "step.patient_response",
                    metadata={
                        "scenario_id": scenario_id,
                        "turn_index": inf_id + 1,
                        "reason": "post_consult_question_requirement",
                    },
                ) as patient_span:
                    patient_response = patient_agent.inference_patient(
                        "Doctor, is there anything else you'd like to know?"
                    )
                _log_line(
                    f"[Patient ({progress}%)][elapsed={patient_span.duration_seconds:.3f}s]: "
                    f"{patient_response}"
                )
                dialogue_history.append({"speaker": "Patient", "text": patient_response})
                continue

            diagnosis_to_compare = local_response.strip() or "(No diagnosis provided)"
            # Adapter: reference labels never enter diagnostic agents; platform grades later.
            is_correct = False
            predicted_diag = diagnosis_to_compare
            break

        if "REQUEST TEST" in local_response.upper():
            with timed_operation(
                "step.measurement_response",
                metadata={
                    "scenario_id": scenario_id,
                    "turn_index": inf_id + 1,
                },
            ) as measurement_span:
                patient_response = meas_agent.inference_measurement(local_response)
            num_tests += 1
            _log_line(
                f"[Measurement ({progress}%)][elapsed={measurement_span.duration_seconds:.3f}s]: "
                f"{patient_response}"
            )
            patient_agent.add_hist(patient_response)
            dialogue_history.append({"speaker": "Measurement", "text": patient_response})
        else:
            with timed_operation(
                "step.patient_response",
                metadata={
                    "scenario_id": scenario_id,
                    "turn_index": inf_id + 1,
                },
            ) as patient_span:
                patient_response = patient_agent.inference_patient(local_response)
            _log_line(
                f"[Patient ({progress}%)][elapsed={patient_span.duration_seconds:.3f}s]: "
                f"{patient_response}"
            )
            meas_agent.add_hist(patient_response)
            dialogue_history.append({"speaker": "Patient", "text": patient_response})
        # No fixed pause; SDK controls rate limits and retries.

    if not predicted_diag:
        predicted_diag = local_response
    return {
        "is_correct": is_correct,
        "predicted_diagnosis": predicted_diag,
        "dialogue_history": dialogue_history,
        "consultation_history": consultation_records,
        "num_turns": num_turns,
        "num_tests": num_tests,
        "used_consultation": num_consultations > 0,
        "num_consultations": num_consultations,
    }
