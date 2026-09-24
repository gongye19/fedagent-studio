/**
 * Run 生命周期状态机。
 *
 * 所有场景共用同一条生命周期：preflight → provision → execute → evaluate → publish。
 * 差异只在模拟器（simulator.ts）按执行模式给出的内容里，这个文件不按场景分支。
 * 规则：准入不通过不能创建沙箱；评测未通过不能发布；发布必须由用户手动确认。
 */
import type { Participant } from "./demo";
import type { FrontendRunPlan } from "./plan";

export type StageId = "preflight" | "provision" | "execute" | "evaluate" | "publish";
export type StageStatus = "pending" | "running" | "done" | "failed";

export const STAGE_ORDER: readonly StageId[] = ["preflight", "provision", "execute", "evaluate", "publish"];

/** 自动推进的阶段；publish 需要用户确认发布范围后手动触发。 */
const AUTO_STAGES: readonly StageId[] = ["preflight", "provision", "execute", "evaluate"];

export type ExecutionPreset = "quick" | "standard";

export const PRESET_LABEL: Record<ExecutionPreset, string> = {
  quick: "快速验证",
  standard: "标准运行",
};

export type Visibility = "owner" | "participants" | "selected";

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  owner: "仅任务创建者",
  participants: "全部参与方",
  selected: "指定参与方",
};

export type CheckStatus = "pass" | "warn" | "fail";

export type PreflightReport = {
  checks: { label: string; detail: string; status: CheckStatus }[];
  agentNote: string;
  passed: boolean;
};

export type MetricResult = {
  name: string;
  baselineLabel: string;
  baseline: string;
  output: string;
  gate: string;
  passed: boolean;
};

export type EvaluationReport = { metrics: MetricResult[]; passed: boolean };

export type PublishedArtifact = {
  name: string;
  type: string;
  lineage: string[];
  visibility: Visibility;
};

export type Stage = {
  id: StageId;
  status: StageStatus;
  detail: string;
  realCost: string;
  logs: string[];
};

export type Run = {
  id: string;
  createdAt: string;
  /** 冻结的计划和参与方：Run 开始后修改配置必须创建新 Run。 */
  plan: FrontendRunPlan;
  participants: Participant[];
  preset: ExecutionPreset;
  stages: Stage[];
  preflight: PreflightReport | null;
  evaluation: EvaluationReport | null;
  artifact: PublishedArtifact | null;
  error: string | null;
};

export type StageResult = {
  detail: string;
  realCost: string;
  logs: string[];
  preflight?: PreflightReport;
  evaluation?: EvaluationReport;
};

export function createRun(
  id: string,
  plan: FrontendRunPlan,
  participants: Participant[],
  preset: ExecutionPreset,
  createdAt: string,
): Run {
  return {
    id,
    createdAt,
    plan,
    participants: participants.map((participant) => ({ ...participant })),
    preset,
    stages: STAGE_ORDER.map((stageId) => ({ id: stageId, status: "pending", detail: "", realCost: "", logs: [] })),
    preflight: null,
    evaluation: null,
    artifact: null,
    error: null,
  };
}

export function stageOf(run: Run, id: StageId): Stage {
  return run.stages.find((stage) => stage.id === id) ?? run.stages[0];
}

function previousDone(run: Run, id: StageId): boolean {
  const index = STAGE_ORDER.indexOf(id);
  return STAGE_ORDER.slice(0, index).every((stageId) => stageOf(run, stageId).status === "done");
}

function patch(run: Run, id: StageId, change: Partial<Stage>): Run {
  return { ...run, stages: run.stages.map((stage) => (stage.id === id ? { ...stage, ...change } : stage)) };
}

/** 下一个应自动开始的阶段；已失败、有阶段在跑或只剩发布时返回 null。 */
export function nextAutoStage(run: Run): StageId | null {
  if (run.error || run.stages.some((stage) => stage.status === "running")) return null;
  return AUTO_STAGES.find((id) => stageOf(run, id).status === "pending" && previousDone(run, id)) ?? null;
}

export function runningStage(run: Run): Stage | undefined {
  return run.stages.find((stage) => stage.status === "running");
}

export function startStage(run: Run, id: StageId): Run {
  if (id === "publish" || run.error) return run;
  if (stageOf(run, id).status !== "pending" || !previousDone(run, id)) return run;
  return patch(run, id, { status: "running" });
}

export function finishStage(run: Run, id: StageId, result: StageResult): Run {
  if (stageOf(run, id).status !== "running") return run;
  let next = patch(run, id, { status: "done", detail: result.detail, realCost: result.realCost, logs: result.logs });
  if (result.preflight) next = { ...next, preflight: result.preflight };
  if (result.evaluation) next = { ...next, evaluation: result.evaluation };

  if (id === "preflight" && result.preflight && !result.preflight.passed) {
    return failStage(next, id, "准入检查未通过，不能创建沙箱");
  }
  if (id === "evaluate" && result.evaluation && !result.evaluation.passed) {
    return failStage(next, id, "评测未通过发布闸门，产物不能发布");
  }
  return next;
}

export function failStage(run: Run, id: StageId, error: string): Run {
  return { ...patch(run, id, { status: "failed" }), error };
}

export function canPublish(run: Run): boolean {
  return !run.error
    && stageOf(run, "evaluate").status === "done"
    && Boolean(run.evaluation?.passed)
    && stageOf(run, "publish").status === "pending";
}

export function publishRun(run: Run, artifact: PublishedArtifact): Run {
  if (!canPublish(run)) return run;
  return {
    ...patch(run, "publish", {
      status: "done",
      detail: `已发布给${VISIBILITY_LABEL[artifact.visibility]}（前端模拟）`,
      realCost: "秒级",
      logs: [`登记产物 ${artifact.name}`, `记录谱系：${artifact.lineage.join("、")}`, `访问范围：${VISIBILITY_LABEL[artifact.visibility]}`],
    }),
    artifact,
  };
}

export function isFinished(run: Run): boolean {
  return Boolean(run.error) || stageOf(run, "publish").status === "done";
}

/** 界面进度条：已完成阶段占比。 */
export function progressOf(run: Run): number {
  return run.stages.filter((stage) => stage.status === "done").length / run.stages.length;
}
