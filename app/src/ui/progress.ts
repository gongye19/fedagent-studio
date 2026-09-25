import { stageOf, type StageStatus } from "../domain/run";
import { isComplete } from "../domain/selection";
import { scenarioOf } from "../domain/taxonomy";
import type { State } from "../state/store";
import { FLOW_STEPS, isRunStage, type FlowStepId } from "./flow";

export const STATUS_LABEL: Record<StageStatus, string> = {
  pending: "待开始",
  running: "进行中",
  done: "已完成",
  failed: "失败",
};

export type StepState = { state: StageStatus; label: string };

/** 数据接入的数量：节点类场景按节点数，文件类场景按文件数。 */
export function participantsLabel(state: State, count: number): string {
  return scenarioOf(state.selection.scenario)?.input.kind === "nodes" ? `${count} 个节点` : `${count} 份文件`;
}

/** 时间轴每一步的状态，右侧时间轴和手机端进度条共用。 */
export function stepStates(state: State, inputsReady: boolean, datasets: number): Record<FlowStepId, StepState> {
  const { run } = state;
  const configured = isComplete(state.selection);
  const result = {} as Record<FlowStepId, StepState>;
  for (const step of FLOW_STEPS) {
    if (step.id === "configure") {
      result[step.id] = configured ? { state: "done", label: "已就绪" } : { state: "pending", label: "待完成" };
    } else if (step.id === "inputs") {
      result[step.id] = { state: configured && inputsReady ? "done" : "pending", label: configured ? participantsLabel(state, datasets) : "等待配置" };
    } else {
      const stage = run && isRunStage(step.id) ? stageOf(run, step.id) : undefined;
      const value = stage?.status ?? "pending";
      const awaiting = step.id === "publish" && value === "pending" && Boolean(run?.evaluation?.passed);
      result[step.id] = { state: value, label: awaiting ? "待确认发布" : STATUS_LABEL[value] };
    }
  }
  return result;
}

export type RunStatusKey = "draft" | "ready" | "running" | "complete" | "failed";

export const RUN_STATUS_LABEL: Record<RunStatusKey, string> = {
  draft: "草稿",
  ready: "就绪",
  running: "运行中",
  complete: "已完成",
  failed: "失败",
};

export function runStatus(state: State): RunStatusKey {
  const { run } = state;
  if (run?.error) return "failed";
  if (run && stageOf(run, "publish").status === "done") return "complete";
  if (run) return "running";
  return isComplete(state.selection) ? "ready" : "draft";
}
