"""Cross-specialty arbitration agent."""

from __future__ import annotations

import time
from typing import Iterable, List, Optional

from fedagent_evomed.vendor.runtime.department_first.standalone import BAgent
from fedagent_evomed.vendor.runtime.department_first.telemetry import timed_operation

from .prompt_composer import PromptComposer
from .types import RouteDecision, SpecialistOpinion
from .verifier import StructuredOutputVerifier


class DepartmentArbiterAgent:
    """Resolves conflicts between department specialists."""

    def __init__(
        self,
        model_name: str,
        prompt_composer: PromptComposer,
        verifier: StructuredOutputVerifier,
    ):
        self.model_name = model_name
        self.prompt_composer = prompt_composer
        self.verifier = verifier
        self.pipe = BAgent(model_name=model_name, telemetry_source="llm.arbiter")

    def arbitrate(
        self,
        anonymized_case: str,
        route_decision: RouteDecision,
        opinions: Iterable[SpecialistOpinion],
        scenario_id: Optional[int] = None,
    ) -> str:
        with timed_operation(
            "step.arbiter",
            metadata={"scenario_id": scenario_id},
        ):
            opinions = list(opinions)
            system_prompt = self.prompt_composer.compose(
                role="arbiter",
                stage="cross_specialty_escalation",
            )
            system_prompt = (
                f"{system_prompt}\n\n"
                "RULES:\n"
                "1. Output only a structured OPINION with Assessment, Differential Ranking, Recommended Tests, Red Flags to Exclude, and Arbitration Note.\n"
                "2. Resolve conflict by evidence strength, not by averaging opinions.\n"
                "3. If one specialist opinion is empty or weakly supported, discount it explicitly and still choose the best working diagnosis.\n"
                "4. Do NOT ask questions.\n"
            )
            rendered = []
            for opinion in opinions:
                rendered.append(
                    f"Department: {opinion.department}\n"
                    f"Top diagnosis: {opinion.top_diagnosis or 'unknown'}\n"
                    f"Opinion:\n{opinion.raw_opinion}"
                )
            prompt = (
                f"Anonymized case:\n{anonymized_case}\n\n"
                f"Primary department: {route_decision.primary_department}\n"
                f"Secondary department: {route_decision.secondary_department or 'none'}\n"
                f"Route confidence: {route_decision.confidence:.2f}\n\n"
                "Department opinions:\n"
                + "\n\n---\n\n".join(rendered)
            )
            prompts = [
                prompt,
                (
                    f"{prompt}\n\n"
                    "Respond again using only the OPINION format. Name the winning diagnosis first and keep only decisive next tests."
                ),
            ]
            for attempt, candidate_prompt in enumerate(prompts, start=1):
                answer = (
                    self.pipe.query_model(
                        candidate_prompt,
                        system_prompt,
                        telemetry_metadata={
                            "scenario_id": scenario_id,
                            "arbiter_attempt": attempt,
                        },
                    ) or ""
                ).strip()
                valid, _ = self.verifier.validate_specialist_opinion(answer)
                if answer and valid:
                    return answer
                if attempt < len(prompts):
                    time.sleep(1.0)
            for opinion in opinions:
                if opinion.raw_opinion.strip():
                    return opinion.raw_opinion
            return ""
