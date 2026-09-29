// 页面状态：参与方、数据集、模型接口、联邦任务、已发布的应用，以及新建任务的草稿。
// 规则都在 domain/，这里只负责组合和查找。

import {
  chooseAlgorithm,
  chooseScenario,
  chooseTaskType,
  DEFAULT_DRAFT,
  defaultTaskName,
  draftIssues,
  joinable,
  pickDataset,
  setParticipants,
  toConfig,
  withDefaults,
  type Draft,
  type TaskParticipant,
} from "../domain/config";
import type { AlgorithmId, ScenarioId, TaskType } from "../domain/catalog";
import { DEFAULT_ENDPOINT_ID, type Dataset, type Endpoint, type Participant } from "../domain/resources";
import { cancel, createTask, pause, resume, tick, type Task } from "../domain/task";
import { seedState } from "./seed";

export const STATE_VERSION = 7;

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
  /** auto：从首页的场景入口带进来的场景，不算用户动过草稿。 */
  | { type: "chooseScenario"; scenario: ScenarioId; auto?: boolean }
  | { type: "chooseTaskType"; taskType: TaskType }
  | { type: "chooseAlgorithm"; algorithm: AlgorithmId }
  /** 选入、换掉（datasetId 换成另一份）或取消（null）某个参与方。 */
  | { type: "pickDataset"; participantId: string; datasetId: string | null }
  | { type: "setParticipants"; participants: TaskParticipant[] }
  | { type: "updateDraft"; patch: Partial<Draft> }
  | { type: "resetDraft"; draft?: Partial<Draft> }
  /** name：页面上显示的默认名称；草稿里没有填名称时用它。 */
  | { type: "createTask"; id: string; createdAt: string; name?: string }
  | { type: "tick"; now: string }
  | { type: "pauseTask"; id: string }
  | { type: "resumeTask"; id: string }
  | { type: "cancelTask"; id: string; now: string }
  | { type: "publish"; id: string; taskId: string; builtAfterRound: number; name: string; publishedAt: string }
  | { type: "renamePublished"; id: string; name: string }
  | { type: "unpublish"; id: string }
  | { type: "addParticipant"; participant: Participant; dataset?: Dataset }
  | { type: "addDataset"; dataset: Dataset }
  | { type: "removeDataset"; id: string }
  | { type: "removeParticipant"; id: string }
  | { type: "addEndpoint"; endpoint: Endpoint }
  | { type: "updateEndpoint"; id: string; patch: Partial<Omit<Endpoint, "id">> }
  | { type: "removeEndpoint"; id: string }
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

export function datasetOf(state: State, id: string): Dataset | undefined {
  return state.datasets.find((dataset) => dataset.id === id);
}

export function publishedOf(state: State, taskId: string, builtAfterRound: number): Published | undefined {
  return state.published.find((item) => item.taskId === taskId && item.builtAfterRound === builtAfterRound);
}

/** 参加过的任务数（按任务快照里的参与方统计）。 */
export function taskCountOf(state: State, participantId: string): number {
  return state.tasks.filter((task) => task.members.some((member) => member.participantId === participantId)).length;
}

/** 删掉数据集后，草稿里用到它的参与方一起取消（连同单独指定的模型）。 */
function withoutDatasets(draft: Draft, removed: ReadonlySet<string>): Draft {
  const participants = draft.participants.filter((item) => !removed.has(item.datasetId));
  const kept = new Set(participants.map((item) => item.participantId));
  return {
    ...draft,
    participants,
    clientOverrides: Object.fromEntries(Object.entries(draft.clientOverrides).filter(([id]) => kept.has(id))),
  };
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
    case "chooseScenario": {
      const draft = chooseScenario(state.draft, action.scenario);
      return draft === state.draft ? state : { ...state, draft: action.auto ? draft : { ...draft, touched: true } };
    }

    case "chooseTaskType":
      return { ...state, draft: { ...chooseTaskType(state.draft, action.taskType), touched: true } };

    case "chooseAlgorithm":
      return { ...state, draft: { ...chooseAlgorithm(state.draft, action.algorithm), touched: true } };

    case "pickDataset": {
      const dataset = action.datasetId ? state.datasets.find((item) => item.id === action.datasetId) : null;
      // 只能选这个参与方自己的数据集。
      if (dataset && dataset.participantId !== action.participantId) return state;
      return { ...state, draft: { ...pickDataset(state.draft, action.participantId, action.datasetId), touched: true } };
    }

    case "setParticipants":
      return { ...state, draft: { ...setParticipants(state.draft, action.participants), touched: true } };

    case "updateDraft":
      return { ...state, draft: { ...state.draft, ...action.patch, touched: true } };

    case "resetDraft":
      return { ...state, draft: withDefaults(action.draft ?? {}) };

    case "createTask": {
      if (draftIssues(state.draft, state.datasets, state.participants, state.endpoints).length) return state;
      // 只带上真正能参加的参与方（数据集还在、场景和任务类型一致、持有方在线）。
      const config = toConfig({ ...state.draft, participants: joinable(state.draft, state.datasets, state.participants) });
      if (!config) return state;
      const task = createTask({
        id: action.id,
        name: state.draft.name?.trim() || action.name || defaultTaskName(state.draft, new Date(action.createdAt)),
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
      const hasOutput = task?.rounds.some((record) => record.round === action.builtAfterRound && record.output);
      if (!task || exists || !hasOutput) return state;
      const item: Published = {
        id: action.id,
        taskId: action.taskId,
        builtAfterRound: action.builtAfterRound,
        name: action.name.trim() || task.name,
        publishedAt: action.publishedAt,
      };
      return { ...state, published: [item, ...state.published] };
    }

    case "renamePublished": {
      const name = action.name.trim();
      if (!name) return state;
      return { ...state, published: state.published.map((item) => (item.id === action.id ? { ...item, name } : item)) };
    }

    case "unpublish":
      return { ...state, published: state.published.filter((item) => item.id !== action.id) };

    case "addParticipant": {
      if (state.participants.some((participant) => participant.id === action.participant.id)) return state;
      // 新登记的排在最前面。
      return {
        ...state,
        participants: [action.participant, ...state.participants],
        datasets: action.dataset ? [action.dataset, ...state.datasets] : state.datasets,
      };
    }

    case "addDataset": {
      if (!participantOf(state, action.dataset.participantId) || datasetOf(state, action.dataset.id)) return state;
      // 新登记的排在最前面。
      return { ...state, datasets: [action.dataset, ...state.datasets] };
    }

    case "removeDataset": {
      const dataset = datasetOf(state, action.id);
      if (!dataset || dataset.source === "builtin") return state;
      return {
        ...state,
        datasets: state.datasets.filter((item) => item.id !== action.id),
        draft: withoutDatasets(state.draft, new Set([action.id])),
      };
    }

    case "removeParticipant": {
      const participant = participantOf(state, action.id);
      if (!participant || participant.builtin) return state;
      const removed = new Set(datasetsOf(state, action.id).map((dataset) => dataset.id));
      const draft = withoutDatasets(state.draft, removed);
      return {
        ...state,
        participants: state.participants.filter((item) => item.id !== action.id),
        datasets: state.datasets.filter((dataset) => !removed.has(dataset.id)),
        draft: { ...draft, participants: draft.participants.filter((item) => item.participantId !== action.id) },
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

    case "removeEndpoint":
      // 预留的默认接口不能删；已有任务只保存模型引用，不受影响。
      if (action.id === DEFAULT_ENDPOINT_ID) return state;
      return { ...state, endpoints: state.endpoints.filter((endpoint) => endpoint.id !== action.id) };

    case "resetDemo":
      return seedState();

    default:
      return state;
  }
}
