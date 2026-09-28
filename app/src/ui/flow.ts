import type { StageId } from "../domain/run";

/** 项目详情的七步时间轴：配置（已锁定）→ 参与方 → 运行的五个阶段。 */
export const FLOW_STEPS = [
  { id: "configure", label: "配置" },
  { id: "participants", label: "参与方" },
  { id: "preflight", label: "准入检查" },
  { id: "provision", label: "创建环境" },
  { id: "execute", label: "执行" },
  { id: "evaluate", label: "评测" },
  { id: "publish", label: "交付" },
] as const;

export type FlowStepId = (typeof FLOW_STEPS)[number]["id"];

export function isRunStage(id: FlowStepId): id is StageId {
  return id !== "configure" && id !== "participants";
}

export function nextFlowStep(id: FlowStepId): FlowStepId | null {
  const index = FLOW_STEPS.findIndex((step) => step.id === id);
  return FLOW_STEPS[index + 1]?.id ?? null;
}

export function previousFlowStep(id: FlowStepId): FlowStepId | null {
  const index = FLOW_STEPS.findIndex((step) => step.id === id);
  return FLOW_STEPS[index - 1]?.id ?? null;
}

export function labelOf(id: FlowStepId | null): string {
  return FLOW_STEPS.find((step) => step.id === id)?.label ?? "";
}
