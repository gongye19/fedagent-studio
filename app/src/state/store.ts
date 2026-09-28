// 页面状态：参与方与数据、模型接口、联邦任务、已发布的洞见库，以及新建任务的草稿。
// 规则都在 domain/，这里只负责组合和查找。

import { chooseAlgorithm, chooseScenario, DEFAULT_DRAFT, defaultTaskName, draftIssues, toConfig, toggleDataset, withDefaults, type Draft } from "../domain/config";
import type { AlgorithmId, ScenarioId } from "../domain/catalog";
import type { Dataset, Endpoint, Participant } from "../domain/resources";
import { cancel, createTask, pause, resume, tick, type Task } from "../domain/task";
import { seedState } from "./seed";

export const STATE_VERSION = 2;

export type Published = {
  id: string;
  taskId: string;
  builtAfterRound: number;
  name: string;
  publishedAt: string;
};

export type State = {
  version: typeof STATE_VERSION;
  participants: Participant[];
  datasets: Dataset[];
  endpoints: Endpoint[];
  tasks: Task[];
  published: Published[];
  /** 新建任务页的草稿；"复制为新任务"会预先填好。 */
  draft: Draft;
};

export type Action =
  | { type: "chooseScenario"; scenario: ScenarioId }
  | { type: "chooseAlgorithm"; algorithm: AlgorithmId }
  | { type: "toggleDataset"; datasetId: string }
  | { type: "setDatasets"; datasetIds: string[] }
  | { type: "updateDraft"; patch: Partial<Draft> }
  | { type: "resetDraft"; draft?: Partial<Draft> }
  | { type: "createTask"; id: string; createdAt: string }
  | { type: "tick"; now: string }
  | { type: "pauseTask"; id: string }
  | { type: "resumeTask"; id: string }
  | { type: "cancelTask"; id: string; now: string }
  | { type: "publish"; id: string; taskId: string; builtAfterRound: number; name: string; publishedAt: string }
  | { type: "addParticipant"; participant: Participant; dataset?: Dataset }
  | { type: "addDataset"; dataset: Dataset }
  | { type: "removeParticipant"; id: string }
  | { type: "addEndpoint"; endpoint: Endpoint }
  | { type: "updateEndpoint"; id: string; patch: Partial<Pick<Endpoint, "concurrency" | "price">> }
  | { type: "resetDemo" };

export function taskOf(state: State, id: string): Task | undefined {
  return state.tasks.find((task) => task.id === id);
}

export function participantOf(state: State, id: string): Participant | undefined {
  return state.participants.find((participant) => participant.id === id);
}

export function datasetsOf(state: State, participantId: string): Dataset[] {
  return state.datasets.filter((dataset) => dataset.participantId === participantId);
}

export function publishedOf(state: State, taskId: string, builtAfterRound: number): Published | undefined {
  return state.published.find((item) => item.taskId === taskId && item.builtAfterRound === builtAfterRound);
}

/** 参加过的任务数（按任务快照里的参与方统计）。 */
export function taskCountOf(state: State, participantId: string): number {
  return state.tasks.filter((task) => task.members.some((member) => member.participantId === participantId)).length;
}

function updateTask(state: State, id: string, change: (task: Task) => Task): State {
  let changed = false;
  const tasks = state.tasks.map((task) => {
    if (task.id !== id) return task;
    const next = change(task);
    changed ||= next !== task;
    return next;
  });
  return changed ? { ...state, tasks } : state;
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "chooseScenario":
      return { ...state, draft: chooseScenario(state.draft, action.scenario, state.datasets, state.participants) };

    case "chooseAlgorithm":
      return { ...state, draft: chooseAlgorithm(state.draft, action.algorithm, state.datasets, state.participants) };

    case "toggleDataset":
      return { ...state, draft: toggleDataset(state.draft, action.datasetId) };

    case "setDatasets":
      return { ...state, draft: { ...state.draft, datasetIds: [...action.datasetIds] } };

    case "updateDraft":
      return { ...state, draft: { ...state.draft, ...action.patch } };

    case "resetDraft":
      return { ...state, draft: withDefaults(action.draft ?? {}) };

    case "createTask": {
      const config = toConfig(state.draft);
      if (!config || draftIssues(state.draft, state.datasets, state.participants, state.endpoints).length) return state;
      const task = createTask({
        id: action.id,
        name: state.draft.name.trim() || defaultTaskName(state.draft, new Date(action.createdAt)),
        createdAt: action.createdAt,
        config,
        datasets: state.datasets,
        participants: state.participants,
      });
      return { ...state, tasks: [task, ...state.tasks], draft: DEFAULT_DRAFT };
    }

    case "tick": {
      if (!state.tasks.some((task) => task.status === "running")) return state;
      return { ...state, tasks: state.tasks.map((task) => tick(task, action.now)) };
    }

    case "pauseTask":
      return updateTask(state, action.id, pause);

    case "resumeTask":
      return updateTask(state, action.id, resume);

    case "cancelTask":
      return updateTask(state, action.id, (task) => cancel(task, action.now));

    case "publish": {
      const task = taskOf(state, action.taskId);
      const exists = publishedOf(state, action.taskId, action.builtAfterRound);
      const hasLibrary = task?.rounds.some((record) => record.round === action.builtAfterRound && record.library);
      if (!task || exists || !hasLibrary) return state;
      const item: Published = {
        id: action.id,
        taskId: action.taskId,
        builtAfterRound: action.builtAfterRound,
        name: action.name.trim() || task.name,
        publishedAt: action.publishedAt,
      };
      return { ...state, published: [item, ...state.published] };
    }

    case "addParticipant": {
      if (state.participants.some((participant) => participant.id === action.participant.id)) return state;
      return {
        ...state,
        participants: [...state.participants, action.participant],
        datasets: action.dataset ? [...state.datasets, action.dataset] : state.datasets,
      };
    }

    case "addDataset": {
      if (!participantOf(state, action.dataset.participantId)) return state;
      return { ...state, datasets: [...state.datasets, action.dataset] };
    }

    case "removeParticipant": {
      const participant = participantOf(state, action.id);
      if (!participant || participant.builtin) return state;
      const removed = new Set(datasetsOf(state, action.id).map((dataset) => dataset.id));
      return {
        ...state,
        participants: state.participants.filter((item) => item.id !== action.id),
        datasets: state.datasets.filter((dataset) => !removed.has(dataset.id)),
        draft: { ...state.draft, datasetIds: state.draft.datasetIds.filter((id) => !removed.has(id)) },
      };
    }

    case "addEndpoint":
      if (state.endpoints.some((endpoint) => endpoint.id === action.endpoint.id)) return state;
      return { ...state, endpoints: [...state.endpoints, action.endpoint] };

    case "updateEndpoint":
      return {
        ...state,
        endpoints: state.endpoints.map((endpoint) => (endpoint.id === action.id ? { ...endpoint, ...action.patch } : endpoint)),
      };

    case "resetDemo":
      return seedState();

    default:
      return state;
  }
}
