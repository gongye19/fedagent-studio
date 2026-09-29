/**
 * 联邦任务：创建时冻结配置和参与方，之后按所选算法在注册表里定义的步骤逐轮推进（FoT 每轮 6 步）。
 *
 * 前端原型用节拍模拟推进（tick），每完成一步就把这一步的示例结果记进 RoundRecord；
 * 接入后端后，进度和结果改为读取运行目录里的检查点，状态机本身不变。
 */
import { algorithmOf, stageOf, type Stage, type StageId } from "./catalog";
import { clientModelOf, problemsOf, selectedDatasets, type TaskConfig } from "./config";
import type { Dataset, Participant } from "./resources";
import { librarySize, rankedPool, sampleClusters, sampleCorrect, sampleTokens, sampleTraceCount } from "./sample";

export type TaskStatus = "running" | "paused" | "completed" | "canceled";

export const TASK_STATUS: Record<TaskStatus, string> = {
  running: "运行中",
  paused: "已暂停",
  completed: "已完成",
  canceled: "已取消",
};

/** 创建任务时冻结的参与方快照：之后改名或删除参与方不影响已有任务。 */
export type Member = {
  datasetId: string;
  dataset: string;
  participantId: string;
  participant: string;
  hosting: Participant["hosting"];
  problems: number;
  /** 本次使用的题目中带标准答案的题数；为 0 时这一方不计准确率。 */
  answered: number;
  model: string;
};

export type Cursor = {
  round: number;
  stage: StageId;
  /** 参与方步骤：每份数据已完成的题数。 */
  done: Record<string, number>;
  /** 服务端步骤已走过的模拟节拍。 */
  ticks: number;
};

export type LibraryVersion = {
  /** 由第几轮的 trace 生成，供下一轮使用。 */
  builtAfterRound: number;
  insights: { key: string; text: string; category: string }[];
  clusters: { name: string; traces: Record<string, number> }[];
  traceCount: number;
  relationships: number;
};

export type RoundRecord = {
  round: number;
  /** 解题完成后：每份数据答对的题数。 */
  correct?: Record<string, number>;
  /** 提取完成后：每个参与方上传的 trace 数。 */
  traces?: Record<string, number>;
  tokens?: number;
  library?: LibraryVersion;
};

export type Task = {
  id: string;
  name: string;
  createdAt: string;
  finishedAt?: string;
  config: TaskConfig;
  members: Member[];
  status: TaskStatus;
  /** 当前所在的轮次和步骤；完成后为 null，暂停或取消时停在原处。 */
  cursor: Cursor | null;
  rounds: RoundRecord[];
};

/** 服务端每一步占用的模拟节拍数。 */
export const SERVER_TICKS = 2;

/** 这个任务每轮的步骤，来自所选算法的定义。 */
export function stagesOf(task: Pick<Task, "config">): readonly Stage[] {
  return algorithmOf(task.config.algorithm).stages;
}

export function createTask(input: {
  id: string;
  name: string;
  createdAt: string;
  config: TaskConfig;
  datasets: readonly Dataset[];
  participants: readonly Participant[];
}): Task {
  const members = selectedDatasets(input.config, input.datasets).map((dataset): Member => {
    const owner = input.participants.find((participant) => participant.id === dataset.participantId);
    const problems = problemsOf(input.config, dataset);
    const answered = dataset.answered >= dataset.count ? problems : Math.round((problems * dataset.answered) / Math.max(dataset.count, 1));
    return {
      datasetId: dataset.id,
      dataset: dataset.name,
      participantId: dataset.participantId,
      participant: owner?.name ?? dataset.name,
      hosting: owner?.hosting ?? "platform",
      problems,
      answered,
      model: clientModelOf(input.config, dataset.id),
    };
  });
  return {
    id: input.id,
    name: input.name,
    createdAt: input.createdAt,
    config: input.config,
    members,
    status: "running",
    cursor: { round: 1, stage: algorithmOf(input.config.algorithm).stages[0].id, done: {}, ticks: 0 },
    rounds: [],
  };
}

function withRound(rounds: readonly RoundRecord[], round: number, change: (record: RoundRecord) => RoundRecord): RoundRecord[] {
  const existing = rounds.find((record) => record.round === round) ?? { round };
  return [...rounds.filter((record) => record.round !== round), change(existing)].sort((a, b) => a.round - b.round);
}

function recordStage(task: Task, record: RoundRecord, stage: StageId): RoundRecord {
  const round = record.round;
  switch (stage) {
    case "solve": {
      const previous = task.rounds.find((item) => item.round === round - 1)?.correct;
      const correct: Record<string, number> = {};
      for (const member of task.members) {
        if (member.answered > 0) {
          correct[member.datasetId] = sampleCorrect(task.id, member.datasetId, member.answered, round, previous?.[member.datasetId]);
        }
      }
      return { ...record, correct };
    }
    case "extract": {
      const perProblem = algorithmOf(task.config.algorithm).exchangeVolume.perSample(task.config);
      const traces = Object.fromEntries(task.members.map((member) => [
        member.datasetId,
        sampleTraceCount(task.id, member.datasetId, member.problems, round, perProblem, task.config.maxTracesPerItem),
      ]));
      return { ...record, traces };
    }
    case "library": {
      const traces = record.traces ?? {};
      const traceCount = Object.values(traces).reduce((sum, value) => sum + value, 0);
      const entries = rankedPool(task.id, task.members.map((member) => member.datasetId))
        .slice(0, librarySize(task.config.insightTarget, round, traceCount));
      const problems = task.members.reduce((sum, member) => sum + member.problems, 0);
      return {
        ...record,
        tokens: sampleTokens(task.id, round, problems, traceCount),
        library: {
          builtAfterRound: round,
          insights: entries.map((entry) => ({ key: entry.key, text: entry.insight, category: entry.category })),
          clusters: sampleClusters(entries, traces),
          traceCount,
          relationships: Math.round(traceCount * 0.35),
        },
      };
    }
    default:
      return record;
  }
}

/** 完成当前步骤：记下这一步的结果，进入下一步、下一轮，或结束任务。 */
export function completeStage(task: Task, now: string): Task {
  const cursor = task.cursor;
  if (!cursor) return task;
  const rounds = withRound(task.rounds, cursor.round, (record) => recordStage(task, record, cursor.stage));
  const stages = stagesOf(task);
  const index = stages.findIndex((stage) => stage.id === cursor.stage);
  const next = stages[index + 1];
  if (next) return { ...task, rounds, cursor: { round: cursor.round, stage: next.id, done: {}, ticks: 0 } };
  if (cursor.round < task.config.rounds) {
    return { ...task, rounds, cursor: { round: cursor.round + 1, stage: stages[0].id, done: {}, ticks: 0 } };
  }
  return { ...task, rounds, cursor: null, status: "completed", finishedAt: now };
}

/** 模拟推进一个节拍：参与方步骤每拍完成一部分题目，服务端步骤每步占 SERVER_TICKS 拍。 */
export function tick(task: Task, now: string): Task {
  const cursor = task.cursor;
  if (task.status !== "running" || !cursor) return task;
  if (stageOf(algorithmOf(task.config.algorithm), cursor.stage).side === "participant") {
    let finished = true;
    const done: Record<string, number> = {};
    task.members.forEach((member, index) => {
      const step = Math.max(1, Math.ceil(member.problems / (3 + (index % 3))));
      const value = Math.min(member.problems, (cursor.done[member.datasetId] ?? 0) + step);
      done[member.datasetId] = value;
      if (value < member.problems) finished = false;
    });
    const moved = { ...task, cursor: { ...cursor, done } };
    return finished ? completeStage(moved, now) : moved;
  }
  if (cursor.ticks + 1 < SERVER_TICKS) return { ...task, cursor: { ...cursor, ticks: cursor.ticks + 1 } };
  return completeStage(task, now);
}

export function pause(task: Task): Task {
  return task.status === "running" ? { ...task, status: "paused" } : task;
}

export function resume(task: Task): Task {
  return task.status === "paused" ? { ...task, status: "running" } : task;
}

export function cancel(task: Task, now: string): Task {
  return task.status === "running" || task.status === "paused" ? { ...task, status: "canceled", finishedAt: now } : task;
}

// ——— 指标 ———

export function roundOf(task: Task, round: number): RoundRecord | undefined {
  return task.rounds.find((record) => record.round === round);
}

/** 已有准确率的轮次（解题步骤已完成）。 */
export function scoredRounds(task: Task): number[] {
  return task.rounds.filter((record) => record.correct).map((record) => record.round);
}

export function accuracy(task: Task, member: Member, round: number): number | null {
  const correct = roundOf(task, round)?.correct?.[member.datasetId];
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

export function libraries(task: Task): LibraryVersion[] {
  return task.rounds.flatMap((record) => (record.library ? [record.library] : []));
}

export function totalTokens(task: Task): number {
  return task.rounds.reduce((sum, record) => sum + (record.tokens ?? 0), 0);
}

export function totalProblems(task: Pick<Task, "members">): number {
  return task.members.reduce((sum, member) => sum + member.problems, 0);
}

/** 整个任务的完成比例（0–1），用于进度条。 */
export function progressOf(task: Task): number {
  const cursor = task.cursor;
  if (!cursor) return task.status === "completed" ? 1 : 0;
  const stages = stagesOf(task);
  const perRound = stages.length;
  const index = stages.findIndex((stage) => stage.id === cursor.stage);
  let within = 0;
  if (stages[index]?.side === "participant") {
    const total = totalProblems(task);
    const done = task.members.reduce((sum, member) => sum + (cursor.done[member.datasetId] ?? 0), 0);
    within = total ? done / total : 0;
  } else {
    within = cursor.ticks / SERVER_TICKS;
  }
  return ((cursor.round - 1) * perRound + index + within) / (task.config.rounds * perRound);
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

/** 每一步的预估耗时（秒）：按算法给出的每步耗时计算，所有参与方的样本共用同一组并发，与 estimate 口径一致。 */
export function stageSeconds(task: Task, stage: StageId): number {
  const definition = stageOf(algorithmOf(task.config.algorithm), stage);
  if (definition.side === "server") return definition.seconds;
  return Math.ceil(totalProblems(task) / Math.max(1, task.config.workers)) * definition.seconds;
}
