import type { StageId } from "../domain/run";

export const FLOW_STEPS = [
  { id: "configure", label: "Configuration", hint: "逐层选择维度" },
  { id: "inputs", label: "Data & participants", hint: "匹配数据、上传并检查" },
  { id: "preflight", label: "Agent preflight", hint: "硬规则 + Agent 说明" },
  { id: "provision", label: "Provision sandbox", hint: "冻结计划，创建沙箱" },
  { id: "execute", label: "Execute", hint: "按执行模式运行" },
  { id: "evaluate", label: "Evaluate", hint: "独立评测与发布闸门" },
  { id: "publish", label: "Publish", hint: "确认范围后发布" },
] as const;

export type FlowStepId = (typeof FLOW_STEPS)[number]["id"];

export function isRunStage(id: FlowStepId): id is StageId {
  return id !== "configure" && id !== "inputs";
}

export function nextFlowStep(id: FlowStepId): FlowStepId | null {
  const index = FLOW_STEPS.findIndex((step) => step.id === id);
  return FLOW_STEPS[index + 1]?.id ?? null;
}

export function previousFlowStep(id: FlowStepId): FlowStepId | null {
  const index = FLOW_STEPS.findIndex((step) => step.id === id);
  return FLOW_STEPS[index - 1]?.id ?? null;
}
