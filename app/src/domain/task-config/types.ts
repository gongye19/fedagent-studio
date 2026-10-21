import type { components } from "../../api/schema";
import type { AlgorithmId, Params, ScenarioId, TaskType } from "../catalog";

export type RunMode = "trial" | "full";

/** 参加任务的一方和它出的数据集。 */
export type TaskParticipant = { participantId: string; datasetId: string };

/** 本次任务的一套参与系统；不写入任何资源。空字段用于保留未填完的表单。 */
export type AgentGroup = TaskParticipant & {
  key: string;
  agentId: string;
};

export type TaskConfig = {
  scenario: ScenarioId;
  /** 任务类型：决定数据格式、评估指标及可用数据。 */
  taskType: TaskType;
  algorithm: AlgorithmId;
  /** 参加的参与方，每方一份数据集，按选择的先后排列。 */
  participants: TaskParticipant[];
  clientModel: string;
  /** 参与方 id → 模型引用；没有单独指定的参与方用 clientModel。 */
  clientOverrides: Record<string, string>;
  serverModel: string;
  execution?: "builtin" | "agent";
  agentId?: string | null;
  agentOverrides?: Record<string, string>;
  rounds: number;
  mode: RunMode;
  /** 试跑时每份数据集只取前几条样本。 */
  trialCap: number;
  /** 算法参数：键由算法在注册表里声明，没有设置的按默认值。 */
  params: Params;
  seed: number;
  workers: number;
};

/** 新建任务页的草稿：场景、任务类型和算法可以还没选。 */
export type Draft = Omit<TaskConfig, "scenario" | "taskType" | "algorithm"> & {
  /** null：还没改过名称，页面显示按打开时间生成的默认名称；空字符串：用户清空了，创建时仍用默认名称。 */
  name: string | null;
  agentGroups: AgentGroup[];
  scenario: ScenarioId | null;
  taskType: TaskType | null;
  algorithm: AlgorithmId | null;
  /** 用户动过这份草稿（从场景入口带进来的场景不算）。只有动过的草稿，再打开时才保留配置；静默恢复。 */
  touched: boolean;
};

export const DEFAULT_DRAFT: Draft = {
  name: null,
  agentGroups: [],
  touched: false,
  scenario: null,
  taskType: null,
  algorithm: null,
  participants: [],
  clientModel: "",
  clientOverrides: {},
  serverModel: "",
  execution: "builtin",
  agentId: null,
  agentOverrides: {},
  rounds: 3,
  mode: "trial",
  trialCap: 5,
  params: {},
  seed: 0,
  workers: 8,
};

export function withDefaults(draft: Partial<Draft>): Draft {
  return {
    ...DEFAULT_DRAFT,
    ...draft,
    participants: [...(draft.participants ?? [])],
    agentGroups:
      draft.agentGroups?.map(({ key, agentId, datasetId, participantId }) => ({
        key,
        agentId,
        datasetId,
        participantId,
      })) ??
      (draft.execution === "agent"
        ? (draft.participants ?? []).map((p) => ({
            ...p,
            key: p.participantId,
            agentId:
              draft.agentOverrides?.[p.participantId] || draft.agentId || "",
          }))
        : []),
    clientOverrides: { ...(draft.clientOverrides ?? {}) },
    agentOverrides: { ...(draft.agentOverrides ?? {}) },
    params: { ...(draft.params ?? {}) },
  };
}

/** 初始行只展示所需字段，不替用户选择资源。 */
export function emptyAgentGroups(count: number): AgentGroup[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `resource-${index + 1}`,
    agentId: "",
    datasetId: "",
    participantId: "",
  }));
}

/** 后端的调用量预估：服务端调用模型的步骤每轮各一次（结果不合法时会重试，所以是下限）；用到的接口都设置了单价才估算费用，单位：元。 */
export type Estimate = components["schemas"]["EstimateOut"];

export type Issue = {
  field:
    | "scenario"
    | "taskType"
    | "algorithm"
    | "participants"
    | "models"
    | "rounds"
    | "params"
    | "check";
  message: string;
};
