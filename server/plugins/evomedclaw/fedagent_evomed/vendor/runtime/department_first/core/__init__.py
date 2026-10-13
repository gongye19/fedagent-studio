"""Core modules for the department-first MedAgentSim variant."""

from .arbiter_agent import DepartmentArbiterAgent
from .department_memory import DepartmentMemoryBank
from .department_router import DepartmentRouter
from .prompt_composer import PromptComposer
from .prompt_registry import PromptRegistry
from .runtime import DepartmentFirstLocalAgent, run_department_first_interaction
from .specialist_agent import DepartmentSpecialistService
from .verifier import StructuredOutputVerifier

__all__ = [
    "DepartmentArbiterAgent",
    "DepartmentMemoryBank",
    "DepartmentRouter",
    "PromptComposer",
    "PromptRegistry",
    "DepartmentFirstLocalAgent",
    "DepartmentSpecialistService",
    "StructuredOutputVerifier",
    "run_department_first_interaction",
]

