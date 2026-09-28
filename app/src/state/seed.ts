/**
 * 演示环境的初始数据：8 个内置示例参与方（各持一份数学题库）、一个等待连接的本地参与方示例、
 * 预留的默认 LLM 接口（待配置）、一个已完成的示例任务（其最终洞见库已发布）和一个正在试跑的任务。
 *
 * 任务都通过领域函数推进生成，与用户新建的任务走同一套规则。结果都是示例数据。
 */
import { DEFAULT_DRAFT, toConfig, withDefaults, type Draft, type TaskConfig } from "../domain/config";
import { BUILTIN_DATASETS, BUILTIN_PARTICIPANTS, DEFAULT_ENDPOINTS, type Participant } from "../domain/resources";
import { completeStage, createTask, tick, type Task } from "../domain/task";
import type { State } from "./store";

const LOCAL_EXAMPLE: Participant = {
  id: "p-local-example",
  name: "示例合作方",
  org: "示例机构",
  intro: "演示用的本地参与方，还没有连上客户端。",
  hosting: "local",
  status: "waiting",
};

/** 已完成示例任务每份数据第 1–3 轮的答对题数。 */
const PAPER_CORRECT: Record<string, readonly [number, number, number]> = {
  "ds-aime24": [9, 11, 12],
  "ds-aime25": [8, 9, 11],
  "ds-amc": [26, 29, 30],
  "ds-ccee": [28, 27, 28],
  "ds-cnmo": [7, 8, 8],
  "ds-wlpmc": [5, 5, 4],
  "ds-v202412hard": [7, 8, 10],
  "ds-v202505hard": [31, 35, 38],
};

function seedConfig(patch: Partial<Draft>): TaskConfig {
  const config = toConfig(withDefaults({ scenario: "horizontal", algorithm: "fot", ...patch }));
  if (!config) throw new Error("seed config expected");
  return config;
}

function runUntil(task: Task, stop: (task: Task) => boolean, now: string): Task {
  let current = task;
  for (let guard = 0; guard < 5000 && !stop(current); guard += 1) current = tick(current, now);
  return current;
}

function completedPaperTask(): Task {
  const task = createTask({
    id: "task-paper-math8",
    name: "论文复现：数学 8 方",
    createdAt: "2026-09-26T10:02:00+08:00",
    config: seedConfig({ mode: "full", rounds: 3, datasetIds: BUILTIN_DATASETS.map((dataset) => dataset.id) }),
    datasets: BUILTIN_DATASETS,
    participants: BUILTIN_PARTICIPANTS,
  });
  const finished = runUntil(task, (item) => item.status === "completed", "2026-09-26T13:26:00+08:00");
  return {
    ...finished,
    rounds: finished.rounds.map((record) => ({
      ...record,
      correct: Object.fromEntries(Object.entries(PAPER_CORRECT).map(([id, values]) => [id, values[record.round - 1]])),
    })),
  };
}

function runningTrialTask(): Task {
  const task = createTask({
    id: "task-trial-4",
    name: "快速试跑：4 个题库",
    createdAt: "2026-09-28T15:30:00+08:00",
    config: seedConfig({ mode: "trial", trialCap: 5, rounds: 2, datasetIds: ["ds-aime24", "ds-amc", "ds-ccee", "ds-cnmo"] }),
    datasets: BUILTIN_DATASETS,
    participants: BUILTIN_PARTICIPANTS,
  });
  // 停在第 1 轮"反思"进行到一半，打开页面后会继续推进。
  const solved = completeStage(task, "2026-09-28T15:31:00+08:00");
  return tick(solved, "2026-09-28T15:31:30+08:00");
}

export function seedState(): State {
  return {
    version: 4,
    participants: [...BUILTIN_PARTICIPANTS.map((item) => ({ ...item })), { ...LOCAL_EXAMPLE }],
    datasets: BUILTIN_DATASETS.map((item) => ({ ...item })),
    endpoints: DEFAULT_ENDPOINTS.map((item) => ({ ...item, models: [...item.models] })),
    tasks: [runningTrialTask(), completedPaperTask()],
    published: [
      {
        id: "lib-paper-math8",
        taskId: "task-paper-math8",
        builtAfterRound: 3,
        name: "数学推理洞见库（8 方）",
        publishedAt: "2026-09-26T14:05:00+08:00",
      },
    ],
    draft: { ...DEFAULT_DRAFT },
  };
}
