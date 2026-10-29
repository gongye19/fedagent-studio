"""只并行同一会诊中独立的专家意见；原提示词、顺序、汇总与仲裁保持不变。"""
from concurrent.futures import ThreadPoolExecutor

from fedagent_sdk import ForkableModel

from .vendor.runtime.department_first.core.specialist_agent import DepartmentSpecialistService


class ParallelSpecialists(DepartmentSpecialistService):
    def _query_department_panel(self, prompt, system_prompt, department, anonymized_case, scenario_id):
        from .bridge import current_bridge, use_model
        parent = current_bridge()
        if not isinstance(parent.model, ForkableModel):
            return super()._query_department_panel(prompt, system_prompt, department, anonymized_case, scenario_id)
        fork = parent.model.fork
        self._panel_sequence = getattr(self, "_panel_sequence", 0) + 1
        sequence = self._panel_sequence
        models = self._expert_models_for_department(department)
        from contextvars import copy_context

        def opinion(index, model_name):
            model = fork(f"panel:{sequence}:{department}:expert:{index}")
            with use_model(model) as branch:
                value = self._query_specialist(
                    model_name=model_name,
                    prompt=f"{prompt}\n\nDepartment expert {index} model: {model_name}\nProvide your own structured opinion before seeing any consensus.",
                    system_prompt=system_prompt, department=department, anonymized_case=anonymized_case,
                    scenario_id=scenario_id, expert_index=index)
            return value, dict(branch.usage)

        # 分支内模型账本和上下文独立；模型网关仍统一限制全部进程的实际请求并发。
        with ThreadPoolExecutor(max_workers=min(3, max(1, len(models)))) as pool:
            futures = [pool.submit(copy_context().run, opinion, index, name) for index, name in enumerate(models, 1)]
            results = [future.result() for future in futures]
        opinions = []
        for value, usage in results:
            opinions.append(value)
            for key, count in usage.items():
                parent.usage[key] += count
        consensus_model = self._consensus_model_for_department(department)
        final = opinions[0]
        if len(opinions) > 1:
            final = self._query_department_consensus(anonymized_case=anonymized_case, department=department,
                system_prompt=system_prompt, expert_models=models, expert_opinions=opinions,
                consensus_model=consensus_model, scenario_id=scenario_id)
        if not final.strip():
            final = self._fallback_opinion(anonymized_case=anonymized_case, department=department)
        return final, models, opinions, consensus_model
