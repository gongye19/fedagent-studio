"""仅作预算的调用数和 token 区间，不创建模型或预先批准任何调用。"""

from __future__ import annotations

import math
from collections import defaultdict

from ..common import digest


def diverse_first_batch(sources):
    selected = []
    for site in "ABC":
        groups = defaultdict(list)
        for row in sources:
            if row["site"] == site:
                groups[row["group"]].append(row)
        for group in sorted(groups, key=digest)[:10]:
            selected.append(min(groups[group], key=lambda r: r["id"]))
    return selected


def counts(n, cases, arms=2, sites=3, local=False, mcq=0):
    criteria = sum(len(row["reference"]["rubrics"]) for row in cases)
    generation = 3 * n + 2 + (2 * sites if local else 0)
    return {
        "generation": generation,
        "syntheticProcesses": n,
        "reflectAndExtract": 2 * n,
        "sharedAggregation": 2,
        "optionalLocalAggregation": 2 * sites if local else 0,
        "recommendationAnswers": arms * len(cases),
        "individualRubricGrades": arms * criteria,
        "mcqAnswers": arms * mcq,
        "total": generation + arms * (len(cases) + criteria + mcq),
    }


def estimate(training, evaluation, calibration):
    sources = [r for r in training if r["tier"] == "recommendation-evidence"]
    support = [r for r in training if r["tier"] == "support-knowledge"]
    cases = [r for r in evaluation if r["purpose"] == "recommendation-eval"]
    mcq = [r for r in evaluation if r["purpose"] == "knowledge-eval"]
    # Stable stratification independent of any future answers/scores.
    first = diverse_first_batch(sources)
    first_cases = sorted(cases, key=lambda r: r["id"])[:24]
    proposals = {}
    for key, selected, tests, extra in (
        ("first-recommendation-batch", first, first_cases, 0),
        ("all-recommendation-candidates", sources, cases, 0),
        ("with-exam-support-and-secondary-test", sources + support, cases, len(mcq)),
    ):
        n = len(selected)
        base = counts(n, tests, mcq=extra)
        chars = sum(len(str(r["reference"])) + len(r["question"]) for r in selected)
        prompt_chars = sum(sum(len(m["content"]) for m in r["messages"]) for r in tests)
        rubric_chars = sum(sum(len(x["criterion"]) for x in r["reference"]["rubrics"]) for r in tests)
        # Includes repeated HB conversation+answer for EACH criterion. Chinese advice estimated 1500 chars.
        grade_context = sum(
            len(r["reference"]["rubrics"]) * (sum(len(m["content"]) for m in r["messages"]) + 1500 + 1200)
            + sum(len(x["criterion"]) for x in r["reference"]["rubrics"])
            for r in tests
        )
        input_chars = 3 * chars + n * 10000 + 2 * prompt_chars + 2 * grade_context + extra * 2 * 3500
        # Whole-library context in every answer and grade; assume <=1500 chars per source record (not an algorithm cap).
        input_chars += len(tests) * n * 1500 + extra * n * 1500
        low, high = calibration["promptTokensPerCharRange"]
        output_low = n * 2400 + 2 * len(tests) * 500 + base["individualRubricGrades"] * 50 + extra * 20 + 4000
        output_high = n * (2200 + 16384 + 8192) + 32768 + 16384 + 2 * len(tests) * 1800 + base["individualRubricGrades"] * 512 + extra * 400
        proposals[key] = {
            "generationCandidates": n,
            "recommendationCases": len(tests),
            "secondaryMcqCases": extra,
            "requiresSecondaryTopicalAudit": extra > 0,
            "baseCallsWithoutRetriesOrProbe": base,
            "optionalThirdArmAdditionalCalls": len(tests) + sum(len(r["reference"]["rubrics"]) for r in tests),
            "optionalLocalLibraryAdditionalCalls": 6,
            "inputTokenPlanningRange": [
                math.ceil(input_chars * low),
                math.ceil(input_chars * high),
            ],
            "outputTokenPlanningRange": [output_low, output_high],
            "sourceChars": chars,
            "conversationChars": prompt_chars,
            "rubricChars": rubric_chars,
            "oneTaskApproved": False,
            "requiresBatchDesign": n > 30,
            "selectedGenerationIds": [r["id"] for r in selected] if key.startswith("first") else [],
            "selectedEvaluationIds": [r["id"] for r in tests] if key.startswith("first") else [],
        }
    return {
        "status": "estimate-only-awaiting-user-budget",
        "proposals": proposals,
        "calibration": calibration,
        "firstTaskOperationalCap": 30,
        "maxTracesPerRecord": 3,
        "profileOutputCapTokens": 32768,
        "providerContextWindowVerified": False,
        "notes": [
            "先做推荐依据层；考试支撑层单列，不把考题正确率当推荐有效性。候选均未获临床审核。",
            "辅助选择题评测候选尚未逐题做主题审核，扩展层调用数只是假设场景，审核后数量需更新，不可据此直接启动。",
            "基础：3N+2（过程生成、反思、提取和共享归类/建库）。本站库额外2S；每条HealthBench评分规则单独一次调用。",
            "未包含连接探测、失败和格式修正；extract最多2次、profile/library各最多5次，传输重试须另设全局预算。",
            "token区间是情景估计，不是实际账单或硬上界。源英文、旧实测输出中文；真实长度/隐藏token/经验库大小均未知。",
            "input估计含来源重复、每记录10000字符过程/反思、每记录1500字符经验，以及评分逐项重发上下文；若超出假设必须重估。",
            "最多3条解题经验是输入归类的trace上限，不是最终经验数。最终经验库保持paper-auto。",
            "首任务30条/最多90个trace为保守运行限制，不声称模型上下文硬容量。实际生成后须用真实trace预检profile输入与32768输出空间。",
            "大池不是一个FoT任务；未经验证不合并为巨型单次归类，也不静默改成分层聚合。",
            "原运行器50调用上限、单方单记录结构不支持本正式批次；扩容和新HealthBench/MCQ评测通道均未实现。",
            "HealthBench须保留原对话和有符号权重；不能复用当前1–12布尔规则评分器。未来专用通道须统一作答语言。",
            "MedQuAD文档留出只保留，尚无独立评分器，不计入评测调用量。",
            "未核实David AI实际单价，不给美元数：费用=输入token×输入单价/1e6+输出token×输出单价/1e6。",
        ],
    }
