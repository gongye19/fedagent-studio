/**
 * 联邦协作的场景、选项和策略注册表。
 *
 * 维度 1 是场景，按运行方式分两类：
 * - 连接节点、多轮运行：各参与方启动客户端节点并保持连接，平台按轮协调（照 Flower 的 SuperLink / SuperNode 方式）。
 * - 上传文件、一次完成：各参与方上传一次文件，平台汇总或合并后给出结果。
 * 场景下只保留真正需要选的子项（模型类别、共享方式），之后是维度 2 协作策略、维度 3 安全与隐私。
 * 只有前面的约束后面的。完整设计见 docs/DIMENSIONS.md。
 *
 * 收录原则（demo 阶段）：只保留最通用、最主流的方法；Agent / 大模型相关的方法例外保留，
 * 内部标为 frontier（界面不显示）。
 */

export type Adoption = "mainstream" | "frontier";

/** 场景和策略里只要有一个是前沿，整体就是前沿。 */
export function combinedAdoption(...levels: Adoption[]): Adoption {
  return levels.includes("frontier") ? "frontier" : "mainstream";
}

/** 协作策略在数学上做的是哪类计算，展示在平台推导里。 */
export type ComputeKind = "additive" | "ensemble" | "protocol" | "content";

export const COMPUTE_KIND_LABEL: Record<ComputeKind, string> = {
  additive: "可加（求和 / 加权平均）",
  ensemble: "集成（合并各方的树）",
  protocol: "纵向协议（加密交换内置）",
  content: "需理解内容（语义合并）",
};

export type ExecutionPattern = "iterative" | "vertical-protocol" | "aggregate-once" | "merge-once";

export const PATTERN_LABEL: Record<ExecutionPattern, string> = {
  iterative: "多轮联邦",
  "vertical-protocol": "纵向协议",
  "aggregate-once": "单轮汇总",
  "merge-once": "单轮合并",
};

export type Choice = {
  id: string;
  label: string;
  hint: string;
  adoption?: Adoption;
};

/** 输入接入方式：连接节点（多轮）或上传文件（一次）。场景按它分组。 */
export type InputKind = "nodes" | "files";

export const INPUT_KIND_LABEL: Record<InputKind, string> = {
  nodes: "连接节点 · 多轮运行",
  files: "上传文件 · 一次完成",
};

/* 1.1 模型类别、1.2 共享方式。只在训练场景出现。 */
export const MODEL_CLASSES: readonly Choice[] = [
  { id: "neural", label: "神经网络", hint: "CNN、Transformer、大模型等" },
  { id: "tree", label: "树模型", hint: "GBDT、XGBoost 等" },
  { id: "linear", label: "线性模型", hint: "逻辑回归、线性回归" },
];

export const SHARING_MODES: readonly Choice[] = [
  { id: "full", label: "全量参数", hint: "每轮交换整个模型的参数" },
  { id: "peft", label: "LoRA", hint: "冻结预训练基座，每轮只交换 LoRA 小参数", adoption: "frontier" },
];

export type ScenarioId = "horizontal-training" | "vertical-training" | "federated-analytics" | "agent-memory";

export type ParamDefinition = {
  id: string;
  label: string;
  options: readonly { id: string; label: string }[];
  defaultValue: string;
};

/** 场景内的子项取值，只列出需要的字段，避免与选择状态模块循环依赖。 */
export type ScenarioPath = { modelClass: string | null; sharing: string | null };

export type Scenario = {
  id: ScenarioId;
  label: string;
  summary: string;
  adoption: Adoption;
  /** 直接选场景时填好的子项默认值。 */
  defaults: Partial<ScenarioPath>;
  pattern: ExecutionPattern;
  input: { kind: InputKind; label: string };
  evaluation: string;
  output: (path: ScenarioPath) => string;
  minParticipants: number;
  /** 运行默认值，不在界面展示。 */
  params: readonly ParamDefinition[];
};

const opts = (...pairs: [string, string][]) => pairs.map(([id, label]) => ({ id, label }));

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "horizontal-training",
    label: "横向联邦训练",
    summary: "各方数据字段相同、样本不同，各自在本地训练，平台每轮合并模型。",
    adoption: "mainstream",
    defaults: { modelClass: "neural", sharing: "full" },
    pattern: "iterative",
    input: { kind: "nodes", label: "各方启动 Flower 节点并连接平台" },
    evaluation: "各方本地验证 + 平台独立评测",
    output: (path) => (path.sharing === "peft" ? "全局 LoRA" : "全局模型"),
    minParticipants: 2,
    params: [
      { id: "rounds", label: "联邦轮次", options: opts(["10", "10 轮"], ["20", "20 轮"], ["50", "50 轮"]), defaultValue: "20" },
      { id: "local-epochs", label: "每轮本地训练", options: opts(["1", "1 epoch"], ["2", "2 epochs"]), defaultValue: "1" },
    ],
  },
  {
    id: "vertical-training",
    label: "纵向联邦训练",
    summary: "各方是同一批样本、不同字段，先隐私求交对齐样本，再加密交换中间结果联合训练。",
    adoption: "mainstream",
    defaults: {},
    pattern: "vertical-protocol",
    input: { kind: "nodes", label: "各方启动 NVFlare 节点并连接平台" },
    evaluation: "标签方本地验证",
    output: () => "按参与方分片保存的联合模型",
    minParticipants: 2,
    params: [
      { id: "trees", label: "树数量", options: opts(["50", "50 棵"]), defaultValue: "50" },
    ],
  },
  {
    id: "federated-analytics",
    label: "联邦统计分析",
    summary: "各方按模板上传本地汇总的统计表，平台统一计算整体结果。",
    adoption: "mainstream",
    defaults: {},
    pattern: "aggregate-once",
    input: { kind: "files", label: "各方上传统计汇总表" },
    evaluation: "一致性检查 + 最小分组检查",
    output: () => "整体统计报告",
    minParticipants: 2,
    params: [],
  },
  {
    id: "agent-memory",
    label: "Agent 记忆联邦",
    summary: "各方上传 Agent 记忆文件，平台脱敏、去重、合并并回放验证，生成新的记忆文件供下载。",
    adoption: "frontier",
    defaults: {},
    pattern: "merge-once",
    input: { kind: "files", label: "各方上传 Agent 记忆文件" },
    evaluation: "沙箱回放 + 敏感信息检查",
    output: () => "合并后的记忆文件",
    minParticipants: 2,
    params: [],
  },
];

export function scenarioOf(id: string | null): Scenario | undefined {
  return id ? SCENARIOS.find((scenario) => scenario.id === id) : undefined;
}

/* 维度 3：安全与隐私。内置保护随策略自动带上；可选增强只列 runner 实际提供的。 */
export type EnhancementId = "secagg" | "dp";

export type Enhancement = Choice & {
  id: EnhancementId;
  mechanisms: readonly string[];
  /** 选中后在准入中提示的注意事项。 */
  caution?: string;
};

export const ENHANCEMENTS: readonly Enhancement[] = [
  { id: "secagg", label: "安全聚合 SecAgg+", hint: "平台只能看到合并后的结果，看不到单个参与方的更新（至少 3 方）", mechanisms: ["SecAgg+"] },
  {
    id: "dp",
    label: "差分隐私",
    hint: "在合并结果上加噪，限制单条记录对结果的影响",
    mechanisms: ["中心化差分隐私"],
    caution: "参与方或记录较少时，差分隐私噪声对结果的影响会比较明显",
  },
];

export function enhancementOf(id: string): Enhancement | undefined {
  return ENHANCEMENTS.find((item) => item.id === id);
}

/** 所有场景都内置的基础保护。 */
export const BASELINE_PROTECTION = ["mTLS", "隔离沙箱", "审计日志"] as const;

/* 维度 2：协作策略。每条声明计算类型、联邦对象、runner、内置保护和可选增强。 */
export type Strategy = Choice & {
  scenario: ScenarioId;
  adoption: Adoption;
  computeKind: ComputeKind;
  /** 节点之间实际交换的对象（联邦对象，由平台推导展示）；共享方式为 LoRA 时换成 LoRA 增量。 */
  exchanged: string;
  runner: string;
  references: readonly string[];
  /** 协议自带、不能关闭的保护（除基础保护外）。 */
  builtin?: readonly string[];
  /** 该策略所在 runner 实际提供的可选增强。 */
  enhancements?: readonly EnhancementId[];
  /** 需要的模型类别；不符合时置灰。 */
  modelClasses?: readonly string[];
};

const NN_OR_LINEAR = ["neural", "linear"];

export const STRATEGIES: readonly Strategy[] = [
  { id: "hfl-fedavg", label: "FedAvg", hint: "按样本量加权平均各方的更新，最常用的基线", scenario: "horizontal-training", adoption: "mainstream", computeKind: "additive", exchanged: "模型参数增量", runner: "Flower", references: ["Flower FedAvg"], enhancements: ["secagg", "dp"], modelClasses: NN_OR_LINEAR },
  { id: "hfl-fedprox", label: "FedProx", hint: "本地训练加近端项，适合各方数据差异大", scenario: "horizontal-training", adoption: "mainstream", computeKind: "additive", exchanged: "模型参数增量", runner: "Flower", references: ["Flower FedProx"], enhancements: ["secagg", "dp"], modelClasses: NN_OR_LINEAR },
  { id: "hfl-xgb-bagging", label: "XGBoost Bagging", hint: "各方每轮在本地训练新的树，平台把树合并成一个集成模型", scenario: "horizontal-training", adoption: "mainstream", computeKind: "ensemble", exchanged: "本轮新增的树", runner: "Flower", references: ["Flower FedXgbBagging"], modelClasses: ["tree"] },

  { id: "vfl-secure-xgboost", label: "安全纵向 XGBoost", hint: "标签方加密梯度，其他方在密文上算分裂统计", scenario: "vertical-training", adoption: "mainstream", computeKind: "protocol", exchanged: "加密梯度与分裂统计", runner: "NVFlare", references: ["NVFlare Secure XGBoost"], builtin: ["ECDH PSI", "Paillier 同态加密"] },

  { id: "fa-basic-stats", label: "计数 / 求和 / 均值方差", hint: "各方上报分组计数和求和，平台算整体均值、比例和方差", scenario: "federated-analytics", adoption: "mainstream", computeKind: "additive", exchanged: "分组计数与求和", runner: "平台统计服务", references: ["自定义"], builtin: ["最小分组阈值"], enhancements: ["dp"] },
  { id: "fa-histogram", label: "分布直方图 / 分位数", hint: "各方按统一分箱上报计数，平台合并分布并估算分位数", scenario: "federated-analytics", adoption: "mainstream", computeKind: "additive", exchanged: "分箱计数", runner: "平台统计服务", references: ["自定义"], builtin: ["最小分组阈值", "统一分箱"], enhancements: ["dp"] },

  { id: "mem-dedup", label: "去重合并", hint: "按内容相似度去重，保留来源和时间，合并成一份记忆", scenario: "agent-memory", adoption: "frontier", computeKind: "content", exchanged: "脱敏后的记忆条目", runner: "平台记忆合并器", references: ["Agent KB"], builtin: ["敏感信息脱敏"] },
  { id: "mem-arbitration", label: "去重 + 冲突仲裁", hint: "在去重基础上，由 Agent 审阅互相矛盾的记忆，只保留一致的", scenario: "agent-memory", adoption: "frontier", computeKind: "content", exchanged: "脱敏后的记忆条目", runner: "平台记忆合并器", references: ["Agent KB"], builtin: ["敏感信息脱敏"] },
];

export function strategyOf(id: string | null): Strategy | undefined {
  return id ? STRATEGIES.find((strategy) => strategy.id === id) : undefined;
}

export type Availability = { available: boolean; reason?: string; warning?: string };
