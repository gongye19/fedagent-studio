import { algorithmOf, paramsOf, TASK_TYPES } from "../catalog";
import type { Draft, TaskConfig } from "./types";

export function toConfig(draft: Draft): TaskConfig | null {
  if (!draft.scenario || !draft.taskType || !draft.algorithm) return null;
  return {
    scenario: draft.scenario,
    taskType: draft.taskType,
    algorithm: draft.algorithm,
    participants: draft.participants.map((item) => ({ ...item })),
    clientModel: draft.clientModel,
    clientOverrides: activeOverrides(draft),
    serverModel: draft.serverModel,
    execution: draft.execution ?? "builtin",
    agentId: draft.execution === "agent" ? (draft.agentId ?? null) : null,
    agentOverrides: Object.fromEntries(
      Object.entries(
        draft.execution === "agent" ? (draft.agentOverrides ?? {}) : {},
      ).filter(([id]) =>
        draft.participants.some((p) => p.participantId === id),
      ),
    ),
    rounds: draft.rounds,
    mode: draft.mode,
    trialCap: draft.trialCap,
    params: paramsOf(algorithmOf(draft.algorithm), draft.params),
    seed: draft.seed,
    workers: draft.workers,
  };
}

/** 只保留已选参与方的单独模型设置（取消勾选后，之前的设置不再生效）。 */
export function activeOverrides(
  config: Pick<TaskConfig, "participants" | "clientOverrides">,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config.clientOverrides).filter(([id]) =>
      config.participants.some((item) => item.participantId === id),
    ),
  );
}

/** "复制为新任务"：带上原任务的配置，算作用户动过的草稿。 */
export function toDraft(config: TaskConfig, name: string | null = null): Draft {
  return {
    ...config,
    name,
    touched: true,
    participants: config.participants.map((item) => ({ ...item })),
    clientOverrides: { ...config.clientOverrides },
    params: { ...config.params },
  };
}

/**
 * 默认任务名：任务类型 + 创建时间，说的是这个任务做什么，而不是用了哪个算法。
 * 场景、算法、参与方数、运行方式都显示在任务摘要里，不再塞进名字。
 */
export function defaultTaskName(
  draft: Pick<Draft, "taskType">,
  now: Date = new Date(),
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  // 名称里不用"·"：页面上"·"是元信息的分隔符。
  return `${draft.taskType ? `${TASK_TYPES[draft.taskType].label}任务` : "联邦任务"} ${stamp}`;
}
