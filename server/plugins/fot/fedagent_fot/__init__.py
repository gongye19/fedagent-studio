"""算法插件：FoT（Federation over Text，arXiv:2604.16778）。

来源是已审计的论文复现器 run_paper_reproduction.py，拆成清单里的六个步骤，行为保持一致：
- 参与方：解题（Prompt 1，第 1 轮没有经验库，就是本地基线）→ 反思（Prompt 2）→ 提取解题经验（Prompt 3）；
- 服务端：汇总本轮全部解题经验 → 归类（Prompt 4）→ 生成下一轮的经验库（Prompt 5）。
生成参数用论文附录 C 的取值（temperature 0.7、top_p 0.9，每一步各自的输出上限）。
标准答案只用于判分：平台默认不把 answer 交给任何一步。
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

from fedagent_sdk import (
    Algorithm,
    ApplyRequest,
    ApplyResult,
    Artifact,
    Model,
    OutputEntry,
    StepContext,
    StepFailed,
    TaskSpec,
    load_manifest,
    step,
)
from fedagent_sdk.jsonutil import extract_json_object

from . import prompts
from .fake import fake_reply
from .parsing import (
    extract_trace_object,
    normalize_profile_for_library,
    retry_note,
    valid_trace_dict,
    validate_library_object,
    validate_profile_object,
)

GENERATION = {"temperature": 0.7, "top_p": 0.9}
MAX_TOKENS = {"solve": 32768, "reflect": 16384, "extract": 8192, "profile": 32768, "library": 16384}
TRACE_ATTEMPTS = 2
"""复现器：提取经验最多试 2 次。"""


class FoT(Algorithm):
    manifest = load_manifest(Path(__file__).with_name("manifest.yaml"))

    def prompt_hashes(self) -> dict[str, str]:
        texts = {
            "prompt1_solve": prompts.solve_prompt("{problem}", {"{name}": "{description}"}) + prompts.MATH_SUFFIX,
            "prompt2_reflection": prompts.REFLECTION_TEMPLATE,
            "prompt3_trace": prompts.TRACE_TEMPLATE,
            "prompt4_profiling": prompts.PROFILING_TEMPLATE,
            "prompt5_library": prompts.LIBRARY_TEMPLATE,
        }
        return {name: hashlib.sha256(text.encode()).hexdigest() for name, text in texts.items()}

    def exchange_per_item(self, channel: str, spec: TaskSpec) -> float:
        per_item = 0.9 if spec.params.get("traceDensity") == "paper-gemini" else 1.5
        cap = spec.params.get("maxTracesPerItem")
        return min(per_item, cap) if isinstance(cap, int) else per_item

    # —— 参与方 ——

    @staticmethod
    def _problem(ctx: StepContext) -> str:
        return prompts.problem_text(str(ctx.item["question"]))

    def model_settings(self) -> dict[str, Any]:
        return {"max_tokens": max(MAX_TOKENS.values()), **GENERATION}

    @step("solve")
    def solve(self, ctx: StepContext) -> None:
        artifact = ctx.artifact()
        library = artifact.content if artifact is not None else {}
        reply = ctx.model.chat(prompts.solve_prompt(self._problem(ctx), library), max_tokens=MAX_TOKENS["solve"], **GENERATION)
        if not reply.text.strip():
            raise StepFailed("解题的回答是空的")
        ctx.keep("solution", reply.text)
        ctx.predict(reply.text)

    @step("reflect")
    def reflect(self, ctx: StepContext) -> None:
        solution = ctx.recall("solution")
        if solution is None:
            raise StepFailed("找不到这道题本轮的解答", pause=True)
        reply = ctx.model.chat(prompts.reflection_prompt(self._problem(ctx), solution), max_tokens=MAX_TOKENS["reflect"], **GENERATION)
        if not reply.text.strip():
            raise StepFailed("反思的回答是空的")
        ctx.keep("reflection", reply.text)

    @step("extract")
    def extract(self, ctx: StepContext) -> None:
        solution = ctx.recall("solution")
        reflection = ctx.recall("reflection")
        if solution is None or reflection is None:
            raise StepFailed("找不到这道题本轮的解答或反思", pause=True)
        density = str(ctx.params.get("traceDensity", "native"))
        prompt = prompts.trace_prompt(self._problem(ctx), solution, reflection, density)
        traces: dict[str, str] = {}
        for _ in range(TRACE_ATTEMPTS):
            reply = ctx.model.chat(prompt, max_tokens=MAX_TOKENS["extract"], **GENERATION)
            traces = valid_trace_dict(extract_trace_object(reply.text))
            if traces and not (density == "paper-gemini" and len(traces) > 1):
                break
        if not traces:
            ctx.log("两次都没有取到合格的解题经验，这道题本轮不上传")
        elif density == "paper-gemini" and len(traces) > 1:
            ctx.log(f"校准要求每题至多 1 条，模型给了 {len(traces)} 条，按原样上传")
        cap = ctx.params.get("maxTracesPerItem")
        entries = list(traces.items())
        if isinstance(cap, int):
            entries = entries[:cap]
        for name, description in entries:
            ctx.send("trace", {"name": name, "description": description})

    # —— 服务端 ——

    @step("collect")
    def collect(self, ctx: StepContext) -> None:
        messages = ctx.inbox("trace")
        # 复现器按样本 id 排序，同一道题的经验保持上传顺序，键名加全局序号；样本 id 相同时再按发送方排
        ordered = sorted(enumerate(messages), key=lambda pair: (pair[1].item_id or "", pair[1].sender, pair[0]))
        store: dict[str, str] = {}
        origin: dict[str, str] = {}
        for occurrence, (_, message) in enumerate(ordered, start=1):
            key = f"{message.payload['name']}_{occurrence:06d}"
            store[key] = str(message.payload["description"])
            origin[key] = message.sender
        if not store:
            raise StepFailed("本轮没有可汇总的解题经验", pause=True)
        ctx.keep("trace_store", store)
        ctx.keep("trace_origin", origin)
        ctx.report("received", len(store))

    def _aggregate(self, ctx: StepContext, prompt: str, stage: str, check: Any) -> Any:
        limit = int(ctx.params.get("aggregationRetries", 5))
        reason = ""
        for attempt in range(1, limit + 1):
            text = prompt if attempt == 1 else prompt + retry_note(reason)
            reply = ctx.model.chat(text, max_tokens=MAX_TOKENS[stage], **GENERATION)
            value, reason = check(extract_json_object(reply.text))
            if value is not None:
                return value
            ctx.log(f"第 {attempt} 次结果不合法：{reason}")
        label = "归类" if stage == "profile" else "生成经验库"
        raise StepFailed(f"{label}的结果连续 {limit} 次不合法（{reason}）", pause=True)

    @step("profile")
    def profile(self, ctx: StepContext) -> None:
        store: dict[str, str] = ctx.recall("trace_store")
        origin: dict[str, str] = ctx.recall("trace_origin")

        def check(profile: dict[str, Any] | None) -> tuple[dict[str, Any] | None, str]:
            ok, reason = validate_profile_object(profile, store)
            return (profile if ok else None), reason

        profile = self._aggregate(ctx, prompts.profiling_prompt(store), "profile", check)
        normalized = normalize_profile_for_library(profile)
        ctx.keep("profile", normalized)
        groups = []
        for cluster in normalized["clusters"]:
            members = cluster.get("traces", cluster.get("insights", []))
            counts = Counter(origin[str(member)] for member in members)
            groups.append({"name": str(cluster.get("cluster_name") or f"类别 {cluster.get('cluster_id', len(groups))}"), "uploads": dict(counts)})
        ctx.report("groups", groups)

    @step("library")
    def library(self, ctx: StepContext) -> None:
        store: dict[str, str] = ctx.recall("trace_store")
        profile: dict[str, Any] = ctx.recall("profile")
        previous = ctx.artifact()
        target = str(ctx.params.get("insightTarget", "paper-auto")).removeprefix("fixed-")
        prompt = prompts.library_prompt(store, profile, previous.content if previous is not None else {}, target)
        library = self._aggregate(ctx, prompt, "library", validate_library_object)
        ctx.publish(library)
        ctx.report("output", len(library))

    # —— 产出的用法 ——

    def apply(self, artifact: Artifact | None, request: ApplyRequest, model: Model) -> ApplyResult:
        """带经验库时按解题提示词（Prompt 1）把整份经验库放进上下文；不带时只给题目。"""
        library = artifact.content if artifact is not None else {}
        reply = model.chat(prompts.solve_prompt(prompts.problem_text(str(request.input)), library), max_tokens=MAX_TOKENS["solve"], **GENERATION)
        return ApplyResult(output=reply.text, usage=reply.usage)

    def export(self, artifact: Artifact, fmt: str = "json") -> tuple[str, str, bytes]:
        """与复现器的 library_r{n}.json 同格式（经验名 → 描述）；第 n 轮生成的经验库供第 n+1 轮用。"""
        body = json.dumps(artifact.content, ensure_ascii=False, indent=2).encode()
        return f"library_r{artifact.round + 1}.json", "application/json", body

    def describe(self, artifact: Artifact) -> list[OutputEntry]:
        return [OutputEntry(key=str(name), text=str(text)) for name, text in dict(artifact.content).items()]

    def fake_reply(self, step_id: str | None, prompt: str, seed: str) -> str | None:
        return fake_reply(step_id, prompt, seed)


__all__ = ["FoT"]
