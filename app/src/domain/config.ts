/**
 * 任务配置：默认值、校验和调用量预估。
 *
 * 参数与已审计的 FoT 复现器一一对应（轮次、洞见库条数、trace 密度、每题 trace 上限、汇总重试、种子、并发），
 * 只有汇总重试上限的默认值不同：复现器默认 0（一直重试到结果合法），平台默认 5 次，超过后暂停任务，避免费用失控。
 */
import { algorithmOf, algorithmsFor, scenarioOf, type AlgorithmId, type ScenarioId } from "./catalog";
import { DEFAULT_MODEL, endpointOf, usable, type Dataset, type Endpoint, type Participant } from "./resources";

export type RunMode = "trial" | "full";
export type InsightTarget = "paper-auto" | "author-formula" | "fixed-11" | "fixed-37";
export type TraceDensity = "native" | "paper-gemini";

export type TaskConfig = {
  scenario: ScenarioId;
  algorithm: AlgorithmId;
  datasetIds: string[];
  clientModel: string;
  /** 数据集 id → 模型引用；没有单独指定的参与方用 clientModel。 */
  clientOverrides: Record<string, string>;
  serverModel: string;
  rounds: number;
  mode: RunMode;
  /** 试跑时每份数据只取前几题。 */
  trialCap: number;
  insightTarget: InsightTarget;
  traceDensity: TraceDensity;
  maxTracesPerItem: number | null;
  aggregationRetries: number;
  seed: number;
  workers: number;
};

/** 新建任务页的草稿：场景和算法可以还没选。 */
export type Draft = Omit<TaskConfig, "scenario" | "algorithm"> & {
  name: string;
  scenario: ScenarioId | null;
  algorithm: AlgorithmId | null;
};

export const DEFAULT_DRAFT: Draft = {
  name: "",
  scenario: null,
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

export const INSIGHT_TARGETS: readonly { id: InsightTarget; label: string; hint: string }[] = [
  { id: "paper-auto", label: "论文默认", hint: "由服务端模型按 Prompt 5 自行决定条数" },
  { id: "author-formula", label: "上游代码公式", hint: "按 trace 数计算：int(log10(trace 数) × 10 + 1)" },
  { id: "fixed-11", label: "固定 11 条", hint: "消融实验：论文中 DeepSeek 第 3 轮的条数" },
  { id: "fixed-37", label: "固定 37 条", hint: "消融实验：论文中 Gemini 第 3 轮的条数" },
];

export const TRACE_DENSITIES: readonly { id: TraceDensity; label: string; hint: string }[] = [
  { id: "native", label: "原生", hint: "按 Prompt 3 提取全部可复用的 trace" },
  { id: "paper-gemini", label: "按论文密度校准", hint: "每题最多保留 1 条最有价值的 trace，接近论文 Gemini 的通信量" },
];

export function withDefaults(draft: Partial<Draft>): Draft {
  return { ...DEFAULT_DRAFT, ...draft, clientOverrides: { ...(draft.clientOverrides ?? {}) } };
}

/** 本次任务每份数据实际使用的题数。 */
export function problemsOf(config: Pick<TaskConfig, "mode" | "trialCap">, dataset: Dataset): number {
  return config.mode === "trial" ? Math.min(dataset.count, Math.max(1, config.trialCap)) : dataset.count;
}

export function selectedDatasets(draft: Pick<Draft, "datasetIds">, datasets: readonly Dataset[]): Dataset[] {
  return draft.datasetIds
    .map((id) => datasets.find((dataset) => dataset.id === id))
    .filter((dataset): dataset is Dataset => Boolean(dataset));
}

/** 预估口径。首次真实运行后应按实测的平均值校准。 */
export const ESTIMATE_BASIS = {
  tokensPerCall: { solve: 7000, reflect: 3500, extract: 2500 },
  secondsPerCall: { solve: 45, reflect: 15, extract: 12 },
  tracesPerProblem: { native: 1.5, "paper-gemini": 0.9 } satisfies Record<TraceDensity, number>,
  tokensPerTrace: 150,
  serverOutputTokens: 8000,
  secondsPerServerCall: 90,
} as const;

export type Estimate = {
  problems: number;
  participantCalls: number;
  /** 每轮至少 2 次（关系分析、生成洞见库），结果不合法时会重试。 */
  serverCalls: number;
  participantTokens: number;
  serverTokens: number;
  seconds: number;
  /** 两个接口都设置了单价才估算，单位：元。 */
  cost: number | null;
};

export function estimate(config: TaskConfig, datasets: readonly Dataset[], endpoints: readonly Endpoint[]): Estimate {
  const basis = ESTIMATE_BASIS;
  const counts = selectedDatasets(config, datasets).map((dataset) => problemsOf(config, dataset));
  const problems = counts.reduce((sum, value) => sum + value, 0);
  const perProblemTokens = basis.tokensPerCall.solve + basis.tokensPerCall.reflect + basis.tokensPerCall.extract;
  const traces = problems * basis.tracesPerProblem[config.traceDensity];
  const serverTokensPerRound = traces * basis.tokensPerTrace * 2 + basis.serverOutputTokens * 2;
  // 与复现器一致：并发数是所有参与方共用的线程池，每一步按全部题目排队。
  const batches = Math.ceil(problems / Math.max(1, config.workers));
  const perRoundSeconds = batches * (basis.secondsPerCall.solve + basis.secondsPerCall.reflect + basis.secondsPerCall.extract)
    + 2 * basis.secondsPerServerCall;

  const participantTokens = Math.round(problems * perProblemTokens * config.rounds);
  const serverTokens = Math.round(serverTokensPerRound * config.rounds);
  const clientPrice = endpointOf(config.clientModel, endpoints)?.price ?? null;
  const serverPrice = endpointOf(config.serverModel, endpoints)?.price ?? null;
  const overridesPriced = Object.values(activeOverrides(config)).every((ref) => endpointOf(ref, endpoints)?.price != null);
  const cost = clientPrice != null && serverPrice != null && overridesPriced
    ? (participantTokens * clientPrice + serverTokens * serverPrice) / 1_000_000
    : null;

  return {
    problems,
    participantCalls: problems * 3 * config.rounds,
    serverCalls: 2 * config.rounds,
    participantTokens,
    serverTokens,
    seconds: Math.round(perRoundSeconds * config.rounds),
    cost,
  };
}

export type Issue = { field: "scenario" | "algorithm" | "datasets" | "models" | "rounds"; message: string };

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
  const algorithm = algorithmOf(draft.algorithm);
  const chosen = selectedDatasets(draft, datasets).filter((dataset) => (
    algorithm.accepts.includes(dataset.taskType) && usable(dataset, participants)
  ));
  if (chosen.length < algorithm.minParticipants) {
    issues.push({ field: "datasets", message: `至少选 ${algorithm.minParticipants} 份数据（每份代表一个参与方）` });
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
  if (!draft.scenario || !draft.algorithm) return null;
  return {
    scenario: draft.scenario,
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

export function toDraft(config: TaskConfig, name = ""): Draft {
  return { ...config, name, datasetIds: [...config.datasetIds], clientOverrides: { ...config.clientOverrides } };
}

export function defaultTaskName(draft: Pick<Draft, "scenario" | "algorithm" | "datasetIds" | "mode">): string {
  if (!draft.scenario || !draft.algorithm) return "新任务";
  const parts = [scenarioOf(draft.scenario).name.replace(" Agent", ""), algorithmOf(draft.algorithm).name, `${draft.datasetIds.length} 方`];
  if (draft.mode === "trial") parts.push("试跑");
  return parts.join(" · ");
}

/** 算法能处理的数据（按任务类型匹配）。 */
export function compatibleDatasets(algorithm: AlgorithmId, datasets: readonly Dataset[]): Dataset[] {
  const accepts = algorithmOf(algorithm).accepts;
  return datasets.filter((dataset) => accepts.includes(dataset.taskType));
}

/**
 * 选场景：换场景时清空后面的选择；场景只有一个算法时直接选上，并默认勾选全部可用的数据（论文设置）。
 * 规划中的场景可以查看，但不会选出算法。
 */
export function chooseScenario(draft: Draft, scenario: ScenarioId, datasets: readonly Dataset[], participants: readonly Participant[]): Draft {
  if (draft.scenario === scenario) return draft;
  const next: Draft = { ...draft, scenario, algorithm: null, datasetIds: [], clientOverrides: {} };
  const options = algorithmsFor(scenario);
  return scenarioOf(scenario).status === "available" && options.length === 1
    ? chooseAlgorithm(next, options[0].id, datasets, participants)
    : next;
}

export function chooseAlgorithm(draft: Draft, algorithm: AlgorithmId, datasets: readonly Dataset[], participants: readonly Participant[]): Draft {
  if (draft.algorithm === algorithm) return draft;
  const datasetIds = compatibleDatasets(algorithm, datasets)
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
