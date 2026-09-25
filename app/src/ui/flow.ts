import type { StageId } from "../domain/run";

export const FLOW_STEPS = [
  { id: "configure", label: "配置", hint: "逐层选择维度" },
  { id: "inputs", label: "数据接入", hint: "连接节点或上传文件" },
  { id: "preflight", label: "准入检查", hint: "硬规则 + Agent 说明" },
  { id: "provision", label: "创建沙箱", hint: "冻结计划，创建沙箱" },
  { id: "execute", label: "执行", hint: "按执行模式运行" },
  { id: "evaluate", label: "评测", hint: "独立评测与发布闸门" },
  { id: "publish", label: "发布", hint: "确认范围后发布" },
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
