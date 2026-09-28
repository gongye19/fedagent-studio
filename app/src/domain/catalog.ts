/**
 * 场景、任务类型与算法注册表。平台是通用的：页面只按这里的定义展示和校验，不针对某个算法写死；
 * 接入后端后改为由后端注册表下发。
 *
 * 场景沿用联邦学习的三分法，落到 Agent 上：
 * - 横向：各方做同一类任务，数据不同；
 * - 纵向：同一批对象，各方掌握不同方面的信息；
 * - 迁移：把已有参与方的经验迁移到新领域。
 * 每个算法只属于一个场景，并声明：适用的任务类型、各方交换什么、产出什么、有哪些可调参数、每轮分几步。
 * 第一版只登记了横向的 FoT（用来做演示），纵向和迁移的算法待接入。
 */
import type { Draft } from "./config";

export type ScenarioId = "horizontal" | "vertical" | "transfer";
export type AlgorithmId = "fot";
export type TaskType = "math-reasoning";
export type GraderId = "math-answer";

export type Scenario = {
  id: ScenarioId;
  name: string;
  /** 选项按钮上的短名。 */
  short: string;
  /** 一句话说明。 */
  summary: string;
  example: string;
  /** 每个参与方需要带来的数据。 */
  dataNeeds: string;
  status: "available" | "planned";
};

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "horizontal",
    name: "横向联邦 Agent",
    short: "横向联邦",
    summary: "各方做同类任务、数据不同，只共享经验，一起提升",
    example: "8 个数学竞赛题库，各由一个参与方持有",
    dataNeeds: "每方一份同类型的数据集",
    status: "available",
  },
  {
    id: "vertical",
    name: "纵向联邦 Agent",
    short: "纵向联邦",
    summary: "同一批对象，信息分散在各方，结合起来才能回答",
    example: "银行有交易记录、电商有消费记录，共同回答同一批用户的问题",
    dataNeeds: "各方持有同一批对象的不同信息",
    status: "planned",
  },
  {
    id: "transfer",
    name: "联邦迁移 Agent",
    short: "联邦迁移",
    summary: "把已有参与方的经验迁移到新领域",
    example: "把数学推理的经验迁移到物理题",
    dataNeeds: "源领域经验和目标领域的少量数据",
    status: "planned",
  },
];

/** 任务类型：决定数据格式、评估指标和评分方式。 */
export const TASK_TYPES: Record<TaskType, { label: string; metric: string; grader: GraderId }> = {
  "math-reasoning": { label: "数学推理", metric: "准确率", grader: "math-answer" },
};

export const GRADERS: Record<GraderId, { label: string; detail: string }> = {
  "math-answer": { label: "答案比对", detail: "抽取 \\boxed{} 里的答案，规范化后与标准答案比较" },
};

/** 每轮的步骤：由算法定义，进度页只按这里的名称展示。 */
export type StageId = "solve" | "reflect" | "extract" | "collect" | "profile" | "library";

export type Stage = {
  id: StageId;
  label: string;
  side: "participant" | "server";
  detail: string;
};

export const FOT_STAGES: readonly Stage[] = [
  { id: "solve", label: "解题", side: "participant", detail: "带上当前洞见库作答" },
  { id: "reflect", label: "反思", side: "participant", detail: "回顾有效和无效的步骤" },
  { id: "extract", label: "提取 trace", side: "participant", detail: "把可复用的做法写成 trace" },
  { id: "collect", label: "汇总", side: "server", detail: "收集各方上传的 trace" },
  { id: "profile", label: "关系分析", side: "server", detail: "把 trace 归类" },
  { id: "library", label: "生成洞见库", side: "server", detail: "生成下一轮使用的洞见库" },
];

/**
 * 算法的可调参数。页面按这里的定义生成"高级配置"里的表单项，默认值即推荐值。
 * key 对应任务配置里的字段。
 */
export type ParamDef =
  | {
    key: "insightTarget" | "traceDensity";
    label: string;
    kind: "select";
    options: readonly { value: string; label: string }[];
  }
  | {
    key: "maxTracesPerItem";
    label: string;
    kind: "select-number";
    options: readonly { value: number | null; label: string }[];
  }
  | {
    key: "aggregationRetries";
    label: string;
    kind: "number";
    min: number;
    max: number;
    unit: string;
  };

export type Algorithm = {
  id: AlgorithmId;
  scenario: ScenarioId;
  name: string;
  fullName: string;
  /** 一句话说明。 */
  summary: string;
  /** 各方和服务端之间交换的内容。 */
  exchange: string;
  /** 算法的产出物，例如洞见库、全局模型。 */
  output: { name: string; unit: string };
  stages: readonly Stage[];
  accepts: readonly TaskType[];
  /** 标注只用于评分时为 false：没有标注的数据也能参与。 */
  answersRequired: boolean;
  params: readonly ParamDef[];
  minParticipants: number;
  minRounds: number;
  maxRounds: number;
  source: { paper: string; paperUrl: string; code: string; codeUrl: string };
};

export const ALGORITHMS: readonly Algorithm[] = [
  {
    id: "fot",
    scenario: "horizontal",
    name: "FoT",
    fullName: "Federation over Text",
    summary: "各方上传推理经验，服务端合成洞见库",
    exchange: "文本 trace",
    output: { name: "洞见库", unit: "条洞见" },
    stages: FOT_STAGES,
    accepts: ["math-reasoning"],
    answersRequired: false,
    params: [
      {
        key: "insightTarget",
        label: "洞见库条数",
        kind: "select",
        options: [
          { value: "paper-auto", label: "论文默认（模型自定）" },
          { value: "author-formula", label: "按 trace 数计算" },
          { value: "fixed-11", label: "固定 11 条" },
          { value: "fixed-37", label: "固定 37 条" },
        ],
      },
      {
        key: "traceDensity",
        label: "trace 密度",
        kind: "select",
        options: [
          { value: "native", label: "原生（全部提取）" },
          { value: "paper-gemini", label: "按论文密度（每条样本 1 条）" },
        ],
      },
      {
        key: "maxTracesPerItem",
        label: "每条样本最多 trace",
        kind: "select-number",
        options: [
          { value: null, label: "不限" },
          { value: 1, label: "1 条" },
          { value: 2, label: "2 条" },
          { value: 3, label: "3 条" },
        ],
      },
      { key: "aggregationRetries", label: "汇总重试上限", kind: "number", min: 1, max: 20, unit: "次" },
    ],
    minParticipants: 2,
    minRounds: 2,
    maxRounds: 6,
    source: {
      paper: "arXiv:2604.16778",
      paperUrl: "https://arxiv.org/abs/2604.16778",
      code: "github.com/dixiyao/FoT",
      codeUrl: "https://github.com/dixiyao/FoT",
    },
  },
];

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

export function algorithmsFor(scenario: ScenarioId): Algorithm[] {
  return ALGORITHMS.filter((algorithm) => algorithm.scenario === scenario);
}

export function stageOf(id: StageId): Stage {
  const stage = FOT_STAGES.find((item) => item.id === id);
  if (!stage) throw new Error(`unknown stage: ${id}`);
  return stage;
}

/** 参数取值的显示文字。 */
export function paramText(def: ParamDef, draft: Pick<Draft, ParamDef["key"]>): string {
  const value = draft[def.key];
  if (def.kind === "number") return `${value} ${def.unit}`;
  return def.options.find((option) => option.value === value)?.label ?? String(value);
}
