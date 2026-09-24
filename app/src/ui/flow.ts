import type { StageId } from "../domain/run";

export const FLOW_STEPS = [
  { id: "configure", label: "Configuration" },
  { id: "upload", label: "Data upload" },
  { id: "preflight", label: "Agent preflight" },
  { id: "provision", label: "Provision sandbox" },
  { id: "federate", label: "Execute federation" },
  { id: "evaluate", label: "Evaluate output" },
  { id: "publish", label: "Publish artifact" },
] as const;

export type FlowStepId = (typeof FLOW_STEPS)[number]["id"];

export function isRunStage(id: FlowStepId): id is StageId {
  return id !== "configure" && id !== "upload";
}

export function nextFlowStep(id: FlowStepId): FlowStepId | null {
  const index = FLOW_STEPS.findIndex((step) => step.id === id);
  return FLOW_STEPS[index + 1]?.id ?? null;
}

export function previousFlowStep(id: FlowStepId): FlowStepId | null {
  const index = FLOW_STEPS.findIndex((step) => step.id === id);
  return FLOW_STEPS[index - 1]?.id ?? null;
}
