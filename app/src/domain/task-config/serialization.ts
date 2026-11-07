import { algorithmOf, paramsOf, TASK_TYPES } from "../catalog";
import type { Draft, TaskConfig } from "./types";

export function toConfig(draft: Draft): TaskConfig | null {
  if (!draft.scenario || !draft.taskType || !draft.algorithm) return null;
  if (draft.mode === "trial" && (draft.trialCap === "" || !Number.isSafeInteger(draft.trialCap) || draft.trialCap < 1)) return null;
  const agentRequired = algorithmOf(draft.algorithm).requirements.agentRequired;
  return {
    scenario: draft.scenario,
    taskType: draft.taskType,
    algorithm: draft.algorithm,
    participants: (agentRequired ? draft.agentGroups : draft.participants)
      .filter((p) => p.datasetId)
      .map(({ participantId, datasetId }) => ({ participantId, datasetId })),
    clientModel: draft.clientModel,
    clientOverrides: activeOverrides(draft),
    serverModel: draft.serverModel,
    execution: draft.execution ?? "builtin",
    agentId:
      draft.execution === "agent" && !agentRequired
        ? (draft.agentId ?? null)
        : null,
    agentOverrides: agentRequired
      ? Object.fromEntries(
          draft.agentGroups
            .filter((g) => g.agentId && g.participantId && g.datasetId)
            .map((g) => [g.participantId, g.agentId]),
        )
      : Object.fromEntries(
          Object.entries(
            draft.execution === "agent" ? (draft.agentOverrides ?? {}) : {},
          ).filter(([id]) =>
            draft.participants.some((p) => p.participantId === id),
          ),
        ),
    rounds: algorithmOf(draft.algorithm).minRounds === algorithmOf(draft.algorithm).maxRounds
      ? algorithmOf(draft.algorithm).defaultRounds : draft.rounds,
    mode: draft.mode,
    trialCap: draft.trialCap || 1,
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
    agentGroups:
      config.execution === "agent"
        ? config.participants.map((p) => ({
            ...p,
            key: p.participantId,
            agentId:
              config.agentOverrides?.[p.participantId] || config.agentId || "",
          }))
        : [],
    touched: true,
    participants: config.participants.map((item) => ({ ...item })),
    clientOverrides: { ...config.clientOverrides },
    params: { ...config.params },
  };
}

/** 默认名只说明任务用途；实际开始时间由独立字段展示。 */
export function defaultTaskName(draft: Pick<Draft, "taskType">): string {
  return draft.taskType ? `${TASK_TYPES[draft.taskType].label}${TASK_TYPES[draft.taskType].recordBased ? "经验生成" : "任务"}` : "联邦任务";
}
