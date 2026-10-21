import {
  algorithmOf,
  defaultParams,
  type AlgorithmId,
  type ScenarioId,
  type TaskType,
} from "../catalog";
import {
  fits,
  inResourceScope,
  usable,
  type Dataset,
  type Participant,
  type ResourceSpace,
} from "../resources";
import type { Draft, TaskParticipant } from "./types";

/** 草稿里真正能参加的参与方：数据集还在、属于这个参与方、场景和任务类型一致、持有方在线。 */
export function joinable(
  draft: Draft,
  datasets: readonly Dataset[],
  participants: readonly Participant[],
): TaskParticipant[] {
  const { scenario, taskType } = draft;
  if (!scenario || !taskType) return [];
  return (
    draft.execution === "agent" ? draft.agentGroups : draft.participants
  ).filter(({ participantId, datasetId }) => {
    const dataset = datasets.find(
      (item) => item.id === datasetId && item.participantId === participantId,
    );
    const owner = participants.find((item) => item.id === participantId);
    if (owner?.hosting === "local" && draft.algorithm) {
      const algorithm = algorithmOf(draft.algorithm);
      if (owner.clientPlugins?.[algorithm.id] !== algorithm.version)
        return false;
    }
    return Boolean(
      dataset &&
        fits(dataset, scenario, taskType) &&
        usable(dataset, participants),
    );
  });
}

export type DataSourceChoice = {
  participant: Participant;
  datasets: Dataset[];
};

/** 配置候选与已选校验都依赖真实就绪状态和安装版本；一次按来源分组。 */
export function availableDataSources(
  draft: Draft,
  datasets: readonly Dataset[],
  participants: readonly Participant[],
  space: ResourceSpace,
): DataSourceChoice[] {
  if (!draft.scenario || !draft.taskType || !draft.algorithm) return [];
  const algorithm = algorithmOf(draft.algorithm);
  const grouped = new Map<string, Dataset[]>();
  for (const dataset of datasets) {
    if (
      !dataset.ready ||
      !inResourceScope(dataset, space) ||
      !fits(dataset, draft.scenario, draft.taskType)
    )
      continue;
    const group = grouped.get(dataset.participantId) ?? [];
    group.push(dataset);
    grouped.set(dataset.participantId, group);
  }
  return participants.flatMap((participant) => {
    if (
      participant.status !== "online" ||
      (participant.hosting === "local" &&
        participant.clientPlugins?.[algorithm.id] !== algorithm.version)
    )
      return [];
    const choices = grouped.get(participant.id);
    return choices?.length ? [{ participant, datasets: choices }] : [];
  });
}

/** 能用于某个场景、某种任务类型的数据集。 */
export function compatibleDatasets(
  scenario: ScenarioId,
  taskType: TaskType,
  datasets: readonly Dataset[],
): Dataset[] {
  return datasets.filter((dataset) => fits(dataset, scenario, taskType));
}

/** 选场景：换场景时清空后面的选择，任务类型、算法和参与方都要用户再选。 */
export function chooseScenario(draft: Draft, scenario: ScenarioId): Draft {
  if (draft.scenario === scenario) return draft;
  return {
    ...draft,
    scenario,
    taskType: null,
    algorithm: null,
    participants: [],
    agentGroups: [],
    clientOverrides: {},
    agentId: null,
    agentOverrides: {},
    execution: "builtin",
    params: {},
  };
}

/** 任务类型只改变数据和评分，不重置已经选好的算法与算法参数。 */
export function chooseTaskType(draft: Draft, taskType: TaskType): Draft {
  if (
    !draft.algorithm ||
    !algorithmOf(draft.algorithm).accepts.includes(taskType) ||
    draft.taskType === taskType
  )
    return draft;
  return {
    ...draft,
    taskType,
    participants: [],
    agentGroups: algorithmOf(draft.algorithm).requirements.agentRequired
      ? [
          {
            key: "mine",
            agentId: "",
            datasetId: "",
            participantId: "",
            space: "workspace",
          },
        ]
      : [],
    clientOverrides: {},
    agentOverrides: {},
  };
}

/** 选算法后明确选择支持的任务；不同算法的资源、执行方式和参数不互相沿用。 */
export function chooseAlgorithm(draft: Draft, algorithm: AlgorithmId): Draft {
  const definition = algorithmOf(algorithm);
  if (draft.algorithm === algorithm || definition.scenario !== draft.scenario)
    return draft;
  return {
    ...draft,
    algorithm,
    taskType: null,
    participants: [],
    agentGroups: definition.requirements.agentRequired
      ? [
          {
            key: "mine",
            agentId: "",
            datasetId: "",
            participantId: "",
            space: "workspace",
          },
        ]
      : [],
    clientOverrides: {},
    execution: definition.requirements.agentRequired ? "agent" : "builtin",
    agentId: null,
    agentOverrides: {},
    rounds: definition.defaultRounds,
    trialCap: Math.max(draft.trialCap, definition.minSamples ?? 1),
    params: defaultParams(definition),
  };
}

/** 选入、换掉或取消某个参与方出的数据集：每个参与方最多一份，换数据集时保留它原来的位置。 */
export function pickDataset(
  draft: Draft,
  participantId: string,
  datasetId: string | null,
): Draft {
  if (!datasetId)
    return {
      ...draft,
      participants: draft.participants.filter(
        (item) => item.participantId !== participantId,
      ),
    };
  const next = { participantId, datasetId };
  const exists = draft.participants.some(
    (item) => item.participantId === participantId,
  );
  return {
    ...draft,
    participants: exists
      ? draft.participants.map((item) =>
          item.participantId === participantId ? next : item,
        )
      : [...draft.participants, next],
  };
}

/**
 * 从新建任务出发新登记的数据集，能不能直接选入任务：任务已经选好算法，数据集的场景和任务类型一致，
 * 持有方在线、样本已就绪，而且这个参与方在任务里还没有选数据集（已经选了的不替用户换掉）。
 */
export function canPickInto(
  draft: Draft,
  owner: Participant,
  dataset: Dataset,
): boolean {
  if (!draft.algorithm || !draft.scenario || !draft.taskType) return false;
  if (
    !usable(dataset, [owner]) ||
    !fits(dataset, draft.scenario, draft.taskType)
  )
    return false;
  return !draft.participants.some((item) => item.participantId === owner.id);
}

/** 一次设好全部参与方（表头的全选）；同一个参与方只保留第一份。 */
export function setParticipants(
  draft: Draft,
  participants: readonly TaskParticipant[],
): Draft {
  const unique: TaskParticipant[] = [];
  for (const item of participants) {
    if (!unique.some((entry) => entry.participantId === item.participantId))
      unique.push({ ...item });
  }
  return { ...draft, participants: unique };
}
