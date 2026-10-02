// 页面状态：参与方、数据集、模型接口、联邦任务、已发布的应用（都来自后端），以及新建任务的草稿（只在浏览器里）。
// 规则都在 domain/，这里只负责组合和查找；改动后端数据的操作在 actions.ts。

import type { components } from "../api/schema";
import {
  chooseAlgorithm,
  chooseScenario,
  chooseTaskType,
  pickDataset,
  setParticipants,
  withDefaults,
  type Draft,
  type TaskParticipant,
} from "../domain/config";
import type { AlgorithmId, ScenarioId, TaskType } from "../domain/catalog";
import type { Dataset, Endpoint, Participant } from "../domain/resources";
import type { Task } from "../domain/task";

/**
 * 发布的应用。发布时记下来源任务的场景、任务类型和算法，并复制一份产出内容：
 * 应用列表按它们分类，来源任务以后被删掉，应用也还知道自己属于哪一类、还能用。
 */
export type Published = components["schemas"]["AppOut"];

export type State = {
  participants: Participant[];
  datasets: Dataset[];
  endpoints: Endpoint[];
  tasks: Task[];
  published: Published[];
  /** 新建任务页的草稿；"复制为新任务"会预先填好。 */
  draft: Draft;
};

/** 草稿的改动（改动后端数据的操作见 actions.ts）。 */
export type Action =
  /** auto：从首页的场景入口带进来的场景，不算用户动过草稿。 */
  | { type: "chooseScenario"; scenario: ScenarioId; auto?: boolean }
  | { type: "chooseTaskType"; taskType: TaskType }
  | { type: "chooseAlgorithm"; algorithm: AlgorithmId }
  /** 选入、换掉（datasetId 换成另一份）或取消（null）某个参与方。 */
  | { type: "pickDataset"; participantId: string; datasetId: string | null }
  | { type: "setParticipants"; participants: TaskParticipant[] }
  | { type: "updateDraft"; patch: Partial<Draft> }
  | { type: "resetDraft"; draft?: Partial<Draft> };

export function taskOf(state: State, id: string): Task | undefined {
  return state.tasks.find((task) => task.id === id);
}

export function participantOf(state: State, id: string): Participant | undefined {
  return state.participants.find((participant) => participant.id === id);
}

export function datasetsOf(state: State, participantId: string): Dataset[] {
  return state.datasets.filter((dataset) => dataset.participantId === participantId);
}

export function datasetOf(state: State, id: string): Dataset | undefined {
  return state.datasets.find((dataset) => dataset.id === id);
}

export function publishedOf(state: State, taskId: string, builtAfterRound: number): Published | undefined {
  return state.published.find((item) => item.taskId === taskId && item.builtAfterRound === builtAfterRound);
}

/** 草稿里去掉已经不存在的数据集（连同单独指定的模型）。 */
export function withoutMissing(draft: Draft, datasets: readonly Dataset[]): Draft {
  const participants = draft.participants.filter((item) => datasets.some((dataset) => dataset.id === item.datasetId && dataset.participantId === item.participantId));
  if (participants.length === draft.participants.length) return draft;
  const kept = new Set(participants.map((item) => item.participantId));
  return {
    ...draft,
    participants,
    clientOverrides: Object.fromEntries(Object.entries(draft.clientOverrides).filter(([id]) => kept.has(id))),
  };
}

export function reducer(draft: Draft, action: Action, datasets: readonly Dataset[]): Draft {
  switch (action.type) {
    case "chooseScenario": {
      const next = chooseScenario(draft, action.scenario);
      return next === draft ? draft : action.auto ? next : { ...next, touched: true };
    }
    case "chooseTaskType":
      return { ...chooseTaskType(draft, action.taskType), touched: true };
    case "chooseAlgorithm":
      return { ...chooseAlgorithm(draft, action.algorithm), touched: true };
    case "pickDataset": {
      const dataset = action.datasetId ? datasets.find((item) => item.id === action.datasetId) : null;
      // 只能选这个参与方自己的数据集。
      if (dataset && dataset.participantId !== action.participantId) return draft;
      return { ...pickDataset(draft, action.participantId, action.datasetId), touched: true };
    }
    case "setParticipants":
      return { ...setParticipants(draft, action.participants), touched: true };
    case "updateDraft":
      return { ...draft, ...action.patch, touched: true };
    case "resetDraft":
      return withDefaults(action.draft ?? {});
    default:
      return draft;
  }
}
