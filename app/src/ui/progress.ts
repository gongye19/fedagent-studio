import { projectStatus, readiness, type Project, type ProjectStatus } from "../domain/project";
import { runningStage, stageOf, type StageStatus } from "../domain/run";
import type { Tone } from "./common";
import { FLOW_STEPS, isRunStage, type FlowStepId } from "./flow";

export const STATUS_LABEL: Record<StageStatus, string> = {
  pending: "待开始",
  running: "进行中",
  done: "已完成",
  failed: "失败",
};

export const STAGE_TONE: Record<StageStatus, Tone | undefined> = {
  pending: undefined,
  running: "running",
  done: "complete",
  failed: "failed",
};

export const PROJECT_TONE: Record<ProjectStatus, Tone | undefined> = {
  forming: undefined,
  ready: "ready",
  waiting: undefined,
  running: "running",
  "awaiting-delivery": "ready",
  delivered: "complete",
  failed: "failed",
};

export type StepState = { state: StageStatus; label: string };

/** 时间轴每一步的状态，右侧时间轴和手机端进度条共用。 */
export function stepStates(project: Project): Record<FlowStepId, StepState> {
  const { run } = project;
  const progress = readiness(project);
  const result = {} as Record<FlowStepId, StepState>;
  for (const step of FLOW_STEPS) {
    if (step.id === "configure") {
      result[step.id] = { state: "done", label: "已锁定" };
    } else if (step.id === "participants") {
      result[step.id] = run
        ? { state: "done", label: `${run.participants.length} 方参加` }
        : { state: progress.ready ? "done" : "pending", label: `${progress.confirmed} / ${progress.min} 方已确认` };
    } else if (isRunStage(step.id)) {
      const value = run ? stageOf(run, step.id).status : "pending";
      const awaiting = step.id === "publish" && value === "pending" && Boolean(run?.evaluation?.passed) && !run?.error;
      const label = awaiting ? (project.role === "initiator" ? "待确认交付" : "待发起方交付") : STATUS_LABEL[value];
      result[step.id] = { state: value, label };
    }
  }
  return result;
}

/** 打开项目时默认停在哪一步：未开始停在参与方；运行中停在当前阶段；结束后停在交付。 */
export function currentStep(project: Project): FlowStepId {
  const { run } = project;
  if (!run) return "participants";
  const running = runningStage(run);
  if (running) return running.id;
  const failed = run.stages.find((stage) => stage.status === "failed");
  if (failed) return failed.id;
  return run.stages.find((stage) => stage.status === "pending")?.id ?? "publish";
}

export { projectStatus };
