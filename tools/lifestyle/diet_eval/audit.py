"""经验正文不改；只按输入条件选择，保留每条经验的审计和不适用原因。"""

from decimal import Decimal, InvalidOperation

from ..common import digest

# 这是接入层人工审计的适用条件，不冒充FoT自动学出的规则或已验证健康效益。
# 条件匹配值均来自用户输入；数值规则的血糖界值只用于提示复核，不用于诊断。
POLICY = {
    "evidenceQualityGating": ("通用证据核查", 90, ["allergens_missing", "local_foods_missing"], []),
    "evidenceBoundaryAndCausalInference": ("通用证据边界", 100, ["causal_claim"], []),
    "uncertaintyCalibratedRecommendations": (
        "通用不确定性策略",
        85,
        ["anthropometrics_missing", "allergens_missing", "local_foods_missing", "evidence_question"],
        [],
    ),
    "standardizedRepeatedMeasurement": ("测量复核策略", 65, ["measurement_comparison"], []),
    "confirmatoryThresholdEscalation": ("异常观测复核", 95, ["screening_review"], []),
    "balancedStructuralIntervention": ("饮食结构策略", 80, ["meal_structure"], ["allergens_missing", "anthropometrics_missing"]),
    "gapBasedNextAction": ("补足缺口策略", 75, ["nutrient_gap", "sugar_habit"], ["allergens_missing"]),
    "singleVariableFeedbackLoop": ("小步反馈策略", 70, ["sugar_habit", "self_monitoring"], []),
    "contextualSafetyGate": ("风险上下文策略", 100, ["older_vegan", "health_context_missing", "known_diabetes", "allergens_missing"], []),
    "reversibleLowRiskDefault": ("渐进调整策略", 70, ["aggressive_change", "sugar_habit"], []),
}


def numeric_features(value):
    def number(raw):
        if isinstance(raw, bool):
            return None
        try:
            parsed = Decimal(str(raw))
            return parsed if parsed.is_finite() and parsed >= 0 else None
        except InvalidOperation:
            return None

    fasting = number(value.get("profile", {}).get("fasting_glucose_mg_dl"))
    fiber = number(value.get("logged_meal", {}).get("nutrition_estimates", {}).get("fiber_g"))
    return {"screening_review": fasting is not None and fasting >= 100, "nutrient_gap": fiber is not None and fiber == 0}


def audit_library(library):
    expected = {"insight_" + key for key in POLICY}
    if set(library) != expected or not all(isinstance(v, str) and v.strip() for v in library.values()):
        raise ValueError("reviewed-library-version-required")
    return {
        "libraryDigest": digest(library),
        "entries": [
            {
                "id": "insight_" + key,
                "category": category,
                "priority": priority,
                "requiresAnyInputFact": yes,
                "blockedByInputFacts": no,
                "evidenceStatus": "模型模拟建议提取，尚无干预或个性化增益验证",
                "provenanceLevel": "batch-only; original library has no per-entry source mapping",
                "healthBenefitValidated": False,
            }
            for key, (category, priority, yes, no) in POLICY.items()
        ],
        "conclusion": "有通用安全与决策策略，但不能据生成数量认定存在新的有效个性化饮食知识。",
        "thresholdSource": "https://www.niddk.nih.gov/health-information/diabetes/overview/tests-diagnosis",
    }


def retrieve(features, library):
    audit = audit_library(library)
    matched, excluded = [], []
    for entry in audit["entries"]:
        yes = [key for key in entry["requiresAnyInputFact"] if features.get(key) is True]
        no = [key for key in entry["blockedByInputFacts"] if features.get(key) is True]
        if yes and not no:
            matched.append((entry, yes))
        else:
            excluded.append({"id": entry["id"], "reason": "blocked-by-input" if no else "no-matching-input-condition", "facts": no})
    matched.sort(key=lambda pair: (-pair[0]["priority"], pair[0]["id"]))
    chosen, reasons, used = {}, [], 0
    for entry, yes in matched:
        text = library[entry["id"]]
        if len(chosen) == 4 or used + len(entry["id"]) + len(text) > 12000:
            excluded.append({"id": entry["id"], "reason": "complete-entry-context-limit", "facts": yes})
            continue
        chosen[entry["id"]] = text
        used += len(entry["id"]) + len(text)
        reasons.append({"id": entry["id"], "matchedInputFacts": yes})
    return chosen, {
        "libraryDigest": digest(library),
        "selected": reasons,
        "excluded": excluded,
        "chars": used,
        "eligible": bool(chosen),
        "zeroScorePadding": False,
        "annotationNotLearnedRule": True,
    }
