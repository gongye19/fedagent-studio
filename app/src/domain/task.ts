/**
 * 联邦任务：由后端运行（GET /v1/tasks），这里只有类型和从任务算出指标的函数。
 *
 * 每一轮的结果按步骤声明的结果类型（stage.result）记下，不认具体的算法：
 * metric = 各方本轮答对多少，uploads = 各方上传多少条，groups = 服务端归成几类，output = 这一轮的产出。
 */
import type { components } from "../api/schema";
import { algorithmOf, stageOf, type Stage, type StageId } from "./catalog";
import type { TaskConfig } from "./config";

type TaskOut = components["schemas"]["TaskOut"];

export type TaskStatus = TaskOut["status"];

export const TASK_STATUS: Record<TaskStatus, string> = {
  queued: "排队中",
  running: "运行中",
  paused: "已暂停",
  completed: "已完成",
  canceled: "已取消",
};

/** 创建任务时冻结的参与方快照：之后改名或删除参与方、数据集不影响已有任务。 */
export type Member = components["schemas"]["MemberOut"];
export type Cursor = components["schemas"]["CursorOut"];
/** 产出里的一条（FoT 是经验库里的一条经验）。 */
export type OutputItem = components["schemas"]["OutputItem"];
/** 某一轮结束时的产出，供下一轮使用；任意一版都可以发布为应用。 */
export type OutputVersion = components["schemas"]["OutputVersionOut"];
/** 服务端把上传归成的一类，以及每个参与方有几条归到这一类。 */
export type SampleGroup = components["schemas"]["GroupOut"];
export type RoundRecord = components["schemas"]["RoundOut"];

/** 任务：config 是冻结时的配置，字段和新建任务的配置一致。 */
export type Task = Omit<TaskOut, "config"> & { config: TaskConfig & { name?: string; grader?: string } };

export function toTask(task: TaskOut): Task {
  return task as Task;
}

/** 这个任务每轮的步骤，来自所选算法的定义。 */
export function stagesOf(task: Pick<Task, "config">): readonly Stage[] {
  return algorithmOf(task.config.algorithm).stages;
}

/** 还会变化的任务（界面要轮询）。 */
export function isActive(task: Pick<Task, "status">): boolean {
  return task.status === "queued" || task.status === "running";
}

// ——— 指标 ———

export function roundOf(task: Task, round: number): RoundRecord | undefined {
  return task.rounds.find((record) => record.round === round);
}

/** 已有指标的轮次（metric 步骤已完成）。 */
export function scoredRounds(task: Task): number[] {
  return task.rounds.filter((record) => record.correct).map((record) => record.round);
}

export function accuracy(task: Task, member: Member, round: number): number | null {
  const correct = roundOf(task, round)?.correct?.[member.participantId];
  return correct === undefined || member.answered === 0 ? null : correct / member.answered;
}

/** 参与方的简单平均（每方权重相同，与论文的宏平均一致）。 */
export function averageAccuracy(task: Task, round: number): number | null {
  const values = task.members.map((member) => accuracy(task, member, round)).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function latestScoredRound(task: Task): number | null {
  const rounds = scoredRounds(task);
  return rounds.length ? rounds[rounds.length - 1] : null;
}

/** 最新一轮相对第 1 轮（各方独立作答）的变化。 */
export function changeOf(task: Task, member: Member): number | null {
  const latest = latestScoredRound(task);
  if (!latest || latest === 1) return null;
  const first = accuracy(task, member, 1);
  const last = accuracy(task, member, latest);
  return first === null || last === null ? null : last - first;
}

/** 负迁移：最新一轮低于本方第 1 轮的参与方。 */
export function negativeTransfer(task: Task): { count: number; total: number } | null {
  const latest = latestScoredRound(task);
  if (!latest || latest === 1) return null;
  const changes = task.members.map((member) => changeOf(task, member)).filter((value): value is number => value !== null);
  return { count: changes.filter((value) => value < 0).length, total: changes.length };
}

/** 各轮的产出，按轮次排列。 */
export function outputs(task: Task): OutputVersion[] {
  return task.rounds.flatMap((record) => (record.output ? [record.output] : []));
}

export function totalTokens(task: Task): number {
  return task.rounds.reduce((sum, record) => sum + (record.tokens ?? 0), 0);
}

export function totalProblems(task: Pick<Task, "members">): number {
  return task.members.reduce((sum, member) => sum + member.problems, 0);
}

/** 整个任务的完成比例（0–1），用于进度条。服务端步骤只算开始了一半。 */
export function progressOf(task: Task): number {
  const cursor = task.cursor;
  if (!cursor) return task.status === "completed" ? 1 : 0;
  const stages = stagesOf(task);
  const perRound = stages.length;
  const index = Math.max(0, stages.findIndex((stage) => stage.id === cursor.stage));
  let within = 0;
  if (stages[index]?.side === "participant") {
    const total = totalProblems(task);
    const done = task.members.reduce((sum, member) => sum + (cursor.done[member.participantId] ?? 0), 0);
    within = total ? done / total : 0;
  } else if (task.status === "running") {
    within = 0.5;
  }
  return Math.min(1, ((cursor.round - 1) * perRound + index + within) / (task.config.rounds * perRound));
}

export type StepState = "done" | "current" | "pending";

/** 某一轮某一步的状态；暂停或取消的任务停在 current 那一步。 */
export function stepState(task: Task, round: number, stage: StageId): StepState {
  const cursor = task.cursor;
  if (!cursor) return "done";
  if (round < cursor.round) return "done";
  if (round > cursor.round) return "pending";
  const stages = stagesOf(task);
  const current = stages.findIndex((item) => item.id === cursor.stage);
  const index = stages.findIndex((item) => item.id === stage);
  return index < current ? "done" : index === current ? "current" : "pending";
}

/** 每一步的预估耗时（秒）：按算法给出的每步耗时计算，所有参与方的样本共用同一组并发。 */
export function stageSeconds(task: Task, stage: StageId): number {
  const definition = stageOf(algorithmOf(task.config.algorithm), stage);
  if (definition.side === "server") return definition.seconds;
  return Math.ceil(totalProblems(task) / Math.max(1, task.config.workers)) * definition.seconds;
}
