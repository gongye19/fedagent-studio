/**
 * 场景、任务类型与算法注册表。平台是通用的：页面、校验和进度都只按这里的定义来，不针对某个算法写死。
 *
 * 注册表由后端下发（GET /v1/registry，来自后端安装的插件），应用启动时先装进来再渲染页面（installRegistry）；
 * 下面的常量在装入之前是空的。三个概念分开：
 * - 场景：各方的数据怎么分布。横向 = 各方做同一类任务，各有各的样本；纵向 = 同一批对象，各方掌握不同方面的信息；
 *   迁移 = 把已有领域的经验用到新领域；
 * - 任务类型：Agent 要做的事，决定数据格式和评估指标；
 * - 算法：各方怎么协作。每个算法只属于一个场景，并声明适用的任务类型、各方交换什么、产出什么、
 *   有哪些可调参数（含默认值）、每轮分几步。
 */
import type { components } from "../api/schema";

export type ScenarioId = string;
export type AlgorithmId = string;
export type TaskType = string;
export type GraderId = string;

export type Scenario = {
  id: ScenarioId;
  name: string;
  /** 选项按钮上的短名。 */
  short: string;
  /** 一句话说明。 */
  summary: string;
  status: "available" | "planned";
};

export type TaskTypeDef = {
  label: string;
  metric: string;
  grader: GraderId;
  /** 数据集一行的格式，写在上传框里。 */
  format: string;
  /** 没有标注的样本怎么处理。 */
  unlabeledNote: string;
  /** 试用时输入框的占位文字。 */
  placeholder: string;
  structuredInput?: boolean;
  inputLabel?: string;
  answerLabel?: string;
  inputFields?: components["schemas"]["InputFieldOut"][];
};

/** 每轮的步骤：由算法定义，进度页只按这里的定义来。步骤 id 由算法自己取。 */
export type StageId = string;

/**
 * 一步完成后记下什么结果、进度页显示什么，都按这里的类型处理，不认具体的算法：
 * metric = 本轮指标，uploads = 各方上传条数，received = 服务端收到条数，groups = 分出的类别数，output = 产出条数。
 */
export type StageResult = "metric" | "uploads" | "received" | "groups" | "output";

export type Stage = {
  per?: "item" | "site";
  id: StageId;
  label: string;
  side: "participant" | "server";
  result?: StageResult;
  /** 预估用（后端按实测校准）：参与方步骤是一批并发调用的耗时，服务端步骤是这一步的耗时。 */
  seconds: number;
  tokens?: number;
  model?: boolean;
};

/** 算法的可调参数。页面按这里的定义生成"高级配置"里的表单项，任务配置里按 key 保存取值，平台不认具体的参数。 */
export type ParamValue = string | number | null;
export type Params = Record<string, ParamValue>;

type ParamBase = { key: string; label: string; help: string };
export type ParamDef =
  | (ParamBase & { kind: "select"; options: readonly { value: string; label: string }[]; default: string })
  | (ParamBase & { kind: "select-number"; options: readonly { value: number | null; label: string }[]; default: number | null })
  | (ParamBase & { kind: "number"; min: number; max: number; unit: string; default: number });

export type Algorithm = {
  id: AlgorithmId;
  version: string;
  scenario: ScenarioId;
  name: string;
  fullName: string;
  /** 一句话说明。 */
  summary: string;
  /** 各方和服务端之间交换的内容。 */
  exchange: string;
  /** 算法的产出物，例如经验库、全局模型。 */
  output: { name: string; unit: string };
  stages: readonly Stage[];
  accepts: readonly TaskType[];
  params: readonly ParamDef[];
  minParticipants: number;
  minSamples?: number;
  minRounds: number;
  maxRounds: number;
  defaultRounds: number;
  source: { paper: string; paperUrl: string; code: string; codeUrl: string };
  requirements: components["schemas"]["ResourceRequirementsOut"];
};

export const SCENARIOS: Scenario[] = [];
export const TASK_TYPES: Record<TaskType, TaskTypeDef> = {};
export const GRADERS: Record<GraderId, { label: string; detail: string }> = {};
export const ALGORITHMS: Algorithm[] = [];

type Registry = components["schemas"]["RegistryOut"];

function toParam(param: components["schemas"]["ParamOut"]): ParamDef {
  const base = { key: param.key, label: param.label, help: param.help };
  if (param.kind === "number") {
    return { ...base, kind: "number", min: param.min ?? 0, max: param.max ?? Number.MAX_SAFE_INTEGER, unit: param.unit ?? "", default: Number(param.default) };
  }
  if (param.kind === "select-number") {
    return {
      ...base,
      kind: "select-number",
      options: param.options.map((option) => ({ value: option.value === null ? null : Number(option.value), label: option.label })),
      default: param.default === null ? null : Number(param.default),
    };
  }
  return { ...base, kind: "select", options: param.options.map((option) => ({ value: String(option.value), label: option.label })), default: String(param.default) };
}

/** 装入后端下发的注册表（应用启动时调用一次；数组和对象原地更新，各处的引用都能看到）。 */
export function installRegistry(registry: Registry): void {
  SCENARIOS.splice(0, SCENARIOS.length, ...registry.scenarios);
  for (const key of Object.keys(TASK_TYPES)) delete TASK_TYPES[key];
  for (const key of Object.keys(GRADERS)) delete GRADERS[key];
  for (const item of registry.taskTypes) {
    TASK_TYPES[item.id] = {
      label: item.label,
      metric: item.metric,
      grader: item.grader ?? "",
      format: item.format,
      unlabeledNote: item.unlabeledNote,
      placeholder: item.placeholder,
      structuredInput: item.structuredInput,
      inputLabel: item.inputLabel,
      answerLabel: item.answerLabel,
      inputFields: item.inputFields,
    };
    for (const grader of item.graders) GRADERS[grader.id] = { label: grader.label, detail: grader.detail };
  }
  ALGORITHMS.splice(
    0,
    ALGORITHMS.length,
    ...registry.algorithms.map((item): Algorithm => ({
      id: item.id,
      version: item.version,
      requirements: item.requirements,
      scenario: item.scenario,
      name: item.name,
      fullName: item.fullName,
      summary: item.summary,
      exchange: item.exchange,
      output: item.output ?? { name: "产出", unit: "条" },
      stages: item.stages.map((stage) => ({
        per: stage.per,
        id: stage.id,
        label: stage.label,
        side: stage.side,
        result: stage.result ?? undefined,
        seconds: stage.seconds,
        tokens: stage.tokens ?? undefined,
        model: stage.model,
      })),
      accepts: item.accepts,
      params: item.params.map(toParam),
      minParticipants: item.minParticipants,
      minSamples: item.minSamples,
      minRounds: item.minRounds,
      maxRounds: item.maxRounds,
      defaultRounds: item.defaultRounds,
      source: {
        paper: item.source.paper ?? "",
        paperUrl: item.source.paperUrl ?? "",
        code: item.source.code ?? "",
        codeUrl: item.source.codeUrl ?? "",
      },
    })),
  );
}

export function scenarioOf(id: ScenarioId): Scenario {
  const scenario = SCENARIOS.find((item) => item.id === id);
  if (!scenario) throw new Error(`unknown scenario: ${id}`);
  return scenario;
}

export function algorithmOf(id: AlgorithmId): Algorithm {
  const algorithm = ALGORITHMS.find((item) => item.id === id);
  if (!algorithm) throw new Error(`unknown algorithm: ${id}`);
  return algorithm;
}

/** 某个场景下的算法；给了任务类型时只列能处理这种任务的。 */
export function algorithmsFor(scenario: ScenarioId, taskType?: TaskType | null): Algorithm[] {
  return ALGORITHMS.filter((algorithm) => algorithm.scenario === scenario && (!taskType || algorithm.accepts.includes(taskType)));
}

/** 某个场景下能做的任务类型：这个场景里至少有一个算法能处理。 */
export function taskTypesFor(scenario: ScenarioId): TaskType[] {
  return Object.keys(TASK_TYPES).filter((type) => algorithmsFor(scenario, type).length > 0);
}

export function stageOf(algorithm: Algorithm, id: StageId): Stage {
  const stage = algorithm.stages.find((item) => item.id === id);
  if (!stage) throw new Error(`unknown stage: ${id}`);
  return stage;
}

/** 算法参数的默认取值（推荐值）。 */
export function defaultParams(algorithm: Algorithm): Params {
  return Object.fromEntries(algorithm.params.map((def) => [def.key, def.default]));
}

/** 补上没有设置的参数：任务里只保存取值，缺的按注册表的默认值。 */
export function paramsOf(algorithm: Algorithm, params: Params): Params {
  return { ...defaultParams(algorithm), ...params };
}

export function paramValue(def: ParamDef, params: Params): ParamValue {
  return def.key in params ? params[def.key] : def.default;
}

/** 参数取值的显示文字。 */
export function paramText(def: ParamDef, params: Params): string {
  const value = paramValue(def, params);
  if (def.kind === "number") return `${value} ${def.unit}`;
  return def.options.find((option) => option.value === value)?.label ?? String(value);
}
