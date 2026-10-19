/**
 * 任务配置：默认值和页面上的即时检查。
 *
 * 新建任务依次选场景 → 算法 → 任务类型 → 数据，每一步都由用户选，页面不替用户默认。
 * 参与方只能用登记在同一场景、同一任务类型下的数据集，每方出一份。
 * 算法参数按注册表的定义保存（键和默认值由算法声明）。调用量预估和最终的校验由后端做（POST /v1/tasks/validate），
 * 预估按算法插件声明的步骤和交换量计算，费用按接口单价算。
 */
import {
  algorithmOf,
  defaultParams,
  paramsOf,
  scenarioOf,
  TASK_TYPES,
  type AlgorithmId,
  type Params,
  type ScenarioId,
  type TaskType,
} from "./catalog";
import type { components } from "../api/schema";
import type { Algorithm } from "./catalog";
import {
  DEFAULT_MODEL,
  endpointOf,
  fits,
  modelLabel,
  usable,
  type Dataset,
  type Endpoint,
  type Participant,
  type ResourceSpace,
} from "./resources";

export type RunMode = "trial" | "full";

/** 参加任务的一方和它出的数据集。 */
export type TaskParticipant = { participantId: string; datasetId: string };

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
  scenario: ScenarioId | null;
  taskType: TaskType | null;
  algorithm: AlgorithmId | null;
  /** 用户动过这份草稿（从场景入口带进来的场景不算）。只有动过的草稿，再打开时才保留配置；静默恢复。 */
  touched: boolean;
};

export const DEFAULT_DRAFT: Draft = {
  name: null,
  touched: false,
  scenario: null,
  taskType: null,
  algorithm: null,
  participants: [],
  clientModel: DEFAULT_MODEL,
  clientOverrides: {},
  serverModel: DEFAULT_MODEL,
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
    clientOverrides: { ...(draft.clientOverrides ?? {}) },
    agentOverrides: { ...(draft.agentOverrides ?? {}) },
    params: { ...(draft.params ?? {}) },
  };
}

/** 后端的调用量预估：服务端调用模型的步骤每轮各一次（结果不合法时会重试，所以是下限）；用到的接口都设置了单价才估算费用，单位：元。 */
export type Estimate = components["schemas"]["EstimateOut"];

export type Issue = {
  field: "scenario" | "taskType" | "algorithm" | "participants" | "models" | "rounds" | "params" | "check";
  message: string;
};

/** 未知插件字段也要显示错误，不能靠类型断言把问题静默丢掉。 */
export function configIssue(issue: { field: string; message: string }): Issue {
  switch (issue.field) {
    case "scenario":
    case "taskType":
    case "algorithm":
    case "participants":
    case "models":
    case "rounds":
    case "params":
    case "check":
      return { field: issue.field, message: issue.message };
    default:
      return { field: "params", message: issue.message };
  }
}

export function taskModelSummary(draft: Draft, endpoints: readonly Endpoint[], algorithm: Algorithm): string {
  const client = draft.execution === "agent" ? "自有 Agent" : modelLabel(draft.clientModel, endpoints);
  if (!algorithm.requirements.serverModel) return client;
  const server = modelLabel(draft.serverModel, endpoints);
  return client === server ? client : `参与方 ${client}；服务端 ${server}`;
}

/** 草稿能否创建任务；返回全部未满足的条件，按页面顺序排列。 */
export function draftIssues(
  draft: Draft,
  datasets: readonly Dataset[],
  participants: readonly Participant[],
  endpoints: readonly Endpoint[],
): Issue[] {
  const issues: Issue[] = [];
  if (!draft.scenario) {
    issues.push({ field: "scenario", message: "选择场景" });
    return issues;
  }
  if (scenarioOf(draft.scenario).status !== "available") {
    issues.push({ field: "scenario", message: "这个场景的算法还在规划中" });
    return issues;
  }
  if (!draft.algorithm) {
    issues.push({ field: "algorithm", message: "选择算法" });
    return issues;
  }
  if (!draft.taskType) {
    issues.push({ field: "taskType", message: "选择任务类型" });
    return issues;
  }
  const algorithm = algorithmOf(draft.algorithm);
  if (draft.execution === "agent" && !algorithm.requirements.executionModes.includes("agent")) {
    issues.push({ field: "models", message: "该算法使用数据与 LLM，由平台执行流程，无需 Agent 接口" });
  }
  if (algorithm.requirements.agentRequired && draft.execution !== "agent") {
    issues.push({ field: "models", message: "该算法需要选择自己的 Agent 接口" });
  }
  if (algorithm.scenario !== draft.scenario || !algorithm.accepts.includes(draft.taskType)) {
    issues.push({ field: "algorithm", message: "所选算法不支持这种任务类型" });
    return issues;
  }
  if (joinable(draft, datasets, participants).length < algorithm.minParticipants) {
    issues.push({ field: "participants", message: `至少选择 ${algorithm.minParticipants} 个可用的数据来源` });
  }
  const chosen = joinable(draft, datasets, participants);
  const overrides = activeOverrides(draft);
  if (
    draft.mode === "full" &&
    chosen.length &&
    !chosen.some((p) => datasets.find((d) => d.id === p.datasetId)?.resourceSpace === "workspace")
  ) {
    issues.push({ field: "participants", message: "正式任务至少需要一份我的数据；公用数据可以先用于试跑" });
  }
  const refs = [
    ...(algorithm.requirements.participantModel && draft.execution !== "agent"
      ? chosen
          .filter((p) => participants.find((owner) => owner.id === p.participantId)?.hosting === "platform")
          .map((p) => overrides[p.participantId] || draft.clientModel)
      : []),
    ...(algorithm.stages.some((stage) => stage.side === "server" && stage.model) ? [draft.serverModel] : []),
  ];
  if (draft.execution === "agent" && !draft.agentId) issues.push({ field: "models", message: "选择 Agent 接口" });
  if (refs.some((ref) => !endpointOf(ref, endpoints))) {
    issues.push({ field: "models", message: "所选的模型接口已不存在，请重新选择" });
  }
  if (draft.rounds < algorithm.minRounds || draft.rounds > algorithm.maxRounds) {
    issues.push({ field: "rounds", message: `轮次在 ${algorithm.minRounds}–${algorithm.maxRounds} 之间` });
  }
  return issues;
}

/** 草稿里真正能参加的参与方：数据集还在、属于这个参与方、场景和任务类型一致、持有方在线。 */
export function joinable(
  draft: Draft,
  datasets: readonly Dataset[],
  participants: readonly Participant[],
): TaskParticipant[] {
  const { scenario, taskType } = draft;
  if (!scenario || !taskType) return [];
  return draft.participants.filter(({ participantId, datasetId }) => {
    const dataset = datasets.find((item) => item.id === datasetId && item.participantId === participantId);
    const owner = participants.find((item) => item.id === participantId);
    if (owner?.hosting === "local" && draft.algorithm) {
      const algorithm = algorithmOf(draft.algorithm);
      if (owner.clientPlugins?.[algorithm.id] !== algorithm.version) return false;
    }
    return Boolean(dataset && fits(dataset, scenario, taskType) && usable(dataset, participants));
  });
}

export type DataSourceChoice = { participant: Participant; datasets: Dataset[] };

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
    if (!dataset.ready || dataset.resourceSpace !== space || !fits(dataset, draft.scenario, draft.taskType)) continue;
    const group = grouped.get(dataset.participantId) ?? [];
    group.push(dataset);
    grouped.set(dataset.participantId, group);
  }
  return participants.flatMap((participant) => {
    if (
      participant.status !== "online" ||
      (participant.hosting === "local" && participant.clientPlugins?.[algorithm.id] !== algorithm.version)
    )
      return [];
    const choices = grouped.get(participant.id);
    return choices?.length ? [{ participant, datasets: choices }] : [];
  });
}

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
    agentId: draft.execution === "agent" ? draft.agentId ?? null : null,
    agentOverrides: Object.fromEntries(Object.entries(draft.execution === "agent" ? draft.agentOverrides ?? {} : {}).filter(([id]) => draft.participants.some((p) => p.participantId === id))),
    rounds: draft.rounds,
    mode: draft.mode,
    trialCap: draft.trialCap,
    params: paramsOf(algorithmOf(draft.algorithm), draft.params),
    seed: draft.seed,
    workers: draft.workers,
  };
}

/** 只保留已选参与方的单独模型设置（取消勾选后，之前的设置不再生效）。 */
export function activeOverrides(config: Pick<TaskConfig, "participants" | "clientOverrides">): Record<string, string> {
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
export function defaultTaskName(draft: Pick<Draft, "taskType">, now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  // 名称里不用"·"：页面上"·"是元信息的分隔符。
  return `${draft.taskType ? `${TASK_TYPES[draft.taskType].label}任务` : "联邦任务"} ${stamp}`;
}

/** 能用于某个场景、某种任务类型的数据集。 */
export function compatibleDatasets(scenario: ScenarioId, taskType: TaskType, datasets: readonly Dataset[]): Dataset[] {
  return datasets.filter((dataset) => fits(dataset, scenario, taskType));
}

/** 选场景：换场景时清空后面的选择，任务类型、算法和参与方都要用户再选。 */
export function chooseScenario(draft: Draft, scenario: ScenarioId): Draft {
  if (draft.scenario === scenario) return draft;
  return { ...draft, scenario, taskType: null, algorithm: null, participants: [], clientOverrides: {}, agentId: null, agentOverrides: {}, execution: "builtin", params: {} };
}

/** 任务类型只改变数据和评分，不重置已经选好的算法与算法参数。 */
export function chooseTaskType(draft: Draft, taskType: TaskType): Draft {
  if (!draft.algorithm || !algorithmOf(draft.algorithm).accepts.includes(taskType) || draft.taskType === taskType) return draft;
  return { ...draft, taskType, participants: [], clientOverrides: {}, agentOverrides: {} };
}

/** 选算法后明确选择支持的任务；不同算法的资源、执行方式和参数不互相沿用。 */
export function chooseAlgorithm(draft: Draft, algorithm: AlgorithmId): Draft {
  const definition = algorithmOf(algorithm);
  if (draft.algorithm === algorithm || definition.scenario !== draft.scenario) return draft;
  return {
    ...draft,
    algorithm,
    taskType: null,
    participants: [],
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
export function pickDataset(draft: Draft, participantId: string, datasetId: string | null): Draft {
  if (!datasetId)
    return { ...draft, participants: draft.participants.filter((item) => item.participantId !== participantId) };
  const next = { participantId, datasetId };
  const exists = draft.participants.some((item) => item.participantId === participantId);
  return {
    ...draft,
    participants: exists
      ? draft.participants.map((item) => (item.participantId === participantId ? next : item))
      : [...draft.participants, next],
  };
}

/**
 * 从新建任务出发新登记的数据集，能不能直接选入任务：任务已经选好算法，数据集的场景和任务类型一致，
 * 持有方在线、样本已就绪，而且这个参与方在任务里还没有选数据集（已经选了的不替用户换掉）。
 */
export function canPickInto(draft: Draft, owner: Participant, dataset: Dataset): boolean {
  if (!draft.algorithm || !draft.scenario || !draft.taskType) return false;
  if (!usable(dataset, [owner]) || !fits(dataset, draft.scenario, draft.taskType)) return false;
  return !draft.participants.some((item) => item.participantId === owner.id);
}

/** 一次设好全部参与方（表头的全选）；同一个参与方只保留第一份。 */
export function setParticipants(draft: Draft, participants: readonly TaskParticipant[]): Draft {
  const unique: TaskParticipant[] = [];
  for (const item of participants) {
    if (!unique.some((entry) => entry.participantId === item.participantId)) unique.push({ ...item });
  }
  return { ...draft, participants: unique };
}
