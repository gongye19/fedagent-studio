/**
 * 联邦任务：创建时冻结配置和参与方，之后按所选算法在注册表里定义的步骤逐轮推进。
 *
 * 每一步完成后记下什么，只看这一步声明的结果类型（stage.result），不认具体的算法：
 * metric = 各方本轮答对多少，uploads = 各方上传多少条，groups = 服务端归成几类，output = 这一轮的产出。
 * 前端原型用节拍模拟推进（tick），结果来自 sample.ts 里各算法登记的示例运行；
 * 接入后端后，进度和结果改为读取运行目录里的检查点，状态机本身不变。
 */
import { algorithmOf, paramsOf, stageOf, type Stage, type StageId } from "./catalog";
import { clientModelOf, problemsOf, type TaskConfig } from "./config";
import type { Dataset, Participant } from "./resources";
import { DEMO_RUNS, rankedPool, sampleCorrect, sampleGroups, sampleTokens, sampleUploadCount, type PoolEntry, type SampleGroup } from "./sample";

export type TaskStatus = "running" | "paused" | "completed" | "canceled";

export const TASK_STATUS: Record<TaskStatus, string> = {
  running: "运行中",
  paused: "已暂停",
  completed: "已完成",
  canceled: "已取消",
};

/** 创建任务时冻结的参与方快照：之后改名或删除参与方、数据集不影响已有任务。 */
export type Member = {
  participantId: string;
  participant: string;
  datasetId: string;
  dataset: string;
  hosting: Participant["hosting"];
  problems: number;
  /** 本次使用的样本中带标注的条数；为 0 时这一方不计指标。 */
  answered: number;
  model: string;
};

export type Cursor = {
  round: number;
  stage: StageId;
  /** 参与方步骤：每个参与方已完成的样本数。 */
  done: Record<string, number>;
  /** 服务端步骤已走过的模拟节拍。 */
  ticks: number;
};

/** 产出里的一条（FoT 是经验库里的一条经验）。 */
export type OutputItem = { key: string; text: string; category: string };

/** 某一轮结束时的产出，供下一轮使用；任意一版都可以发布为应用。 */
export type OutputVersion = {
  builtAfterRound: number;
  items: OutputItem[];
  /** 这一版汇总了多少条上传。 */
  uploadCount: number;
};

/** 一轮的结果，键都是参与方 id。 */
export type RoundRecord = {
  round: number;
  /** 各方答对的样本数（metric 步骤完成后）。 */
  correct?: Record<string, number>;
  /** 各方上传的条数（uploads 步骤完成后）。 */
  uploads?: Record<string, number>;
  /** 服务端把上传归成的类别（groups 步骤完成后）。 */
  groups?: SampleGroup[];
  tokens?: number;
  output?: OutputVersion;
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
  const members = input.config.participants.flatMap(({ participantId, datasetId }): Member[] => {
    const owner = input.participants.find((participant) => participant.id === participantId);
    const dataset = input.datasets.find((item) => item.id === datasetId && item.participantId === participantId);
    if (!owner || !dataset) return [];
    const problems = problemsOf(input.config, dataset);
    const answered = dataset.answered >= dataset.count ? problems : Math.round((problems * dataset.answered) / Math.max(dataset.count, 1));
    return [{
      participantId,
      participant: owner.name,
      datasetId,
      dataset: dataset.name,
      hosting: owner.hosting,
      problems,
      answered,
      model: clientModelOf(input.config, participantId),
    }];
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

function uploadTotal(record: RoundRecord): number {
  return Object.values(record.uploads ?? {}).reduce((sum, value) => sum + value, 0);
}

/** 这一轮产出的条目：按和各方数据集的相关程度从示例池里取，条数由算法的示例运行决定。 */
function outputEntries(task: Task, record: RoundRecord): PoolEntry[] {
  const demo = DEMO_RUNS[task.config.algorithm];
  const params = paramsOf(algorithmOf(task.config.algorithm), task.config.params);
  return rankedPool(task.id, demo.pool, task.members.map((member) => member.datasetId))
    .slice(0, demo.outputSize(params, record.round, uploadTotal(record)));
}

function recordStage(task: Task, record: RoundRecord, stage: Stage): RoundRecord {
  const round = record.round;
  const algorithm = algorithmOf(task.config.algorithm);
  const stages = algorithm.stages;
  let next = record;
  switch (stage.result) {
    case "metric": {
      const previous = task.rounds.find((item) => item.round === round - 1)?.correct;
      const correct: Record<string, number> = {};
      for (const member of task.members) {
        if (member.answered > 0) {
          correct[member.participantId] = sampleCorrect(task.id, member.datasetId, member.answered, round, previous?.[member.participantId]);
        }
      }
      next = { ...record, correct };
      break;
    }
    case "uploads": {
      const params = paramsOf(algorithm, task.config.params);
      const perSample = algorithm.exchangeVolume.perSample(params);
      const cap = algorithm.exchangeVolume.maxPerSample?.(params) ?? null;
      const uploads = Object.fromEntries(task.members.map((member) => [
        member.participantId,
        sampleUploadCount(task.id, member.datasetId, member.problems, round, perSample, cap),
      ]));
      next = { ...record, uploads };
      break;
    }
    case "groups": {
      const uploads = task.members.map((member) => ({ key: member.participantId, datasetId: member.datasetId, count: record.uploads?.[member.participantId] ?? 0 }));
      next = { ...record, groups: sampleGroups(outputEntries(task, record), uploads) };
      break;
    }
    case "output": {
      const items = outputEntries(task, record).map((entry) => ({ key: entry.key, text: entry.text, category: entry.category }));
      next = { ...record, output: { builtAfterRound: round, items, uploadCount: uploadTotal(record) } };
      break;
    }
    default:
      break;
  }
  // 一轮的最后一步完成时记下这一轮的 token 用量。
  if (stage.id === stages[stages.length - 1].id) {
    next = { ...next, tokens: sampleTokens(task.id, round, totalProblems(task), uploadTotal(next)) };
  }
  return next;
}

/** 完成当前步骤：记下这一步的结果，进入下一步、下一轮，或结束任务。 */
export function completeStage(task: Task, now: string): Task {
  const cursor = task.cursor;
  if (!cursor) return task;
  const stages = stagesOf(task);
  const index = stages.findIndex((stage) => stage.id === cursor.stage);
  const rounds = withRound(task.rounds, cursor.round, (record) => recordStage(task, record, stages[index]));
  const next = stages[index + 1];
  if (next) return { ...task, rounds, cursor: { round: cursor.round, stage: next.id, done: {}, ticks: 0 } };
  if (cursor.round < task.config.rounds) {
    return { ...task, rounds, cursor: { round: cursor.round + 1, stage: stages[0].id, done: {}, ticks: 0 } };
  }
  return { ...task, rounds, cursor: null, status: "completed", finishedAt: now };
}

/** 模拟推进一个节拍：参与方步骤每拍完成一部分样本，服务端步骤每步占 SERVER_TICKS 拍。 */
export function tick(task: Task, now: string): Task {
  const cursor = task.cursor;
  if (task.status !== "running" || !cursor) return task;
  if (stageOf(algorithmOf(task.config.algorithm), cursor.stage).side === "participant") {
    let finished = true;
    const done: Record<string, number> = {};
    task.members.forEach((member, index) => {
      const step = Math.max(1, Math.ceil(member.problems / (3 + (index % 3))));
      const value = Math.min(member.problems, (cursor.done[member.participantId] ?? 0) + step);
      done[member.participantId] = value;
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
    const done = task.members.reduce((sum, member) => sum + (cursor.done[member.participantId] ?? 0), 0);
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
