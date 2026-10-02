"""FoT 的提示词：模板由脚本从上游 dixiyao/FoT @ b02753c 截取，当时已用上游的 f-string 原文核对过逐字相同；
这里用当时算出的指纹锁住，模板被改动就会失败。"""

import hashlib

from fedagent_fot import prompts as P

PROBLEM = "Find $x$ if $2x=4$." + P.MATH_SUFFIX
SOLUTION = "We have \\(x=2\\). \\boxed{2}"
REFLECTION = "### I. Procedural Knowledge\n- divide"
STORE = {
    "insight_trace_a_000001": "Divide both sides by the coefficient to isolate x.",
    "insight_trace_b_000002": "Check the solution by substitution into the original.",
}
PROFILE = {
    "clusters": [{"cluster_id": 0, "cluster_name": "Linear", "traces": list(STORE), "insights": list(STORE)}],
    "relationships": [{"trace_a": "insight_trace_a_000001", "trace_b": "insight_trace_b_000002", "relationship_type": "complementary", "description": "x"}],
}
PREVIOUS = {"insight_old": "An older insight with enough description text."}


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def test_prompts_match_upstream_fingerprints() -> None:
    assert sha(P.reflection_prompt(PROBLEM, SOLUTION)) == "ef7094969f4f4cbe84fb005013a5234f0b4bde66be9f6eb2823d651fc55b26e7"
    assert sha(P.trace_prompt(PROBLEM, SOLUTION, REFLECTION)) == "e56cc06c1db94806399be69500dee3b0a26cba98c8019031a4ea95de6f6f59e3"
    assert sha(P.profiling_prompt(STORE)) == "657f2d476188536a8117edd265dc15293cf94e92a62f974b0d02afe4bc46b128"
    assert sha(P.library_prompt(STORE, PROFILE, PREVIOUS, "author-formula")) == "6126025d8433713f1b24d000c9003f831d992acdbc97fa9fa7c7660e714cc441"


def test_solve_prompt_round_one_is_just_the_problem() -> None:
    assert P.solve_prompt(PROBLEM, {}) == "Problem: " + PROBLEM
    with_library = P.solve_prompt(PROBLEM, {"insight_a": "desc"})
    assert with_library.startswith("Available Insights to Guide Your Solution:\n\n**insight_a**:\ndesc\n\n---\nINSTRUCTIONS:")
    assert with_library.endswith("Problem: " + PROBLEM)


def test_insight_target_modes() -> None:
    auto = P.library_prompt(STORE, PROFILE, {}, "paper-auto")
    assert P.PAPER_AUTO_INSTRUCTION in auto
    assert "- You should extra 4 insights." not in auto
    assert "- You should extra 4 insights." in P.library_prompt(STORE, PROFILE, {}, "author-formula")
    assert "- You should extra 11 insights." in P.library_prompt(STORE, PROFILE, {}, "11")
    assert "Combine previous insights (if any): None" in auto


def test_trace_density_calibration() -> None:
    native = P.trace_prompt(PROBLEM, SOLUTION, REFLECTION)
    calibrated = P.trace_prompt(PROBLEM, SOLUTION, REFLECTION, "paper-gemini")
    assert "at most 1 highest-value" not in native
    assert "Return at most 1 highest-value reasoning trace" in calibrated
    assert calibrated.endswith(P.TRACE_DENSITY_MARKER.lstrip("\n") + "\n") or P.TRACE_DENSITY_MARKER in calibrated
