/**
 * 联邦协作的分层维度与候选项注册表。
 *
 * 维度 1 是场景，子项按"用户最先能回答的问题"排序：1.1 协作目标 → 1.2 各方投入 → 1.3 数据关系 →
 * 1.4 模型类别 → 1.5 共享方式；之后是维度 2 协作策略、维度 3 安全与隐私。
 * 场景的运行默认值（params）不在界面展示。只有前面的约束后面的。完整设计见 docs/DIMENSIONS.md。
 *
 * 收录原则（demo 阶段）：只保留最通用、最主流的方法；Agent / 大模型相关的方法例外保留，
 * 内部标为 frontier（界面不显示）。参与方形态只支持跨机构（Cross-silo）。
 */

export type Adoption = "mainstream" | "frontier";

/** 场景和策略里只要有一个是前沿，整体就是前沿。 */
export function combinedAdoption(...levels: Adoption[]): Adoption {
  return levels.includes("frontier") ? "frontier" : "mainstream";
}

/** 协作策略在数学上做的是哪类计算，展示在平台推导里。 */
export type ComputeKind = "additive" | "compare" | "protocol" | "content";

export const COMPUTE_KIND_LABEL: Record<ComputeKind, string> = {
  additive: "可加（求和 / 加权平均）",
  compare: "需比较大小（排序、融合）",
  protocol: "纵向协议（加密交换内置）",
  content: "需理解内容（语义合并）",
};

export type ExecutionPattern =
  | "iterative"
  | "single-round"
  | "vertical-protocol"
  | "artifact-processing"
  | "query-time"
  | "evaluation-only";

export const PATTERN_LABEL: Record<ExecutionPattern, string> = {
  iterative: "多轮联邦",
  "single-round": "单轮聚合",
  "vertical-protocol": "纵向协议",
  "artifact-processing": "产物处理",
  "query-time": "查询时联邦",
  "evaluation-only": "纯评测",
};

export type Choice = {
  id: string;
  label: string;
  hint: string;
  adoption?: Adoption;
};

export type GoalId = "train" | "evaluate" | "analytics" | "retrieval" | "agent";

/* 1.1 协作目标 */
export const GOALS: readonly (Choice & { id: GoalId })[] = [
  { id: "train", label: "训练模型", hint: "共同得到一个模型" },
  { id: "evaluate", label: "评估模型", hint: "在多方数据上验证已有模型" },
  { id: "analytics", label: "统计分析", hint: "联合计算统计量，不训练模型" },
  { id: "retrieval", label: "检索增强问答", hint: "跨多方知识库检索并回答", adoption: "frontier" },
  { id: "agent", label: "Agent 与技能协作", hint: "共享轨迹、技能或 Agent 策略", adoption: "frontier" },
];

/* 1.2 各方投入。回答"每个参与方拿出来的是什么"，决定数据契约和执行模式。 */
export const CONTRIBUTIONS: readonly (Choice & { goals: readonly GoalId[] })[] = [
  { id: "local-data", label: "本地数据（不出域）", hint: "数据留在各方环境，只交换计算结果", goals: ["train", "analytics"] },
  { id: "local-test-data", label: "本地测试数据", hint: "待评模型下发到各方，在本地数据上评测", goals: ["evaluate"] },
  { id: "documents-index", label: "文档与索引", hint: "各方保留自己的知识库和向量索引", goals: ["retrieval"] },
  { id: "traces-skills", label: "轨迹与 Skill", hint: "各方提供 Agent 执行轨迹、经验卡或 Skill 包", goals: ["agent"] },
  { id: "trained-artifact", label: "已训练的 Agent Adapter", hint: "各方已有训练好的 Agent 适配器，交给平台聚合", goals: ["agent"] },
];

/* 1.3 数据关系。仅在各方投入为"本地数据"时出现。 */
export const PARTITIONS: readonly Choice[] = [
  { id: "horizontal", label: "横向", hint: "字段相同，样本不同" },
  { id: "vertical", label: "纵向", hint: "样本重叠，字段不同，需要样本对齐" },
];

/* 1.4 模型类别、1.5 共享方式。仅在训练模型时出现。 */
export const MODEL_CLASSES: readonly Choice[] = [
  { id: "neural", label: "神经网络", hint: "CNN、Transformer、大模型等" },
  { id: "tree", label: "树模型", hint: "GBDT、XGBoost 等" },
  { id: "linear", label: "线性模型", hint: "逻辑回归、线性回归" },
];

export const SHARING_MODES: readonly Choice[] = [
  { id: "full", label: "全量共享一个模型", hint: "所有参与方共同训练同一个模型" },
  { id: "peft", label: "参数高效 LoRA / Adapter", hint: "冻结预训练基座，只训练和交换小参数", adoption: "frontier" },
];

export type ScenarioGroup = "training" | "analysis" | "knowledge";

export const SCENARIO_GROUP_LABEL: Record<ScenarioGroup, string> = {
  training: "模型训练",
  analysis: "分析与评估",
  knowledge: "知识协作",
};

export type ScenarioId =
  | "model-training"
  | "peft-finetune"
  | "vertical-modeling"
  | "federated-evaluation"
  | "federated-analytics"
  | "fedrag"
  | "agent-skill";

export type InputKind = "nodes" | "files" | "endpoints";

export type ParamDefinition = {
  id: string;
  label: string;
  options: readonly { id: string; label: string }[];
  defaultValue: string;
  /** 只在这些策略下出现；缺省表示整个场景都适用。 */
  strategies?: readonly string[];
};

/** 场景判定只依赖子项 1.1–1.5，这里只列出需要的字段，避免与选择状态模块循环依赖。 */
export type ScenarioPath = {
  goal: string | null;
  contribution: string | null;
  partition: string | null;
  modelClass: string | null;
  sharing: string | null;
};

export type Scenario = {
  id: ScenarioId;
  label: string;
  group: ScenarioGroup;
  summary: string;
  adoption: Adoption;
  /** 子项 1.1–1.5 的组合是否落到这个场景。 */
  matches: (path: ScenarioPath) => boolean;
  /** 直接选场景时填好的子项默认值。 */
  shortcut: Partial<ScenarioPath>;
  pattern: (path: ScenarioPath) => ExecutionPattern;
  input: { kind: InputKind; label: string; accept?: string };
  evaluation: string;
  output: string;
  minParticipants: number;
  params: readonly ParamDefinition[];
};

const opts = (...pairs: [string, string][]) => pairs.map(([id, label]) => ({ id, label }));

const ROUNDS: ParamDefinition = {
  id: "rounds",
  label: "联邦轮次",
  options: opts(["10", "10 轮"], ["20", "20 轮"], ["50", "50 轮"]),
  defaultValue: "20",
};

const LOCAL_EPOCHS: ParamDefinition = {
  id: "local-epochs",
  label: "每轮本地训练",
  options: opts(["1", "1 epoch"], ["2", "2 epochs"], ["5", "5 epochs"]),
  defaultValue: "1",
};

const localTraining = (path: ScenarioPath, partition: string, sharing?: string) => (
  path.goal === "train"
  && path.contribution === "local-data"
  && path.partition === partition
  && (sharing === undefined || path.sharing === sharing)
);

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "model-training",
    label: "模型联合训练",
    group: "training",
    summary: "横向数据上共同训练一个全局模型。",
    adoption: "mainstream",
    matches: (path) => localTraining(path, "horizontal", "full"),
    shortcut: { goal: "train", contribution: "local-data", partition: "horizontal", modelClass: "neural", sharing: "full" },
    pattern: () => "iterative",
    input: { kind: "nodes", label: "连接参与节点并提交数据契约" },
    evaluation: "跨站点验证 + 全局验证集",
    output: "全局模型",
    minParticipants: 2,
    params: [
      { id: "task", label: "训练任务", options: opts(["classification", "分类"], ["regression", "回归"]), defaultValue: "classification" },
      ROUNDS,
      LOCAL_EPOCHS,
    ],
  },
  {
    id: "peft-finetune",
    label: "LoRA / Adapter 联邦微调",
    group: "training",
    summary: "同一预训练基座上，各方本地训练 LoRA，多轮聚合适配器。",
    adoption: "frontier",
    matches: (path) => localTraining(path, "horizontal", "peft"),
    shortcut: { goal: "train", contribution: "local-data", partition: "horizontal", modelClass: "neural", sharing: "peft" },
    pattern: () => "iterative",
    input: { kind: "nodes", label: "连接参与节点并提交指令数据契约" },
    evaluation: "各方本地评估 + 公共测试集回归检查",
    output: "全局 LoRA Adapter",
    minParticipants: 2,
    params: [
      { id: "base-model", label: "基础模型", options: opts(["qwen-2.5-1.5b", "Qwen 2.5 1.5B Instruct"], ["llama-3.2-3b", "Llama 3.2 3B Instruct"]), defaultValue: "qwen-2.5-1.5b" },
      { id: "rank", label: "LoRA Rank", options: opts(["8", "8"], ["16", "16"]), defaultValue: "16" },
      { ...ROUNDS, defaultValue: "10" },
      LOCAL_EPOCHS,
    ],
  },
  {
    id: "vertical-modeling",
    label: "纵向联合建模",
    group: "training",
    summary: "同一批样本、不同字段，先做样本对齐，再在加密协议下联合建模。",
    adoption: "mainstream",
    matches: (path) => localTraining(path, "vertical"),
    shortcut: { goal: "train", contribution: "local-data", partition: "vertical", modelClass: "tree" },
    pattern: () => "vertical-protocol",
    input: { kind: "nodes", label: "连接 Guest / Host 节点并提交数据契约与 PSI key manifest" },
    evaluation: "联邦验证集（由标签方计算）",
    output: "按参与方分片保存的联合模型",
    minParticipants: 2,
    params: [
      { id: "psi", label: "样本对齐 PSI", options: opts(["ecdh-psi", "ECDH PSI"]), defaultValue: "ecdh-psi" },
      { id: "iterations", label: "迭代次数 / 树数量", options: opts(["50", "50"]), defaultValue: "50" },
    ],
  },
  {
    id: "federated-evaluation",
    label: "联邦评估",
    group: "analysis",
    summary: "不训练，把模型下发到各方，在本地数据上评测后汇总指标。",
    adoption: "mainstream",
    matches: (path) => path.goal === "evaluate" && path.contribution === "local-test-data",
    shortcut: { goal: "evaluate", contribution: "local-test-data" },
    pattern: () => "evaluation-only",
    input: { kind: "nodes", label: "连接评测节点" },
    evaluation: "评测本身即产出，发布前检查报告完整性",
    output: "评估报告",
    minParticipants: 2,
    params: [],
  },
  {
    id: "federated-analytics",
    label: "联邦统计分析",
    group: "analysis",
    summary: "各方本地计算统计量，只汇总聚合结果。",
    adoption: "mainstream",
    matches: (path) => path.goal === "analytics" && path.contribution === "local-data" && path.partition === "horizontal",
    shortcut: { goal: "analytics", contribution: "local-data", partition: "horizontal" },
    pattern: () => "single-round",
    input: { kind: "nodes", label: "连接参与节点并提交分析 schema" },
    evaluation: "一致性检查 + 最小分组检查",
    output: "聚合统计报告",
    minParticipants: 2,
    params: [],
  },
  {
    id: "fedrag",
    label: "联邦检索 FedRAG",
    group: "knowledge",
    summary: "查询下发到各方，本地检索后在平台融合结果并生成回答。",
    adoption: "frontier",
    matches: (path) => path.goal === "retrieval" && path.contribution === "documents-index",
    shortcut: { goal: "retrieval", contribution: "documents-index" },
    pattern: () => "query-time",
    input: { kind: "endpoints", label: "注册各方检索 Endpoint 与索引声明" },
    evaluation: "检索召回 + 答案质量",
    output: "联邦问答服务",
    minParticipants: 2,
    params: [
      { id: "top-k", label: "每站返回", options: opts(["8", "Top 8"]), defaultValue: "8" },
    ],
  },
  {
    id: "agent-skill",
    label: "Agent / Skill 协作",
    group: "knowledge",
    summary: "合并各方的经验、技能或 Agent 适配器，并在沙箱里回放验证。",
    adoption: "frontier",
    matches: (path) => path.goal === "agent" && path.contribution !== null,
    shortcut: { goal: "agent", contribution: "traces-skills" },
    pattern: () => "artifact-processing",
    input: { kind: "files", label: "上传 Skill 包、经验卡或 Agent Adapter", accept: ".zip,.json,.jsonl,.md,.yaml,.yml,.safetensors" },
    evaluation: "沙箱回放 + 有害条目检查",
    output: "版本化 Skill 包",
    minParticipants: 2,
    params: [],
  },
];

export function scenarioOf(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

export function matchScenario(path: ScenarioPath): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.matches(path));
}

/* 维度 3：安全与隐私。内置保护随策略自动带上；可选增强只列 runner 实际提供的。 */
export type EnhancementId = "secagg" | "dp" | "he" | "tee";

export type Enhancement = Choice & {
  id: EnhancementId;
  mechanisms: readonly string[];
  /** 选中后在准入中提示的注意事项。 */
  caution?: string;
};

export const ENHANCEMENTS: readonly Enhancement[] = [
  { id: "secagg", label: "安全聚合 SecAgg+", hint: "协调方只能看到聚合结果，看不到单个参与方的更新（至少 3 方）", mechanisms: ["SecAgg+"] },
  {
    id: "dp",
    label: "差分隐私",
    hint: "裁剪各方更新并在聚合结果上加噪，限制单个样本的影响",
    mechanisms: ["中心化差分隐私"],
    caution: "参与方较少时，差分隐私噪声对精度的影响会比较明显",
  },
  { id: "he", label: "同态加密 CKKS", hint: "各方加密梯度直方图，协调方在密文上聚合", mechanisms: ["CKKS 同态加密"], caution: "同态加密会增加计算和通信耗时" },
  { id: "tee", label: "可信执行 TEE", hint: "结果融合与回答生成在经过远程证明的 TEE 中完成", mechanisms: ["TEE", "远程证明"], caution: "需要协调方节点具备 TEE 硬件" },
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
  /** 节点之间实际交换的对象（联邦对象，由平台推导展示）。 */
  exchanged: string;
  runner: string;
  references: readonly string[];
  /** 协议自带、不能关闭的保护（除基础保护外）。 */
  builtin?: readonly string[];
  /** 该策略所在 runner 实际提供的可选增强。 */
  enhancements?: readonly EnhancementId[];
  /** 只对某种各方投入有意义；不符合时不可选。 */
  contributions?: readonly string[];
  /** 需要的模型类别；不符合时置灰。 */
  modelClasses?: readonly string[];
  blockedReason?: string;
};

const NN_OR_LINEAR = ["neural", "linear"];
const NO_TREE = "树模型没有可以平均的连续参数，请选择直方图聚合";

export const STRATEGIES: readonly Strategy[] = [
  { id: "train-fedavg", label: "FedAvg", hint: "按样本量加权平均模型参数，最常用的基线", scenario: "model-training", adoption: "mainstream", computeKind: "additive", exchanged: "模型参数增量", runner: "Flower", references: ["Flower", "NVFlare"], enhancements: ["secagg", "dp"], modelClasses: NN_OR_LINEAR, blockedReason: NO_TREE },
  { id: "train-fedprox", label: "FedProx", hint: "本地目标加近端项，适合各方数据差异大", scenario: "model-training", adoption: "mainstream", computeKind: "additive", exchanged: "模型参数增量", runner: "Flower", references: ["Flower", "NVFlare"], enhancements: ["secagg", "dp"], modelClasses: NN_OR_LINEAR, blockedReason: NO_TREE },
  { id: "train-xgb-histogram", label: "XGBoost 直方图聚合", hint: "各方上传梯度直方图，协调方统一分裂", scenario: "model-training", adoption: "mainstream", computeKind: "additive", exchanged: "梯度直方图", runner: "NVFlare", references: ["NVFlare"], enhancements: ["he"], modelClasses: ["tree"], blockedReason: "只适用于树模型" },

  { id: "peft-fedavg", label: "FedAvg", hint: "按样本量加权平均各方 LoRA 增量", scenario: "peft-finetune", adoption: "frontier", computeKind: "additive", exchanged: "LoRA 增量", runner: "Flower", references: ["Flower FlowerTune"], enhancements: ["secagg", "dp"] },

  { id: "vfl-hetero-lr", label: "Hetero LR", hint: "纵向逻辑回归，加密交换梯度", scenario: "vertical-modeling", adoption: "mainstream", computeKind: "protocol", exchanged: "加密梯度与中间结果", runner: "FATE", references: ["FATE"], builtin: ["Paillier 同态加密", "ECDH PSI"], modelClasses: ["linear"], blockedReason: "只适用于线性模型" },
  { id: "vfl-secureboost", label: "SecureBoost", hint: "纵向梯度提升树，加密梯度求分裂增益", scenario: "vertical-modeling", adoption: "mainstream", computeKind: "protocol", exchanged: "加密梯度与分裂统计", runner: "FATE", references: ["FATE"], builtin: ["Paillier 同态加密", "ECDH PSI"], modelClasses: ["tree"], blockedReason: "只适用于树模型" },

  { id: "eval-local-aggregate", label: "本地评估 + 指标聚合", hint: "模型下发到各站，本地评测后汇总指标", scenario: "federated-evaluation", adoption: "mainstream", computeKind: "additive", exchanged: "评测指标", runner: "Flower", references: ["Flower", "NVFlare"], builtin: ["只回传聚合指标"] },

  { id: "fa-basic-stats", label: "计数 / 求和 / 均值方差", hint: "各方本地计算，只汇总可加统计量", scenario: "federated-analytics", adoption: "mainstream", computeKind: "additive", exchanged: "局部统计量", runner: "NVFlare", references: ["NVFlare"], builtin: ["最小计数阈值", "统计值加噪"] },
  { id: "fa-histogram", label: "直方图 / 分位数", hint: "统一分箱后汇总计数", scenario: "federated-analytics", adoption: "mainstream", computeKind: "additive", exchanged: "分箱计数", runner: "NVFlare", references: ["NVFlare"], builtin: ["最小计数阈值", "分箱数上限", "统计值加噪"] },

  { id: "rag-rrf", label: "Reciprocal Rank Fusion", hint: "只用排名融合，不依赖分数尺度", scenario: "fedrag", adoption: "frontier", computeKind: "compare", exchanged: "检索片段与排名", runner: "Flower + RAG worker", references: ["Flower FedRAG 示例"], enhancements: ["tee"] },
  { id: "rag-central-rerank", label: "集中重排", hint: "平台用重排模型对各站候选统一排序", scenario: "fedrag", adoption: "frontier", computeKind: "content", exchanged: "候选片段全文", runner: "Flower + RAG worker", references: ["Flower FedRAG 示例"], enhancements: ["tee"] },

  { id: "skill-dedup", label: "去重合并", hint: "按签名去重、按语义分组、按效果过滤后合并", scenario: "agent-skill", adoption: "frontier", computeKind: "content", exchanged: "经验卡 / Skill 条目", runner: "自定义沙箱 runner", references: ["自定义"], contributions: ["traces-skills"] },
  { id: "skill-arbitration", label: "冲突仲裁合并", hint: "冲突条目交由 Agent 审阅或投票决定", scenario: "agent-skill", adoption: "frontier", computeKind: "content", exchanged: "经验卡 / Skill 条目", runner: "自定义沙箱 runner", references: ["自定义"], contributions: ["traces-skills"] },
  { id: "skill-trace-distill", label: "轨迹蒸馏", hint: "把各方成功轨迹蒸馏为公共 Skill", scenario: "agent-skill", adoption: "frontier", computeKind: "content", exchanged: "脱敏执行轨迹", runner: "自定义沙箱 runner", references: ["自定义"], contributions: ["traces-skills"] },
  { id: "skill-adapter-merge", label: "Agent Adapter 聚合", hint: "对各方 Agent 的 Adapter 加权平均", scenario: "agent-skill", adoption: "frontier", computeKind: "additive", exchanged: "Agent Adapter", runner: "mergekit", references: ["mergekit"], contributions: ["trained-artifact"] },
];

export function strategyOf(id: string | null): Strategy | undefined {
  return id ? STRATEGIES.find((strategy) => strategy.id === id) : undefined;
}

export type Availability = { available: boolean; reason?: string; warning?: string };
