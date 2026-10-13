"""Standalone runtime support for the EvoMed-owned department-first runtime."""

from __future__ import annotations

import datetime
import json
import math
import os
import random
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional


from fedagent_evomed.vendor.runtime.department_first.telemetry import TIMING_TRACKER, timed_operation
from fedagent_evomed.vendor.runtime.config.loader import load_runtime_config, resolve_provider_config
from fedagent_evomed.vendor.runtime.metrics.token_usage import TRACKER, estimate_tokens

PROJECT_ROOT = Path(__file__).resolve().parents[3]
MOCK_MODELS = {"mock", "mock-clinician", "mock-med"}
DATASET_FILES = {
    "MedQA": "_medqa.jsonl",
    "MedQA_Ext": "_medqa_extended.jsonl",
    "NEJM": "_nejm.jsonl",
    "NEJM_Ext": "datasets_nejm_extended.jsonl",
    "MIMICIV": "datasets_mimiciv.jsonl",
}
MODEL_ALIASES = {
    "llama2": "meta/llama-2-70b-chat",
    "llama2_hf": "meta-llama/Llama-2-70b-chat-hf",
    "llama3": "meta-llama/Meta-Llama-3-70B-Instruct",
    "mixtral": "mistralai/mixtral-8x7b-instruct-v0.1",
    "llama11b": "meta-llama/Llama-3.2-11B-Vision-Instruct",
    "llama3b": "meta-llama/Llama-3.2-3B-Instruct",
    "llama3_7b": "meta-llama/Meta-Llama-3-8B-Instruct",
    "med": "AdaptLLM/medicine-LLM",
    "med_chat": "AdaptLLM/medicine-chat",
    "llama3_1_8": "meta-llama/Llama-3.1-8B-Instruct",
    "llama_70_3p1": "meta-llama/Meta-Llama-3.1-70B-Instruct",
    "llama_med": "HPAI-BSC/Llama3.1-Aloe-Beta-8B",
    "qwue": "Qwen/Qwen2.5-0.5B-Instruct",
    "qwue7": "Qwen/Qwen2.5-7B-Instruct",
}


def resolve_model_name(model_name: str) -> str:
    """Resolves a short alias into a concrete model name."""
    return MODEL_ALIASES.get(model_name, model_name)


def _load_config() -> Dict[str, Any]:
    """Loads EvoMed-managed runtime config without repo-root coupling."""
    return load_runtime_config(cwd=PROJECT_ROOT, env=os.environ)


def _api_config(model_name: str) -> Dict[str, str]:
    """Resolves API key and base URL for the model."""
    config = _load_config()
    provider_cfg = resolve_provider_config(model_name, config, env=os.environ)
    return {"api_key": provider_cfg["api_key"], "base_url": provider_cfg["base_url"]}


def _stringify(value: Any) -> str:
    """Converts structured content into compact text."""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


class BAgent:
    """Adapter: model calls are delegated to the thread-local SDK bridge."""
    def __init__(self, model_name="sdk", telemetry_source="llm.generic", telemetry_metadata=None):
        self.model_name = model_name
        self.use_mock = False
        self.telemetry_source = telemetry_source

    def query_model(self, prompt, system_prompt="You are a helpful assistant.", max_tokens=2048, image_requested=False, **kwargs):
        from fedagent_evomed.bridge import current_bridge
        if image_requested:
            raise ValueError("当前只支持文本病例")
        return current_bridge().query(prompt, system_prompt, max_tokens)


class StructuredScenario:
    """Scenario wrapper for OSCE-style text datasets."""

    def __init__(self, payload: Dict[str, Any]) -> None:
        osce = payload.get("OSCE_Examination", {})
        self.payload = payload
        self.tests = osce.get("Test_Results", {})
        self.diagnosis = osce.get("Correct_Diagnosis", "")
        self.patient_info = osce.get("Patient_Actor", {})
        self.examiner_info = osce.get("Objective_for_Doctor", {})
        self.physical_exams = osce.get("Physical_Examination_Findings", {})

    def patient_information(self) -> str:
        return _stringify(self.patient_info)

    def examiner_information(self) -> str:
        return _stringify(self.examiner_info)

    def exam_information(self) -> str:
        merged = dict(self.physical_exams)
        merged["tests"] = self.tests
        return _stringify(merged)

    def diagnosis_information(self) -> str:
        return _stringify(self.diagnosis)


class ImageScenario:
    """Scenario wrapper for image-style NEJM datasets."""

    def __init__(self, payload: Dict[str, Any]) -> None:
        self.payload = payload
        self.image_url = payload.get("image_url", "")
        self.patient_info = payload.get("patient_info", "")
        self.physical_exams = payload.get("physical_exams", "")
        answers = payload.get("answers", [])
        self.diagnosis = next(
            (item.get("text", "") for item in answers if item.get("correct")),
            "",
        )

    def patient_information(self) -> str:
        return _stringify(self.patient_info)

    def examiner_information(self) -> str:
        return "What is the most likely diagnosis?"

    def exam_information(self) -> str:
        return _stringify(self.physical_exams)

    def diagnosis_information(self) -> str:
        return _stringify(self.diagnosis)


class ScenarioLoader:
    """Loads JSONL scenarios without importing MedAgentSim."""

    def __init__(self, dataset: str, dataset_root: Optional[str] = None) -> None:
        self.dataset = dataset
        self.dataset_path = resolve_dataset_file(dataset, dataset_root)
        parser = ImageScenario if dataset in {"NEJM", "NEJM_Ext"} else StructuredScenario
        with self.dataset_path.open("r", encoding="utf-8") as handle:
            self.scenarios = [parser(json.loads(line)) for line in handle]
        self.num_scenarios = len(self.scenarios)

    def sample_scenario(self) -> Any:
        return self.scenarios[random.randint(0, len(self.scenarios) - 1)]

    def get_scenario(self, scenario_id: Optional[int]) -> Any:
        if scenario_id is None:
            return self.sample_scenario()
        return self.scenarios[scenario_id]


def resolve_dataset_file(dataset: str, dataset_root: Optional[str] = None) -> Path:
    """Resolves a dataset JSONL file from local EvoMed-compatible paths."""
    if dataset not in DATASET_FILES:
        raise ValueError(f"Unsupported dataset: {dataset}")

    filename = DATASET_FILES[dataset]
    candidates: List[Path] = []
    if dataset_root:
        root = Path(dataset_root).expanduser().resolve()
        candidates.extend([root / filename, root / "datasets" / filename])

    env_root = os.environ.get("EVOMED_DATASET_ROOT", "").strip()
    if env_root:
        root = Path(env_root).expanduser().resolve()
        candidates.extend([root / filename, root / "datasets" / filename])

    candidates.extend(
        [
            PROJECT_ROOT / "datasets" / filename,
            PROJECT_ROOT.parent / "datasets" / filename,
            PROJECT_ROOT / filename,
            PROJECT_ROOT.parent / "evolve" / "MedAgentSim" / "datasets" / filename,
            Path.cwd() / "datasets" / filename,
        ]
    )

    seen = set()
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        if resolved.exists():
            return resolved
    raise FileNotFoundError(
        f"Unable to locate dataset file {filename}. Set --dataset-root or EVOMED_DATASET_ROOT."
    )


class PatientAgent:
    """Standalone patient simulator."""

    def __init__(self, backend_str: str = "mock") -> None:
        self.backend = backend_str
        self.pipe = BAgent(model_name=backend_str, telemetry_source="llm.patient_agent")

    def update_scenario(self, scenario: Any, bias_present: Optional[str] = None) -> None:
        del bias_present
        self.scenario = scenario
        self.scenario_id = getattr(scenario, "scenario_id", None)
        self.reset()

    def inference_patient(self, doctor_prompt: str) -> str:
        prompt = (
            f"Dialogue history:\n{self.agent_hist}\n"
            f"Doctor: {doctor_prompt}\nPatient: "
        )
        answer = self.pipe.query_model(
            prompt,
            self.system_prompt(),
            telemetry_metadata={
                "scenario_id": self.scenario_id,
            },
        )
        if not (answer or "").strip():
            answer = self._fallback_response()
        self.agent_hist += f"Doctor: {doctor_prompt}\nPatient: {answer}\n\n"
        return answer

    def system_prompt(self) -> str:
        return (
            "You are a patient in a clinic who only responds in the form of dialogue. "
            "Keep each answer within 1-3 sentences and do not reveal the final diagnosis explicitly.\n\n"
            f"Patient information: {self.symptoms}"
        )

    def reset(self) -> None:
        self.agent_hist = ""
        self.symptoms = self.scenario.patient_information()

    def add_hist(self, hist_str: str) -> None:
        self.agent_hist += hist_str + "\n\n"

    def _fallback_response(self) -> str:
        snippets: List[str] = []
        for raw_line in str(self.symptoms or "").splitlines():
            line = raw_line.strip(" -*\t")
            if not line:
                continue
            if ":" in line:
                label, value = line.split(":", 1)
                if value.strip():
                    line = value.strip()
                elif len(label.split()) <= 5:
                    continue
            if line.endswith(":") and len(line.split()) <= 5:
                continue
            snippets.append(line)
            if len(snippets) >= 2:
                break
        if snippets:
            normalized = []
            for snippet in snippets:
                text = snippet.strip()
                if text and text[-1] not in ".!?":
                    text += "."
                normalized.append(text)
            return " ".join(normalized)
        return "The main symptoms are still the same as I described earlier, and they're still bothering me."


class MeasurementAgent:
    """Standalone measurement reader."""

    def __init__(self, backend_str: str = "mock") -> None:
        self.backend = backend_str
        self.pipe = BAgent(model_name=backend_str, telemetry_source="llm.measurement_agent")

    def update_scenario(self, scenario: Any) -> None:
        self.scenario = scenario
        self.scenario_id = getattr(scenario, "scenario_id", None)
        self.reset()

    def inference_measurement(self, question: str) -> str:
        answer = self._lookup_structured_results(question)
        if not answer:
            prompt = (
                f"Dialogue history:\n{self.agent_hist}\n"
                f"Doctor request: {question}\nMeasurement: "
            )
            answer = self.pipe.query_model(
                prompt,
                self.system_prompt(),
                telemetry_metadata={
                    "scenario_id": self.scenario_id,
                },
            )
        if not (answer or "").strip():
            answer = "RESULTS: NORMAL READINGS"
        self.agent_hist += f"Doctor request: {question}\nMeasurement: {answer}\n\n"
        return answer

    def system_prompt(self) -> str:
        return (
            "You are a measurement reader who responds with medical test results only. "
            "Use the format `RESULTS: [results here]`. "
            "If the requested result is unavailable, return `RESULTS: NORMAL READINGS`.\n\n"
            f"Available exam information: {self.information}"
        )

    def reset(self) -> None:
        self.agent_hist = ""
        self.information = self.scenario.exam_information()
        self.structured_entries = self._build_structured_entries()
        self.test_entries = [item for item in self.structured_entries if item["source"] == "Test Results"]

    def add_hist(self, hist_str: str) -> None:
        self.agent_hist += hist_str + "\n\n"

    def _build_structured_entries(self) -> List[Dict[str, Any]]:
        entries: List[Dict[str, Any]] = []
        tests = getattr(self.scenario, "tests", None)
        physical = getattr(self.scenario, "physical_exams", None)
        if isinstance(tests, dict) and tests:
            self._flatten_structured_entries("Test Results", tests, entries)
        if isinstance(physical, dict) and physical:
            self._flatten_structured_entries("Physical Examination Findings", physical, entries)
        return entries

    def _flatten_structured_entries(
        self,
        root_label: str,
        payload: Any,
        entries: List[Dict[str, Any]],
        path: Optional[List[str]] = None,
    ) -> None:
        path = list(path or [])
        if isinstance(payload, dict):
            for key, value in payload.items():
                self._flatten_structured_entries(
                    root_label=root_label,
                    payload=value,
                    entries=entries,
                    path=path + [str(key)],
                )
            return
        if isinstance(payload, list):
            for index, value in enumerate(payload):
                self._flatten_structured_entries(
                    root_label=root_label,
                    payload=value,
                    entries=entries,
                    path=path + [f"item_{index + 1}"],
                )
            return

        value_text = str(payload).strip()
        if not value_text:
            return
        display_parts = [root_label] + [part.replace("_", " ").strip() for part in path]
        display_path = " > ".join(part for part in display_parts if part)
        path_tokens = self._tokenize_text(display_path)
        value_tokens = self._tokenize_text(value_text)
        entries.append(
            {
                "source": root_label,
                "display_path": display_path,
                "value": value_text,
                "path_tokens": path_tokens,
                "value_tokens": value_tokens,
                "all_tokens": path_tokens | value_tokens,
            }
        )

    def _extract_requested_test(self, question: str) -> str:
        text = str(question or "").strip()
        if not text:
            return ""
        match = re.search(r"REQUEST TEST\s*:\s*(.+)", text, flags=re.IGNORECASE | re.DOTALL)
        if match:
            return match.group(1).strip()
        return text

    def _tokenize_text(self, text: str) -> set[str]:
        normalized = str(text or "").lower()
        for old, new in (
            ("x-ray", "xray"),
            ("x ray", "xray"),
            ("ct scan", "ct"),
            ("mri scan", "mri"),
        ):
            normalized = normalized.replace(old, new)
        normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
        base_tokens = {token for token in normalized.split() if token}
        expanded = set(base_tokens)
        alias_map = {
            "cbc": {"complete", "blood", "count"},
            "cmp": {"comprehensive", "metabolic", "panel"},
            "ct": {"computed", "tomography"},
            "mri": {"magnetic", "resonance", "imaging"},
            "xray": {"x", "ray", "radiograph"},
            "emg": {"electromyography"},
            "ecg": {"ekg", "electrocardiogram"},
            "ekg": {"ecg", "electrocardiogram"},
            "ua": {"urinalysis"},
        }
        for token in list(base_tokens):
            expanded.update(alias_map.get(token, set()))
        return expanded

    def _lookup_structured_results(self, question: str) -> str:
        if not self.structured_entries:
            return ""
        request = self._extract_requested_test(question)
        request_tokens = self._tokenize_text(request)
        if not request_tokens:
            return ""

        ranked: List[tuple[float, int, Dict[str, Any]]] = []
        for entry in self.structured_entries:
            path_overlap = len(request_tokens & entry["path_tokens"])
            all_overlap = len(request_tokens & entry["all_tokens"])
            score = float(path_overlap * 2.0 + all_overlap * 0.5)
            if entry["source"] == "Test Results":
                score += 0.25
            if score > 0.0:
                ranked.append((score, path_overlap, entry))

        if ranked:
            ranked.sort(key=lambda item: item[0], reverse=True)
            path_hit_candidates = [item for item in ranked if item[1] > 0]
            if path_hit_candidates:
                selected: List[Dict[str, Any]] = []
                seen_paths = set()
                for _score, _path_overlap, entry in path_hit_candidates:
                    if len(selected) >= 4:
                        break
                    path_key = entry["display_path"]
                    if path_key in seen_paths:
                        continue
                    seen_paths.add(path_key)
                    selected.append(entry)
                if selected:
                    return self._render_structured_results(selected)

            top_score = ranked[0][0]
            threshold = max(1.0, top_score * 0.45)
            selected: List[Dict[str, Any]] = []
            seen_paths = set()
            for score, _path_overlap, entry in ranked:
                if score < threshold or len(selected) >= 4:
                    continue
                path_key = entry["display_path"]
                if path_key in seen_paths:
                    continue
                seen_paths.add(path_key)
                selected.append(entry)
            if selected:
                return self._render_structured_results(selected)

        fallback_entries = self.test_entries[:2] or self.structured_entries[:2]
        if fallback_entries:
            return self._render_structured_results(
                fallback_entries,
                prefix=(
                    "RESULTS: Requested test not explicitly available in this scenario. "
                    "Closest available dataset findings:"
                ),
            )
        return ""

    def _render_structured_results(
        self,
        entries: List[Dict[str, Any]],
        prefix: str = "RESULTS:",
    ) -> str:
        lines = [prefix]
        for entry in entries:
            lines.append(f"- {entry['display_path']}: {entry['value']}")
        return "\n".join(lines)


def _doctor_contains_correct_diagnosis(doctor_text: str, correct: str) -> bool:
    text = (doctor_text or "").lower().strip()
    answer = (correct or "").strip()
    if not text or not answer:
        return False
    answer_lower = answer.lower()
    if answer_lower in text:
        return True
    paren = re.search(r"\(([^)]+)\)", answer)
    if paren:
        abbreviation = paren.group(1).strip().lower()
        if len(abbreviation) >= 2 and abbreviation in text:
            return True
    words = re.sub(r"[()]", " ", answer_lower).split()
    for index in range(max(0, len(words) - 2)):
        phrase = " ".join(words[index:index + 3])
        if len(phrase) >= 15 and phrase in text:
            return True
    return False


def compare_results(
    diagnosis: str,
    correct_diagnosis: str,
    mod_pipe: BAgent,
    similarity_threshold: float = 0.75,
    tries: int = 3,
    timeout: float = 5.0,
    scenario_id: Optional[int] = None,
) -> bool:
    """Compares a predicted diagnosis against the gold answer."""
    if not diagnosis or not diagnosis.strip() or diagnosis.strip() == "(No diagnosis provided)":
        return False
    if _doctor_contains_correct_diagnosis(diagnosis, correct_diagnosis):
        return True

    prompt = (
        f"Here is the correct diagnosis: {correct_diagnosis}\n"
        f"Here was the doctor's diagnosis: {diagnosis}\n\n"
        "Score based on CLINICAL EQUIVALENCE, not literal string similarity. Use this scale:\n"
        "- 1.0: Identical, synonyms, or standard abbreviations (e.g., MG for Myasthenia gravis)\n"
        "- 0.9–1.0: Clinically equivalent diagnoses (same disease entity, different wording)\n"
        "- 0.75–0.9: Same condition with subtype/phrasing differences (e.g., different specifiers)\n"
        "- 0.5–0.75: Related but not equivalent (e.g., differential vs confirmed)\n"
        "- <0.5: Different or unrelated diagnoses\n\n"
        "Output ONLY a number in brackets, e.g. [0.85]. No other text."
    )
    system_prompt = (
        "You are a medical moderator. Compare the two diagnoses based on CLINICAL EQUIVALENCE only. "
        "Score synonyms and abbreviations as 1.0; clinically equivalent as ≥0.9; subtype differences as 0.75–0.9. "
        "Output ONLY [0.XX] where 0.XX is the similarity (0-1). No explanation."
    )
    for attempt in range(tries):
        try:
            response = (
                mod_pipe.query_model(
                    prompt=prompt,
                    system_prompt=system_prompt,
                    tries=1,
                    timeout=timeout,
                    telemetry_source="llm.moderator_compare",
                    telemetry_metadata={"scenario_id": scenario_id},
                ) or ""
            ).strip()

            if response.startswith("[") and response.endswith("]"):
                similarity_str = response[1:-1].strip()
                similarity = float(similarity_str)
                if 0.0 <= similarity <= 1.0:
                    return similarity >= similarity_threshold
            else:
                match = re.search(r"\[?\s*(0\.\d+|1(?:\.0+)?)\s*\]?", response)
                if match:
                    similarity = float(match.group(1))
                    if 0.0 <= similarity <= 1.0:
                        return similarity >= similarity_threshold
        except Exception:
            pass
        time.sleep(timeout)
    return False


class SimulationEvaluator:
    """Collects scenario metrics and writes compatible evaluation reports."""

    def __init__(
        self,
        mode: str = "hierarchical",
        dataset: str = "unknown",
        doctor_llm: str = "unknown",
        output_dir: str = "./output",
    ) -> None:
        self.mode = mode
        self.dataset = dataset
        self.doctor_llm = doctor_llm
        self.output_dir = output_dir
        self.results: List[Dict[str, Any]] = []

    def record(
        self,
        scenario_id: int,
        is_correct: bool,
        correct_diagnosis: str,
        predicted_diagnosis: str,
        num_turns: int,
        used_consultation: bool = False,
        num_consultations: int = 0,
        num_tests: int = 0,
        intrinsic_reward: Optional[float] = None,
        dialogue_history: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        self.results.append(
            {
                "scenario_id": scenario_id,
                "is_correct": is_correct,
                "correct_diagnosis": correct_diagnosis,
                "predicted_diagnosis": predicted_diagnosis,
                "num_turns": num_turns,
                "used_consultation": used_consultation,
                "num_consultations": num_consultations,
                "num_tests": num_tests,
                "intrinsic_reward": intrinsic_reward,
                "dialogue_history": dialogue_history or [],
            }
        )

    def compute_metrics(self) -> Dict[str, Any]:
        if not self.results:
            return {"error": "No results to evaluate"}

        total = len(self.results)
        correct = sum(1 for item in self.results if item["is_correct"])
        turns = [item["num_turns"] for item in self.results]
        tests = [item["num_tests"] for item in self.results]
        consult_cases = [item for item in self.results if item["used_consultation"]]
        no_consult_cases = [item for item in self.results if not item["used_consultation"]]
        rewards = [
            item["intrinsic_reward"]
            for item in self.results
            if item.get("intrinsic_reward") is not None
        ]
        correct_turns = [item["num_turns"] for item in self.results if item["is_correct"]]
        incorrect_turns = [item["num_turns"] for item in self.results if not item["is_correct"]]
        metrics = {
            "overall": {
                "total_scenarios": total,
                "correct": correct,
                "incorrect": total - correct,
                "accuracy": correct / total,
                "accuracy_pct": f"{correct / total * 100:.1f}%",
            },
            "efficiency": {
                "avg_turns": sum(turns) / total,
                "min_turns": min(turns),
                "max_turns": max(turns),
                "avg_tests_requested": sum(tests) / total,
            },
            "turns_analysis": {
                "avg_turns_correct": sum(correct_turns) / len(correct_turns) if correct_turns else 0.0,
                "avg_turns_incorrect": (
                    sum(incorrect_turns) / len(incorrect_turns) if incorrect_turns else 0.0
                ),
            },
        }
        if self.mode == "hierarchical":
            consult_correct = sum(1 for item in consult_cases if item["is_correct"])
            no_consult_correct = sum(1 for item in no_consult_cases if item["is_correct"])
            metrics["consultation"] = {
                "consultation_rate": f"{len(consult_cases) / total * 100:.1f}%",
                "total_consultations": sum(item["num_consultations"] for item in self.results),
                "accuracy_with_consultation": (
                    f"{consult_correct / len(consult_cases) * 100:.1f}%"
                    if consult_cases else "N/A"
                ),
                "accuracy_without_consultation": (
                    f"{no_consult_correct / len(no_consult_cases) * 100:.1f}%"
                    if no_consult_cases else "N/A"
                ),
            }
        if rewards:
            metrics["coevolve"] = {
                "avg_intrinsic_reward": sum(rewards) / len(rewards),
                "min_reward": min(rewards),
                "max_reward": max(rewards),
                "high_quality_count": sum(1 for r in rewards if float(r) >= 0.6),
            }
        return metrics

    def per_scenario_table(self) -> List[Dict[str, Any]]:
        table = []
        for record in self.results:
            row: Dict[str, Any] = {
                "id": record["scenario_id"],
                "correct": "Y" if record["is_correct"] else "N",
                "turns": record["num_turns"],
                "tests": record["num_tests"],
                "diagnosis": str(record["predicted_diagnosis"] or "")[:60],
                "answer": str(record["correct_diagnosis"] or "")[:60],
            }
            if self.mode == "hierarchical":
                row["consult"] = "Y" if record.get("used_consultation") else "N"
            if record.get("intrinsic_reward") is not None:
                row["reward"] = f"{float(record['intrinsic_reward']):.2f}"
            table.append(row)
        return table

    def generate_report(self, save: bool = True) -> str:
        metrics = self.compute_metrics()
        table = self.per_scenario_table()
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        overall = metrics["overall"]
        efficiency = metrics["efficiency"]
        turns_analysis = metrics["turns_analysis"]
        lines = [
            "=" * 70,
            "MedAgentSim Evaluation Report",
            "=" * 70,
            f"Timestamp    : {timestamp}",
            f"Mode         : {self.mode}",
            f"Dataset      : {self.dataset}",
            f"Doctor LLM   : {self.doctor_llm}",
            "",
            "--- Overall Performance ---",
            f"  Total scenarios : {overall['total_scenarios']}",
            f"  Correct         : {overall['correct']}",
            f"  Incorrect       : {overall['incorrect']}",
            f"  Accuracy        : {overall['accuracy_pct']}",
            "",
            "--- Efficiency ---",
            f"  Avg turns/scenario  : {efficiency['avg_turns']:.1f}",
            f"  Turn range          : [{efficiency['min_turns']}, {efficiency['max_turns']}]",
            f"  Avg tests requested : {efficiency['avg_tests_requested']:.1f}",
            "",
            "--- Turns Analysis ---",
            f"  Avg turns (correct)   : {turns_analysis['avg_turns_correct']:.1f}",
            f"  Avg turns (incorrect) : {turns_analysis['avg_turns_incorrect']:.1f}",
            "",
        ]
        consultation = metrics.get("consultation")
        if consultation:
            lines.extend(
                [
                    "--- Consultation (Hierarchical) ---",
                    f"  Consultation rate          : {consultation['consultation_rate']}",
                    f"  Total consultations        : {consultation['total_consultations']}",
                    f"  Accuracy w/ consultation   : {consultation['accuracy_with_consultation']}",
                    f"  Accuracy w/o consultation  : {consultation['accuracy_without_consultation']}",
                    "",
                ]
            )
        if "coevolve" in metrics:
            coevolve = metrics["coevolve"]
            lines.extend(
                [
                    "--- Co-Evolution ---",
                    f"  Avg intrinsic reward  : {coevolve['avg_intrinsic_reward']:.3f}",
                    f"  Reward range          : [{coevolve['min_reward']:.2f}, {coevolve['max_reward']:.2f}]",
                    f"  High-quality (>=0.6)  : {coevolve['high_quality_count']}",
                    "",
                ]
            )
        lines.append("--- Per-Scenario Details ---")
        if table:
            header_keys = list(table[0].keys())
            col_widths = {}
            for k in header_keys:
                col_widths[k] = max(len(k), max(len(str(row[k])) for row in table))
            header_line = "  ".join(k.ljust(col_widths[k]) for k in header_keys)
            lines.append(f"  {header_line}")
            lines.append(f"  {'-' * len(header_line)}")
            for row in table:
                row_line = "  ".join(str(row[k]).ljust(col_widths[k]) for k in header_keys)
                lines.append(f"  {row_line}")
        lines.append("")
        lines.append("=" * 70)
        report = "\n".join(lines)
        if save:
            output_dir = Path(self.output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)
            report_path = output_dir / f"eval_report_{timestamp}.txt"
            metrics_path = output_dir / f"eval_metrics_{timestamp}.json"
            report_path.write_text(report, encoding="utf-8")
            metrics_path.write_text(
                json.dumps(
                    {
                        "config": {
                            "mode": self.mode,
                            "dataset": self.dataset,
                            "doctor_llm": self.doctor_llm,
                            "timestamp": timestamp,
                        },
                        "metrics": metrics,
                        "per_scenario": self.results,
                    },
                    indent=2,
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            print(f"\n[Evaluate] Report saved to {report_path}")
            print(f"[Evaluate] Metrics JSON saved to {metrics_path}")
        return report


PHI_PATTERNS = {
    r"\b[A-Z][a-z]+ [A-Z][a-z]+\b": "[PATIENT_NAME]",
    r"\b(\d+)-year-old\b": lambda match: f"[{_age_bucket(int(match.group(1)))}]-year-old",
    r"\bage[d]?\s+\d+\b": "[AGE_REDACTED]",
    r"\b\d{1,2}/\d{1,2}/\d{2,4}\b": "[DATE]",
    r"\b(January|February|March|April|May|June|July|August|"
    r"September|October|November|December)\s+\d{1,2},?\s+\d{4}\b": "[DATE]",
    r"\b\w+\s+(Hospital|Clinic|Medical Center|Health Center)\b": "[FACILITY]",
    r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b": "[PHONE]",
    r"\b\d+\s+\w+\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd)\b": "[ADDRESS]",
    r"\b(SSN|ID|MRN)[\s:]+\d+\b": "[ID_REDACTED]",
}
CLINICAL_CONTEXT_PATTERNS = [
    r"(mg|mmol|mEq|g|IU|U|mcg|ng|pg|mL|dL|L|mmHg|bpm|beats|breaths|cm|mm|kg|lb|oz|%)",
    r"(hemoglobin|hgb|hct|wbc|rbc|platelet|creatinine|bun|glucose|sodium|potassium)",
    r"(calcium|magnesium|phosphate|albumin|bilirubin|ast|alt|alp|ggt|ldh|bnp|troponin)",
    r"(temperature|temp|pulse|hr|bp|spo2|respiratory rate|rr|fio2|gcs|apgar)",
    r"(psa|tsh|t3|t4|hba1c|a1c|inr|ptt|aptt|pt|esr|crp)",
]
CLINICAL_CONTEXT_RE = re.compile("|".join(CLINICAL_CONTEXT_PATTERNS), re.IGNORECASE)


def _age_bucket(age: int) -> str:
    if age < 18:
        return "pediatric"
    if age < 40:
        return "18-40"
    if age < 60:
        return "40-60"
    if age < 80:
        return "60-80"
    return "80+"


class PrivacyAccountant:
    """Tracks a simple consultation privacy budget."""

    def __init__(self, total_budget: float = 3.0) -> None:
        self.total_budget = total_budget
        self.spent = 0.0

    def can_spend(self, epsilon: float) -> bool:
        return self.spent + epsilon <= self.total_budget

    def spend(self, epsilon: float) -> None:
        self.spent += epsilon

    def reset(self) -> None:
        self.spent = 0.0


def deidentify_text(text: str) -> str:
    """Applies simple PHI redaction rules."""
    redacted = text
    for pattern, replacement in PHI_PATTERNS.items():
        redacted = re.sub(pattern, replacement, redacted)
    return redacted


def _add_laplace_noise(value: float, sensitivity: float, epsilon: float) -> float:
    sample = random.random() - 0.5
    sample = max(-0.49999999, min(0.49999999, sample))
    scale = sensitivity / epsilon
    noise = -scale * math.copysign(1.0, sample) * math.log(1 - 2 * abs(sample))
    return value + noise


def _is_near_clinical_context(text: str, start: int, end: int, window: int = 40) -> bool:
    context = text[max(0, start - window):min(len(text), end + window)]
    return bool(CLINICAL_CONTEXT_RE.search(context))


def _add_noise_to_numeric_mentions(text: str, epsilon: float) -> str:
    def replace(match: re.Match[str]) -> str:
        if _is_near_clinical_context(text, match.start(), match.end()):
            return match.group()
        noised = _add_laplace_noise(float(match.group()), sensitivity=1.0, epsilon=epsilon)
        return str(max(0, round(noised, 2)))
    return re.sub(r"\b\d+\.?\d*\b", replace, text)


def generate_anonymized_summary(
    raw_history: str,
    pipe: BAgent,
    scenario_id: Optional[int] = None,
) -> str:
    """Summarizes doctor-patient dialogue into a structured anonymized note."""
    with timed_operation(
        "step.privacy_summary",
        metadata={"scenario_id": scenario_id},
    ):
        prompt = (
            "Convert the following doctor-patient dialogue into a structured, anonymized clinical summary. "
            "Replace names with [PATIENT]. Replace exact ages with age ranges. Keep only clinically relevant details.\n\n"
            f"Dialogue:\n{raw_history}\n\n"
            "Output format:\n"
            "Chief Complaint: ...\n"
            "Symptoms: ...\n"
            "Duration: ...\n"
            "Relevant History: ...\n"
            "Lab/Test Results: ...\n"
            "Current Assessment: ..."
        )
        system_prompt = "You are a clinical documentation specialist focused on privacy-compliant case summarization."
        return deidentify_text(
            pipe.query_model(
                prompt,
                system_prompt,
                telemetry_source="llm.privacy_summary",
                telemetry_metadata={"scenario_id": scenario_id},
            )
        )


def prepare_for_hospital(
    raw_history: str,
    pipe: BAgent,
    epsilon: float = 1.0,
    scenario_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Runs summarization, de-identification, and light DP noising."""
    with timed_operation(
        "step.prepare_for_hospital",
        metadata={"scenario_id": scenario_id},
    ):
        summary = generate_anonymized_summary(raw_history, pipe, scenario_id=scenario_id)
        return {
            "anonymized_summary": summary,
            "privacy_budget_used": None,
            "method": "LLM-summary + rule-deidentification (no DP guarantee)",
        }


class StandaloneLocalAgent:
    """Standalone local clinic doctor with MedSim-like protocol control."""

    def __init__(
        self,
        backend_str: str,
        max_infs: int = 20,
        min_questions_before_consult: int = 6,
        max_consultations: int = 2,
        must_question_after_consult: int = 2,
    ) -> None:
        self.backend = backend_str
        self.pipe = BAgent(model_name=backend_str, telemetry_source="llm.local_doctor")
        self.max_infs = max_infs
        self.min_questions_before_consult = min_questions_before_consult
        self.max_consultations = max_consultations
        self.must_question_after_consult = must_question_after_consult
        self.agent_hist = ""
        self.sanitized_hist = ""
        self.infs = 0
        self.presentation = ""
        self.hospital_consultation = ""
        self.learned_strategy = ""
        self.few_shot_examples = ""
        self.scenario = None
        self.consultation_count = 0
        self.questions_since_last_consult = 0
        self.privacy_accountant = PrivacyAccountant(total_budget=3.0)

    def update_scenario(
        self,
        scenario: Any,
        bias_present: Optional[str] = None,
        max_infs: Optional[int] = None,
    ) -> None:
        del bias_present
        self.scenario = scenario
        self.presentation = scenario.examiner_information()
        if max_infs is not None:
            self.max_infs = max_infs
        self.reset()

    def reset(self) -> None:
        self.agent_hist = ""
        self.sanitized_hist = ""
        self.infs = 0
        self.hospital_consultation = ""
        self.consultation_count = 0
        self.questions_since_last_consult = 0
        self.privacy_accountant.reset()

    def system_prompt(self) -> str:
        remaining = self.max_infs - self.infs
        can_consult = self.consultation_count < self.max_consultations
        enough_questions = self.infs >= self.min_questions_before_consult
        base = (
            "You are a local clinic doctor conducting a diagnostic interview.\n\n"
            "RULES:\n"
            "1. Ask targeted questions in 1-3 sentences.\n"
            "2. You may order tests: \"REQUEST TEST: [test_name]\"\n"
        )
        if can_consult and enough_questions:
            base += (
                "3. To consult hospital specialists, use this EXACT format:\n"
                "   REQUEST CONSULTATION:\n"
                "   Chief Complaint: [1 sentence]\n"
                "   Key Positive Findings: [bullet list]\n"
                "   Key Negative Findings: [bullet list]\n"
                "   Tests Performed: [list or \"none\"]\n"
                "   Working Differential: [top 3 diagnoses]\n"
                "   Specific Question: [what you need help with]\n"
            )
        elif can_consult:
            base += (
                f"3. You may consult hospital specialists AFTER asking at least "
                f"{self.min_questions_before_consult} questions "
                f"(you have asked {self.infs} so far).\n"
            )
        else:
            base += "3. You have used all available consultations.\n"
        base += (
            "4. After receiving hospital opinion, you MUST ask at least "
            f"{self.must_question_after_consult} more patient questions before diagnosing. "
            "Do NOT copy the hospital opinion verbatim.\n"
            "5. When ready: \"DIAGNOSIS READY: [single diagnosis name only]\"\n"
            "6. Base your final answer on the best currently available evidence.\n"
            "7. If confirmatory testing is pending, unavailable, or non-diagnostic, still give the best working diagnosis.\n"
            "8. Never say \"unable to determine\", \"insufficient information\", or list multiple final diagnoses.\n"
            f"9. You have {remaining} turns remaining out of {self.max_infs}.\n"
            "10. One turn = one action only: ask a question, request a test, request consultation, or give diagnosis.\n"
        )
        if self.learned_strategy:
            base += f"\nLearned Strategy:\n{self.learned_strategy}\n"
        if self.few_shot_examples:
            base += f"\nReference Cases:\n{self.few_shot_examples}\n"
        if self.hospital_consultation:
            base += (
                "\nHospital Expert Opinion:\n"
                f"{self.hospital_consultation}\n"
                "Use the hospital opinion as already-available specialist evidence. "
                "Do NOT ask the patient whether they have seen the specialist or what the specialist recommended.\n"
            )
        base += f"\nContext: {self.presentation}"
        return base

    def inference_local(self, patient_response: str) -> str:
        if self.infs >= self.max_infs:
            return "DIAGNOSIS READY: [maximum inferences reached]"
        if self.infs >= self.max_infs - 2:
            return self._force_diagnosis(patient_response)
        prompt = (
            f"Dialogue history:\n{self.agent_hist}\n"
            f"Patient: {patient_response}\nDoctor: "
        )
        answer = self._query_with_retry(prompt, self.system_prompt())
        self.agent_hist += f"Patient: {patient_response}\nDoctor: {answer}\n\n"
        self.infs += 1
        self.questions_since_last_consult += 1
        return answer

    def _force_diagnosis(self, patient_response: str) -> str:
        prompt = (
            f"Dialogue history:\n{self.agent_hist}\n"
            f"Patient: {patient_response}\n\n"
            "You have 2 or fewer turns remaining. Provide your BEST single most likely diagnosis now.\n"
            "Base it on all currently available history, tests, and hospital opinion already in context.\n"
            "Do NOT say unable to determine or list multiple diagnoses.\n"
            "Output exactly: DIAGNOSIS READY: [your single diagnosis name]\nDoctor: "
        )
        answer = self._query_with_retry(prompt, self.system_prompt(), fallback_text="")
        if self._is_invalid_final_diagnosis(answer):
            answer = self._best_effort_diagnosis(patient_response)
        self.agent_hist += f"Patient: {patient_response}\nDoctor: {answer}\n\n"
        self.infs += 1
        if "DIAGNOSIS READY" not in answer.upper():
            return f"DIAGNOSIS READY: {answer.strip()}"
        return answer

    def _query_with_retry(
        self,
        prompt: str,
        system_prompt: str,
        max_retries: int = 2,
        fallback_text: Optional[str] = None,
    ) -> str:
        for attempt in range(max_retries + 1):
            answer = self.pipe.query_model(
                prompt,
                system_prompt,
                telemetry_metadata={
                    "scenario_id": getattr(self.scenario, "scenario_id", None),
                    "stage": self.current_stage(),
                    "turn_index": self.infs,
                },
            )
            if answer and str(answer).strip():
                return str(answer).strip()
            if attempt < max_retries:
                time.sleep(3.0 * (attempt + 1))
        if fallback_text is not None:
            return fallback_text
        if self.infs == 0:
            return "Could you describe your main symptoms in more detail?"
        return "Could you clarify the single most important unresolved symptom or result right now?"

    def _is_invalid_final_diagnosis(self, answer: str) -> bool:
        if not (answer or "").strip():
            return True
        markers = (
            "UNABLE TO DETERMINE",
            "INSUFFICIENT INFORMATION",
            "UNKNOWN DIAGNOSIS",
            "NO DIAGNOSIS",
            "MOST LIKELY WORKING DIAGNOSIS",
            "[YOUR SINGLE DIAGNOSIS NAME]",
            "[SINGLE DIAGNOSIS NAME ONLY]",
        )
        upper = answer.upper()
        if any(marker in upper for marker in markers):
            return True
        return bool(
            re.search(
                r"DIAGNOSIS READY:\s*\[\s*(?:most likely working diagnosis|your single diagnosis name|single diagnosis name only)\s*\]",
                answer,
                flags=re.IGNORECASE,
            )
        )

    def _extract_top_diagnosis_from_text(self, text: str) -> Optional[str]:
        patterns = [
            r"1\.\s*\*\*([^*\n]+)\*\*",
            r"1\.\s*([^\n–-]+)",
            r"most consistent with ([^.\n]+)",
            r"most likely diagnosis(?: is|:)?\s*([^.\n]+)",
            r"Working Differential:\s*[\r\n]+1\.\s*([^\n]+)",
        ]
        for pattern in patterns:
            match = re.search(pattern, text or "", flags=re.IGNORECASE)
            if match:
                candidate = match.group(1).strip(" :.-[]")
                if candidate:
                    return candidate
        return None

    def _fallback_best_diagnosis_name(self) -> str:
        for source in (self.hospital_consultation, self.agent_hist):
            candidate = self._extract_top_diagnosis_from_text(source)
            if candidate and candidate.strip().lower() != "most likely working diagnosis":
                return candidate
        return "Most likely working diagnosis"

    def _best_effort_diagnosis(self, patient_response: str) -> str:
        prompt = (
            f"Dialogue history:\n{self.agent_hist}\n"
            f"Patient: {patient_response}\n\n"
            "Give the SINGLE most likely diagnosis based only on the information already available.\n"
            "Do not ask for more tests or questions.\n"
            "Output exactly: DIAGNOSIS READY: [your single diagnosis name]\nDoctor: "
        )
        for attempt in range(2):
            answer = self.pipe.query_model(
                prompt,
                self.system_prompt(),
                telemetry_metadata={
                    "scenario_id": getattr(self.scenario, "scenario_id", None),
                    "stage": "best_effort_diagnosis",
                    "turn_index": self.infs,
                },
            )
            if answer and str(answer).strip() and not self._is_invalid_final_diagnosis(answer):
                stripped = str(answer).strip()
                if "DIAGNOSIS READY" in stripped.upper():
                    return stripped
                return f"DIAGNOSIS READY: {stripped}"
            time.sleep(2.0 * (attempt + 1))
        fallback = self._fallback_best_diagnosis_name()
        if not fallback or fallback.strip().lower() == "most likely working diagnosis":
            raise RuntimeError(
                "Unable to produce a concrete final diagnosis from available evidence."
            )
        return f"DIAGNOSIS READY: [{fallback}]"

    def needs_consultation(self, doctor_response: str) -> bool:
        if "REQUEST CONSULTATION" not in doctor_response.upper():
            return False
        if self.consultation_count >= self.max_consultations:
            return False
        if self.infs < self.min_questions_before_consult:
            return False
        if not self.privacy_accountant.can_spend(1.0):
            return False
        return True

    def can_diagnose_after_consult(self) -> bool:
        if self.consultation_count == 0:
            return True
        return self.questions_since_last_consult >= self.must_question_after_consult

    def extract_consultation_request(self, doctor_response: str, epsilon: float = 1.0) -> str:
        del doctor_response
        self.privacy_accountant.spend(epsilon)
        package = prepare_for_hospital(
            self.agent_hist,
            self.pipe,
            epsilon=epsilon,
            scenario_id=getattr(self.scenario, "scenario_id", None),
        )
        self.sanitized_hist = package["anonymized_summary"]
        return self.sanitized_hist

    def receive_hospital_opinion(self, opinion: str) -> None:
        self.hospital_consultation = opinion
        self.consultation_count += 1
        self.questions_since_last_consult = 0

    def add_hist(self, hist_str: str) -> None:
        self.agent_hist += hist_str + "\n\n"
