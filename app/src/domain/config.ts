/**
 * 任务配置：默认值、校验和调用量预估。
 *
 * 新建任务依次选场景 → 任务类型 → 算法 → 参与方，每一步都由用户选，页面不替用户默认。
 * 预估按算法在注册表里声明的步骤和交换量计算，平台不认具体的算法；平台只负责按接口单价算费用。
 *
 * FoT 的参数与已审计的复现器一一对应（轮次、经验库条数、经验提取量、每条样本上传上限、汇总重试、种子、并发），
 * 只有汇总重试上限的默认值不同：复现器默认 0（一直重试到结果合法），平台默认 5 次，超过后暂停任务，避免费用失控。
 */
import { algorithmOf, scenarioOf, TASK_TYPES, type AlgorithmId, type ScenarioId, type TaskType } from "./catalog";
import { DEFAULT_MODEL, endpointOf, usable, type Dataset, type Endpoint, type Participant } from "./resources";

export type RunMode = "trial" | "full";
export type InsightTarget = "paper-auto" | "author-formula" | "fixed-11" | "fixed-37";
export type TraceDensity = "native" | "paper-gemini";

export type TaskConfig = {
  scenario: ScenarioId;
  /** 任务类型：决定数据格式、评估指标，以及能选哪些算法和数据集。 */
  taskType: TaskType;
  algorithm: AlgorithmId;
  datasetIds: string[];
  clientModel: string;
  /** 数据集 id → 模型引用；没有单独指定的参与方用 clientModel。 */
  clientOverrides: Record<string, string>;
  serverModel: string;
  rounds: number;
  mode: RunMode;
  /** 试跑时每份数据只取前几条样本。 */
  trialCap: number;
  insightTarget: InsightTarget;
  traceDensity: TraceDensity;
  maxTracesPerItem: number | null;
  aggregationRetries: number;
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
  /** 用户动过这份草稿（从场景入口带进来的场景不算）。只有动过的草稿，再打开时才提示"已恢复"。 */
  touched: boolean;
};

export const DEFAULT_DRAFT: Draft = {
  name: null,
  touched: false,
  scenario: null,
  taskType: null,
  algorithm: null,
  datasetIds: [],
  clientModel: DEFAULT_MODEL,
  clientOverrides: {},
  serverModel: DEFAULT_MODEL,
  rounds: 3,
  mode: "trial",
  trialCap: 5,
  insightTarget: "paper-auto",
  traceDensity: "native",
  maxTracesPerItem: null,
  aggregationRetries: 5,
  seed: 0,
  workers: 8,
};

export function withDefaults(draft: Partial<Draft>): Draft {
  return { ...DEFAULT_DRAFT, ...draft, clientOverrides: { ...(draft.clientOverrides ?? {}) } };
}

/** 本次任务每份数据实际使用的样本数。 */
export function problemsOf(config: Pick<TaskConfig, "mode" | "trialCap">, dataset: Dataset): number {
  return config.mode === "trial" ? Math.min(dataset.count, Math.max(1, config.trialCap)) : dataset.count;
}

export function selectedDatasets(draft: Pick<Draft, "datasetIds">, datasets: readonly Dataset[]): Dataset[] {
  return draft.datasetIds
    .map((id) => datasets.find((dataset) => dataset.id === id))
    .filter((dataset): dataset is Dataset => Boolean(dataset));
}

export type Estimate = {
  problems: number;
  participantCalls: number;
  /** 服务端调用模型的步骤每轮各一次；结果不合法时会重试，所以是下限。 */
  serverCalls: number;
  participantTokens: number;
  serverTokens: number;
  seconds: number;
  /** 用到的接口都设置了单价才估算，单位：元。 */
  cost: number | null;
};

/**
 * 调用量预估，全部由算法的注册表定义得出：
 * - 参与方：每条样本在每个参与方步骤调用一次模型；
 * - 服务端：调用模型的步骤每轮一次，读入各方这一轮上传的全部内容；
 * - 耗时：并发数是所有参与方共用的线程池，参与方步骤按全部样本分批排队，服务端步骤各自计时。
 */
export function estimate(config: TaskConfig, datasets: readonly Dataset[], endpoints: readonly Endpoint[]): Estimate {
  const algorithm = algorithmOf(config.algorithm);
  const problems = selectedDatasets(config, datasets).map((dataset) => problemsOf(config, dataset)).reduce((sum, value) => sum + value, 0);
  const participantStages = algorithm.stages.filter((stage) => stage.side === "participant");
  const serverModelStages = algorithm.stages.filter((stage) => stage.side === "server" && stage.model);
  const uploadTokens = problems * algorithm.exchangeVolume.perSample(config) * algorithm.exchangeVolume.tokens;
  const batches = Math.ceil(problems / Math.max(1, config.workers));
  const perRoundSeconds = algorithm.stages.reduce((sum, stage) => sum + (stage.side === "participant" ? batches * stage.seconds : stage.seconds), 0);
  const participantTokens = Math.round(problems * participantStages.reduce((sum, stage) => sum + (stage.tokens ?? 0), 0) * config.rounds);
  const serverTokens = Math.round(serverModelStages.reduce((sum, stage) => sum + uploadTokens + (stage.tokens ?? 0), 0) * config.rounds);

  const clientPrice = endpointOf(config.clientModel, endpoints)?.price ?? null;
  const serverPrice = endpointOf(config.serverModel, endpoints)?.price ?? null;
  const overridesPriced = Object.values(activeOverrides(config)).every((ref) => endpointOf(ref, endpoints)?.price != null);
  const cost = clientPrice != null && serverPrice != null && overridesPriced
    ? (participantTokens * clientPrice + serverTokens * serverPrice) / 1_000_000
    : null;

  return {
    problems,
    participantCalls: problems * participantStages.length * config.rounds,
    serverCalls: serverModelStages.length * config.rounds,
    participantTokens,
    serverTokens,
    seconds: Math.round(perRoundSeconds * config.rounds),
    cost,
  };
}

export type Issue = { field: "scenario" | "taskType" | "algorithm" | "datasets" | "models" | "rounds"; message: string };

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
  if (!draft.taskType) {
    issues.push({ field: "taskType", message: "选择任务类型" });
    return issues;
  }
  if (!draft.algorithm) {
    issues.push({ field: "algorithm", message: "选择算法" });
    return issues;
  }
  const algorithm = algorithmOf(draft.algorithm);
  if (!algorithm.accepts.includes(draft.taskType)) {
    issues.push({ field: "algorithm", message: "所选算法不支持这种任务类型" });
    return issues;
  }
  const taskType = draft.taskType;
  const chosen = selectedDatasets(draft, datasets).filter((dataset) => dataset.taskType === taskType && usable(dataset, participants));
  if (chosen.length < algorithm.minParticipants) {
    issues.push({ field: "datasets", message: `至少选 ${algorithm.minParticipants} 个参与方` });
  }
  const refs = [draft.clientModel, draft.serverModel, ...Object.values(activeOverrides(draft))];
  if (refs.some((ref) => !endpointOf(ref, endpoints))) {
    issues.push({ field: "models", message: "所选的模型接口已不存在，请重新选择" });
  }
  if (draft.rounds < algorithm.minRounds || draft.rounds > algorithm.maxRounds) {
    issues.push({ field: "rounds", message: `轮次在 ${algorithm.minRounds}–${algorithm.maxRounds} 之间` });
  }
  return issues;
}

export function toConfig(draft: Draft): TaskConfig | null {
  if (!draft.scenario || !draft.taskType || !draft.algorithm) return null;
  return {
    scenario: draft.scenario,
    taskType: draft.taskType,
    algorithm: draft.algorithm,
    datasetIds: [...draft.datasetIds],
    clientModel: draft.clientModel,
    clientOverrides: activeOverrides(draft),
    serverModel: draft.serverModel,
    rounds: draft.rounds,
    mode: draft.mode,
    trialCap: draft.trialCap,
    insightTarget: draft.insightTarget,
    traceDensity: draft.traceDensity,
    maxTracesPerItem: draft.maxTracesPerItem,
    aggregationRetries: draft.aggregationRetries,
    seed: draft.seed,
    workers: draft.workers,
  };
}

/** 只保留已选数据的单独模型设置（取消勾选后，之前的设置不再生效）。 */
export function activeOverrides(config: Pick<TaskConfig, "datasetIds" | "clientOverrides">): Record<string, string> {
  return Object.fromEntries(Object.entries(config.clientOverrides).filter(([id]) => config.datasetIds.includes(id)));
}

/** 某个参与方实际使用的模型。 */
export function clientModelOf(config: Pick<TaskConfig, "clientModel" | "clientOverrides">, datasetId: string): string {
  return config.clientOverrides[datasetId] ?? config.clientModel;
}

/** "复制为新任务"：带上原任务的配置，算作用户动过的草稿。 */
export function toDraft(config: TaskConfig, name: string | null = null): Draft {
  return { ...config, name, touched: true, datasetIds: [...config.datasetIds], clientOverrides: { ...config.clientOverrides } };
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

/** 能参加某类任务的数据集（按任务类型匹配）。 */
export function compatibleDatasets(taskType: TaskType, datasets: readonly Dataset[]): Dataset[] {
  return datasets.filter((dataset) => dataset.taskType === taskType);
}

/** 选场景：换场景时清空后面的选择，任务类型和算法都要用户再选。 */
export function chooseScenario(draft: Draft, scenario: ScenarioId): Draft {
  if (draft.scenario === scenario) return draft;
  return { ...draft, scenario, taskType: null, algorithm: null, datasetIds: [], clientOverrides: {} };
}

/** 选任务类型：换类型时清空算法和参与方（算法和数据集都要能处理这种任务）。 */
export function chooseTaskType(draft: Draft, taskType: TaskType): Draft {
  if (draft.taskType === taskType) return draft;
  return { ...draft, taskType, algorithm: null, datasetIds: [], clientOverrides: {} };
}

/** 选算法：勾选全部能参加的数据集（任务类型匹配、持有方在线），之后用户可以再增减。 */
export function chooseAlgorithm(draft: Draft, algorithm: AlgorithmId, datasets: readonly Dataset[], participants: readonly Participant[]): Draft {
  if (draft.algorithm === algorithm || !draft.taskType) return draft;
  const datasetIds = compatibleDatasets(draft.taskType, datasets)
    .filter((dataset) => usable(dataset, participants))
    .map((dataset) => dataset.id);
  return { ...draft, algorithm, datasetIds, clientOverrides: {} };
}

export function toggleDataset(draft: Draft, datasetId: string): Draft {
  const datasetIds = draft.datasetIds.includes(datasetId)
    ? draft.datasetIds.filter((id) => id !== datasetId)
    : [...draft.datasetIds, datasetId];
  return { ...draft, datasetIds };
}
