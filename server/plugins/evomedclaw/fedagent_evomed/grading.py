"""复用原版包含匹配、临床等价提示词与0.75阈值；异常不得冒充零分。"""
from collections.abc import Mapping
from typing import Any, cast

from fedagent_sdk import Grader, Model, ModelError

from .bridge import use_model


class DiagnosisClinicalGrader(Grader):
    id = "diagnosis-clinical"
    label = "原版诊断判分"
    detail = ("先按原仓库检查诊断名称、缩写等包含关系；未命中时由独立模型比较临床等价程度，达到0.75通过。"
              "模型异常会中止判分，不计为错误。此指标不是临床有效性验证。")
    requires_model = True

    def grade(self, prediction: Any, item: Mapping[str, Any]) -> bool:
        return self.evaluate(prediction, item)

    def evaluate(self, prediction: Any, item: Mapping[str, Any], model: Model | None = None) -> bool:
        from .vendor.runtime.department_first.standalone import compare_results

        text = str(prediction or "").strip()
        answer = str(item.get("answer") or "").strip()
        if not text or not answer:
            return False
        # 模型调用和格式错误由平台重试，避免原版 catch-all 把基础设施错误记成答错。
        moderator = _Moderator(model)
        result = compare_results(text, answer, cast(Any, moderator), tries=1, timeout=0)
        if moderator.error is not None:
            raise moderator.error
        return result


class _Moderator:
    def __init__(self, model: Model | None):
        self.model = model
        self.error: Exception | None = None

    def query_model(self, prompt, system_prompt, **_):
        import math
        import re
        try:
            if self.model is None:
                raise ModelError("该诊断需要评测模型，请先选择评测模型")
            with use_model(self.model) as bridge:
                reply = bridge.query(prompt, system_prompt, 2048)
            if reply.startswith("[") and reply.endswith("]"):
                score = float(reply[1:-1].strip())
            else:
                match = re.search(r"\[?\s*(0\.\d+|1(?:\.0+)?)\s*\]?", reply)
                if match is None:
                    raise ValueError("missing score")
                score = float(match.group(1))
            if not math.isfinite(score) or not 0 <= score <= 1:
                raise ValueError("invalid score")
            return reply
        except Exception as error:
            self.error = ModelError("评测模型未返回有效的0–1评分，请重试") if isinstance(error, ValueError) else error
            raise self.error from error
