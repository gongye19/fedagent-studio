/**
 * 联邦协作的分层维度与候选项注册表。
 *
 * 维度 1 是场景，子项按"用户最先能回答的问题"排序：1.1 协作目标 → 1.2 各方投入 → 1.3 数据关系 →
 * 1.4 参与方形态 → 1.5 模型类别 → 1.6 共享方式；之后是维度 2 协作策略、维度 3 安全与信任、
 * 维度 4 场景参数。只有前面的约束后面的。完整设计见 docs/DIMENSIONS.md。
 *
 * 收录原则：只保留主流、实际用得多的方法；小众方法即使成熟也不收录；
 * 大模型 / Agent 相关、仍在快速演进的方法保留，内部标为 frontier（界面不显示）。
 */

export type Adoption = "mainstream" | "frontier";

export const ADOPTION_LABEL: Record<Adoption, string> = {
  mainstream: "主流",
  frontier: "前沿",
};

/** 场景和策略里只要有一个是前沿，整体就是前沿。 */
export function combinedAdoption(...levels: Adoption[]): Adoption {
  return levels.includes("frontier") ? "frontier" : "mainstream";
}

/** 协作策略在数学上做的是哪类计算。保护机制能不能配它，由这个字段推出。 */
export type ComputeKind = "additive" | "compare" | "compose" | "protocol" | "content";

export const COMPUTE_KIND_LABEL: Record<ComputeKind, string> = {
  additive: "可加（求和 / 加权平均）",
  compare: "需比较大小（排序、投票、裁剪）",
  compose: "拼接组合（需要明文结构）",
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
  { id: "train", label: "训练模型", hint: "共同得到一个或多个模型" },
  { id: "evaluate", label: "评估模型", hint: "在多方数据或基准上验证已有模型" },
  { id: "analytics", label: "统计分析", hint: "联合计算统计量，不训练模型" },
  { id: "retrieval", label: "检索增强问答", hint: "跨多方知识库检索并回答", adoption: "frontier" },
  { id: "agent", label: "Agent 与技能协作", hint: "共享轨迹、技能或 Agent 策略", adoption: "frontier" },
];

/* 1.2 各方投入。回答"每个参与方拿出来的是什么"，决定输入接入方式和执行模式。 */
export const CONTRIBUTIONS: readonly (Choice & { goals: readonly GoalId[] })[] = [
  { id: "local-data", label: "本地数据（不出域）", hint: "数据留在各方环境，只交换计算结果", goals: ["train", "analytics"] },
  { id: "trained-artifact", label: "已训练的模型或 Adapter", hint: "各方已有训练好的产物，交给平台聚合", goals: ["train", "agent"] },
  { id: "local-test-data", label: "本地测试数据", hint: "待评模型下发到各方，在本地数据上评测", goals: ["evaluate"] },
  { id: "model-endpoint", label: "模型服务 Endpoint", hint: "各方提供模型接口，在统一基准上评测", goals: ["evaluate"] },
  { id: "documents-index", label: "文档与索引", hint: "各方保留自己的知识库和向量索引", goals: ["retrieval"] },
  { id: "traces-skills", label: "轨迹与 Skill", hint: "各方提供 Agent 执行轨迹、经验卡或 Skill 包", goals: ["agent"] },
];

/* 1.3 数据关系。仅在各方投入为"本地数据"时出现。 */
export const PARTITIONS: readonly Choice[] = [
  { id: "horizontal", label: "横向", hint: "字段相同，样本不同" },
  { id: "vertical", label: "纵向", hint: "样本重叠，字段不同，需要样本对齐" },
];

/* 1.4 参与方形态 */
export const TOPOLOGIES: readonly Choice[] = [
  { id: "cross-silo", label: "跨机构 Cross-silo", hint: "2 到几十个稳定在线的机构节点" },
  { id: "cross-device", label: "端侧设备 Cross-device", hint: "大量设备，随时可能离线" },
];

/* 1.5 模型类别、1.6 共享方式。仅在训练模型时出现。 */
export const MODEL_CLASSES: readonly Choice[] = [
  { id: "neural", label: "神经网络", hint: "CNN、Transformer、大模型等" },
  { id: "tree", label: "树模型", hint: "GBDT、XGBoost 等" },
  { id: "linear", label: "线性模型", hint: "逻辑回归、线性回归" },
];

export const SHARING_MODES: readonly Choice[] = [
  { id: "full", label: "全量共享一个模型", hint: "所有参与方共同训练同一个模型" },
  { id: "peft", label: "参数高效 LoRA / Adapter", hint: "冻结预训练基座，只训练和交换小参数", adoption: "frontier" },
];

/** 各方投入为"已训练产物"时，共享方式这一问改为产物类型。 */
export const ARTIFACT_KINDS: readonly Choice[] = [
  { id: "full-weights", label: "全量模型权重", hint: "同一基座上微调得到的完整模型" },
  { id: "adapter", label: "LoRA / Adapter", hint: "同一基座上训练得到的适配器" },
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
  | "model-merge"
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

/** 场景判定只依赖子项 1.1–1.6，这里只列出需要的字段，避免与选择状态模块循环依赖。 */
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
  /** 子项 1.1–1.6 的组合是否落到这个场景。 */
  matches: (path: ScenarioPath) => boolean;
  /** 直接选场景时填好的子项默认值。 */
  shortcut: Partial<ScenarioPath> & { topology: string };
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

const BASE_MODELS = opts(
  ["qwen-2.5-1.5b", "Qwen 2.5 1.5B Instruct"],
  ["llama-3.2-3b", "Llama 3.2 3B Instruct"],
  ["gemma-3-4b", "Gemma 3 4B IT"],
);

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
    shortcut: { goal: "train", contribution: "local-data", partition: "horizontal", topology: "cross-silo", modelClass: "neural", sharing: "full" },
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
    shortcut: { goal: "train", contribution: "local-data", partition: "horizontal", topology: "cross-silo", modelClass: "neural", sharing: "peft" },
    pattern: () => "iterative",
    input: { kind: "nodes", label: "连接参与节点并提交指令数据契约" },
    evaluation: "各方本地评估 + 公共测试集回归检查",
    output: "全局 LoRA Adapter",
    minParticipants: 2,
    params: [
      { id: "base-model", label: "基础模型", options: BASE_MODELS, defaultValue: "qwen-2.5-1.5b" },
      { id: "adapter", label: "适配器", options: opts(["lora", "LoRA"], ["qlora", "QLoRA（4-bit 基座）"]), defaultValue: "lora" },
      { id: "rank", label: "LoRA Rank", options: opts(["8", "8"], ["16", "16"], ["32", "32"]), defaultValue: "16" },
      { id: "target-modules", label: "Target modules", options: opts(["qv", "q_proj, v_proj"], ["all-linear", "全部线性层"]), defaultValue: "qv" },
      { ...ROUNDS, defaultValue: "10" },
      LOCAL_EPOCHS,
    ],
  },
  {
    id: "model-merge",
    label: "模型与 Adapter 聚合",
    group: "training",
    summary: "各方上传同一基座上已训练好的模型或 Adapter，平台一次性合并。",
    adoption: "frontier",
    matches: (path) => path.goal === "train" && path.contribution === "trained-artifact",
    shortcut: { goal: "train", contribution: "trained-artifact", topology: "cross-silo", sharing: "adapter" },
    pattern: () => "artifact-processing",
    input: { kind: "files", label: "上传产物文件到隔离 staging", accept: ".safetensors,.bin,.zip,.json" },
    evaluation: "各领域测试集 + 基线回归检查",
    output: "合并后的模型或 Adapter",
    minParticipants: 2,
    params: [
      { id: "base-model", label: "统一基座", options: BASE_MODELS, defaultValue: "llama-3.2-3b" },
      { id: "weighting", label: "权重来源", options: opts(["samples", "按样本数"], ["uniform", "均等"], ["validation", "按验证分"]), defaultValue: "samples" },
      {
        id: "density",
        label: "保留比例",
        options: opts(["0.2", "20%"], ["0.5", "50%"], ["0.8", "80%"]),
        defaultValue: "0.5",
        strategies: ["merge-ties", "merge-dare"],
      },
    ],
  },
  {
    id: "vertical-modeling",
    label: "纵向联合建模",
    group: "training",
    summary: "同一批样本、不同字段，先做样本对齐，再在加密协议下联合建模。",
    adoption: "mainstream",
    matches: (path) => localTraining(path, "vertical"),
    shortcut: { goal: "train", contribution: "local-data", partition: "vertical", topology: "cross-silo", modelClass: "tree" },
    pattern: () => "vertical-protocol",
    input: { kind: "nodes", label: "连接 Guest / Host 节点并提交数据契约与 PSI key manifest" },
    evaluation: "联邦验证集（由标签方计算）",
    output: "按参与方分片保存的联合模型",
    minParticipants: 2,
    params: [
      { id: "entity-key", label: "实体对齐键", options: opts(["hashed-id", "哈希用户 ID"], ["phone-hash", "手机号哈希"], ["custom-key", "自定义主键"]), defaultValue: "hashed-id" },
      { id: "psi", label: "样本对齐 PSI", options: opts(["ecdh-psi", "ECDH PSI"], ["rsa-psi", "RSA PSI"]), defaultValue: "ecdh-psi" },
      { id: "iterations", label: "迭代次数 / 树数量", options: opts(["20", "20"], ["50", "50"], ["100", "100"]), defaultValue: "50" },
    ],
  },
  {
    id: "federated-evaluation",
    label: "联邦评估",
    group: "analysis",
    summary: "不训练，只在多方数据或统一基准上验证模型。",
    adoption: "mainstream",
    matches: (path) => path.goal === "evaluate" && path.contribution !== null,
    shortcut: { goal: "evaluate", contribution: "local-test-data", topology: "cross-silo" },
    pattern: () => "evaluation-only",
    input: { kind: "nodes", label: "连接评测节点或注册模型 Endpoint" },
    evaluation: "评测本身即产出，发布前检查报告完整性",
    output: "评估报告",
    minParticipants: 2,
    params: [
      { id: "suite", label: "评测套件", options: opts(["task", "任务指标"], ["safety", "安全与合规"], ["custom", "自定义套件"]), defaultValue: "task" },
      { id: "report", label: "报告粒度", options: opts(["aggregate", "只报告聚合指标"], ["per-site", "按站点报告"]), defaultValue: "aggregate" },
    ],
  },
  {
    id: "federated-analytics",
    label: "联邦统计分析",
    group: "analysis",
    summary: "各方本地计算统计量，只汇总聚合结果。",
    adoption: "mainstream",
    matches: (path) => path.goal === "analytics" && path.contribution === "local-data" && (path.partition === "horizontal" || path.partition === "vertical"),
    shortcut: { goal: "analytics", contribution: "local-data", partition: "horizontal", topology: "cross-silo" },
    pattern: (path) => (path.partition === "vertical" ? "vertical-protocol" : "single-round"),
    input: { kind: "nodes", label: "连接参与节点并提交分析 schema" },
    evaluation: "一致性检查 + 最小分组检查",
    output: "聚合统计报告",
    minParticipants: 2,
    params: [
      { id: "clipping", label: "数值裁剪", options: opts(["auto", "自动估计范围"], ["bounded", "固定范围"], ["none", "不裁剪"]), defaultValue: "auto" },
      { id: "min-group", label: "最小分组大小", options: opts(["5", "5"], ["10", "10"], ["20", "20"]), defaultValue: "10" },
    ],
  },
  {
    id: "fedrag",
    label: "联邦检索 FedRAG",
    group: "knowledge",
    summary: "查询下发到各方，本地检索后在平台融合结果并生成回答。",
    adoption: "frontier",
    matches: (path) => path.goal === "retrieval" && path.contribution === "documents-index",
    shortcut: { goal: "retrieval", contribution: "documents-index", topology: "cross-silo" },
    pattern: () => "query-time",
    input: { kind: "endpoints", label: "注册各方检索 Endpoint 与索引声明" },
    evaluation: "检索召回 + 答案质量",
    output: "联邦问答服务",
    minParticipants: 2,
    params: [
      { id: "embedding", label: "Embedding 模型", options: opts(["bge-m3", "BGE-M3"], ["e5-large", "E5 Large"], ["site-owned", "各站自有模型"]), defaultValue: "bge-m3" },
      { id: "index", label: "本地索引", options: opts(["faiss", "FAISS"], ["qdrant", "Qdrant"], ["milvus", "Milvus"]), defaultValue: "faiss" },
      { id: "top-k", label: "每站返回", options: opts(["4", "Top 4"], ["8", "Top 8"], ["16", "Top 16"]), defaultValue: "8" },
      { id: "return-content", label: "返回内容", options: opts(["snippets", "脱敏文本片段"], ["scores", "仅分数与引用"]), defaultValue: "snippets" },
    ],
  },
  {
    id: "agent-skill",
    label: "Agent / Skill 协作",
    group: "knowledge",
    summary: "合并各方的经验、技能或 Agent 适配器，并在沙箱里回放验证。",
    adoption: "frontier",
    matches: (path) => path.goal === "agent" && path.contribution !== null,
    shortcut: { goal: "agent", contribution: "traces-skills", topology: "cross-silo" },
    pattern: () => "artifact-processing",
    input: { kind: "files", label: "上传 Skill 包、经验卡或 Agent Adapter", accept: ".zip,.json,.jsonl,.md,.yaml,.yml,.safetensors" },
    evaluation: "沙箱回放 + 有害条目检查",
    output: "版本化 Skill 包",
    minParticipants: 2,
    params: [
      {
        id: "conflict",
        label: "冲突处理",
        options: opts(["agent-review", "Agent 审阅"], ["vote", "参与方投票"], ["benchmark", "按回放分数"]),
        defaultValue: "agent-review",
        strategies: ["skill-dedup", "skill-arbitration"],
      },
      { id: "validation", label: "效果验证", options: opts(["replay", "沙箱回放"], ["judge", "LLM Judge"], ["human", "人工审核"]), defaultValue: "replay" },
    ],
  },
];

export function scenarioOf(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

export function matchScenario(path: ScenarioPath): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.matches(path));
}

/* 维度 2：协作策略。每条带收录类别、计算类型、联邦对象和参考开源实现。 */
export type Strategy = Choice & {
  scenario: ScenarioId;
  adoption: Adoption;
  computeKind: ComputeKind;
  /** 节点之间实际交换的对象（联邦对象，由平台推导展示）。 */
  exchanged: string;
  runner: string;
  references: readonly string[];
  /** 只对某种各方投入有意义；不符合时不可选。 */
  contributions?: readonly string[];
  /** 需要的模型类别；不符合时置灰。 */
  modelClasses?: readonly string[];
  /** 需要的数据关系；不符合时置灰。 */
  partitions?: readonly string[];
  blockedReason?: string;
  /** 在某些参与方形态下可用但需要提醒。 */
  topologyWarnings?: Readonly<Record<string, string>>;
};

const NN_OR_LINEAR = ["neural", "linear"];
const NO_TREE = "树模型没有可以平均的连续参数，请选择直方图聚合";

export const STRATEGIES: readonly Strategy[] = [
  { id: "train-fedavg", label: "FedAvg", hint: "按样本量加权平均模型参数，最常用的基线", scenario: "model-training", adoption: "mainstream", computeKind: "additive", exchanged: "模型参数增量", runner: "Flower", references: ["Flower", "NVFlare"], modelClasses: NN_OR_LINEAR, blockedReason: NO_TREE },
  { id: "train-fedprox", label: "FedProx", hint: "本地目标加近端项，适合非 IID 和算力不均", scenario: "model-training", adoption: "mainstream", computeKind: "additive", exchanged: "模型参数增量", runner: "Flower", references: ["Flower", "NVFlare"], modelClasses: NN_OR_LINEAR, blockedReason: NO_TREE },
  { id: "train-fedopt", label: "FedAdam / FedYogi", hint: "服务器端使用自适应优化器更新全局模型", scenario: "model-training", adoption: "mainstream", computeKind: "additive", exchanged: "模型参数增量", runner: "Flower", references: ["Flower", "NVFlare"], modelClasses: NN_OR_LINEAR, blockedReason: NO_TREE },
  { id: "train-xgb-histogram", label: "直方图聚合 XGBoost", hint: "各方上传梯度直方图，协调方统一分裂", scenario: "model-training", adoption: "mainstream", computeKind: "additive", exchanged: "梯度直方图", runner: "NVFlare", references: ["NVFlare", "Flower"], modelClasses: ["tree"], blockedReason: "只适用于树模型" },

  { id: "peft-fedavg", label: "FedAvg", hint: "按样本量加权平均各方 LoRA 增量", scenario: "peft-finetune", adoption: "frontier", computeKind: "additive", exchanged: "LoRA 增量", runner: "Flower", references: ["Flower FlowerTune", "FATE-LLM"] },
  { id: "peft-fedprox", label: "FedProx", hint: "限制本地 LoRA 偏离全局，适合数据差异大", scenario: "peft-finetune", adoption: "frontier", computeKind: "additive", exchanged: "LoRA 增量", runner: "Flower", references: ["Flower FlowerTune"] },

  { id: "merge-weighted", label: "加权平均", hint: "按权重对各方参数求加权和，最稳妥的基线", scenario: "model-merge", adoption: "frontier", computeKind: "additive", exchanged: "已训练权重 / Adapter", runner: "mergekit", references: ["mergekit"] },
  { id: "merge-ties", label: "TIES-Merging", hint: "裁掉小改动，按符号投票后合并", scenario: "model-merge", adoption: "frontier", computeKind: "compare", exchanged: "已训练权重 / Adapter", runner: "mergekit", references: ["mergekit"] },
  { id: "merge-dare", label: "DARE", hint: "随机丢弃增量再按比例放大，丢弃与取值无关", scenario: "model-merge", adoption: "frontier", computeKind: "additive", exchanged: "已训练权重 / Adapter", runner: "mergekit", references: ["mergekit"] },

  { id: "vfl-hetero-lr", label: "Hetero LR", hint: "纵向逻辑回归，加密交换梯度", scenario: "vertical-modeling", adoption: "mainstream", computeKind: "protocol", exchanged: "加密梯度与中间结果", runner: "FATE", references: ["FATE"], modelClasses: ["linear"], blockedReason: "只适用于线性模型" },
  { id: "vfl-secureboost", label: "SecureBoost", hint: "纵向梯度提升树，加密梯度求分裂增益", scenario: "vertical-modeling", adoption: "mainstream", computeKind: "protocol", exchanged: "加密梯度与分裂统计", runner: "FATE", references: ["FATE"], modelClasses: ["tree"], blockedReason: "只适用于树模型" },

  { id: "eval-local-aggregate", label: "本地评估 + 指标聚合", hint: "模型下发到各站，本地评测后汇总指标", scenario: "federated-evaluation", adoption: "mainstream", computeKind: "additive", exchanged: "评测指标", runner: "Flower", references: ["Flower", "NVFlare"], contributions: ["local-test-data"] },
  { id: "eval-cross-site", label: "跨站点交叉验证", hint: "每个站点的模型在其他站点数据上评测", scenario: "federated-evaluation", adoption: "mainstream", computeKind: "additive", exchanged: "评测指标矩阵", runner: "NVFlare", references: ["NVFlare"], contributions: ["local-test-data"] },
  { id: "eval-benchmark", label: "统一基准评测", hint: "平台用统一基准调用各方 Endpoint", scenario: "federated-evaluation", adoption: "mainstream", computeKind: "compose", exchanged: "基准题目与模型输出", runner: "自定义评测 runner", references: ["lm-evaluation-harness"], contributions: ["model-endpoint"] },

  { id: "fa-secure-sum", label: "计数 / 求和 / 均值方差", hint: "各方本地计算，只汇总可加统计量", scenario: "federated-analytics", adoption: "mainstream", computeKind: "additive", exchanged: "局部统计量", runner: "NVFlare", references: ["NVFlare", "Flower"], partitions: ["horizontal"] },
  { id: "fa-histogram", label: "直方图 / 分位数", hint: "统一分箱后汇总计数", scenario: "federated-analytics", adoption: "mainstream", computeKind: "additive", exchanged: "分箱计数", runner: "NVFlare", references: ["NVFlare"], partitions: ["horizontal"] },
  { id: "fa-psi-stats", label: "PSI 交集统计", hint: "对齐共同样本后，跨字段计算联合统计", scenario: "federated-analytics", adoption: "mainstream", computeKind: "protocol", exchanged: "加密交集与统计量", runner: "FATE", references: ["FATE"], partitions: ["vertical"] },

  { id: "rag-rrf", label: "Reciprocal Rank Fusion", hint: "只用排名融合，不依赖分数尺度", scenario: "fedrag", adoption: "frontier", computeKind: "compare", exchanged: "检索片段与排名", runner: "Flower + RAG worker", references: ["Flower FedRAG 示例"] },
  { id: "rag-central-rerank", label: "集中重排", hint: "平台用重排模型对各站候选统一排序", scenario: "fedrag", adoption: "frontier", computeKind: "content", exchanged: "候选片段全文", runner: "Flower + RAG worker", references: ["Flower FedRAG 示例"] },

  { id: "skill-dedup", label: "去重合并", hint: "按签名去重、按语义分组、按效果过滤后合并", scenario: "agent-skill", adoption: "frontier", computeKind: "content", exchanged: "经验卡 / Skill 条目", runner: "自定义沙箱 runner", references: ["自定义"], contributions: ["traces-skills"] },
  { id: "skill-arbitration", label: "冲突仲裁合并", hint: "冲突条目交由 Agent 审阅或投票决定", scenario: "agent-skill", adoption: "frontier", computeKind: "content", exchanged: "经验卡 / Skill 条目", runner: "自定义沙箱 runner", references: ["自定义"], contributions: ["traces-skills"] },
  { id: "skill-trace-distill", label: "轨迹蒸馏", hint: "把各方成功轨迹蒸馏为公共 Skill", scenario: "agent-skill", adoption: "frontier", computeKind: "content", exchanged: "脱敏执行轨迹", runner: "自定义沙箱 runner", references: ["自定义"], contributions: ["traces-skills"] },
  { id: "skill-adapter-merge", label: "Agent Adapter 聚合", hint: "对各方 Agent 的 Adapter 加权平均", scenario: "agent-skill", adoption: "frontier", computeKind: "additive", exchanged: "Agent Adapter", runner: "mergekit", references: ["mergekit"], contributions: ["trained-artifact"] },
];

export function strategyOf(id: string | null): Strategy | undefined {
  return id ? STRATEGIES.find((strategy) => strategy.id === id) : undefined;
}

/* 维度 3：安全与信任。选一档保护预设，可用性由计算类型和 runner 能力判断。 */
export type ProtectionContext = {
  scenario: Scenario;
  strategy: Strategy;
  pattern: ExecutionPattern;
  topology: string;
};

export type Availability = { available: boolean; reason?: string; warning?: string };

export type Protection = Choice & {
  mechanisms: readonly string[];
  check: (context: ProtectionContext) => Availability;
};

const CANNOT_SUM = (strategy: Strategy) => `${strategy.label} 的计算类型是"${COMPUTE_KIND_LABEL[strategy.computeKind]}"，拿不到明文就无法计算`;

export const PROTECTIONS: readonly Protection[] = [
  {
    id: "standard",
    label: "基础保护",
    hint: "传输加密、隔离沙箱与审计，平台可见聚合输入",
    mechanisms: ["mTLS", "隔离沙箱", "审计日志"],
    check: ({ pattern }) => (pattern === "vertical-protocol"
      ? { available: false, reason: "纵向协议依赖加密交换中间结果，至少需要加密计算" }
      : { available: true }),
  },
  {
    id: "hide-updates",
    label: "隐藏单方更新",
    hint: "协调方只能看到聚合结果，看不到单个参与方（至少 3 方）",
    mechanisms: ["mTLS", "SecAgg+", "更新裁剪"],
    check: ({ strategy, pattern }) => {
      if (pattern === "vertical-protocol") return { available: false, reason: "纵向协议已内置加密交换，不使用 SecAgg 这一层" };
      if (strategy.computeKind !== "additive") return { available: false, reason: CANNOT_SUM(strategy) };
      return { available: true };
    },
  },
  {
    id: "sample-dp",
    label: "样本级隐私",
    hint: "限制任一样本对结果的影响，并记录隐私预算",
    mechanisms: ["差分隐私", "SecAgg+", "隐私预算记账"],
    check: ({ strategy, pattern, topology }) => {
      if (strategy.computeKind !== "additive") return { available: false, reason: CANNOT_SUM(strategy) };
      if (pattern === "artifact-processing") return { available: false, reason: "产物已在各方训练完成，样本级 DP 需要在训练过程中加入" };
      if (pattern === "vertical-protocol") return { available: false, reason: "当前纵向 runner（FATE）不提供样本级 DP" };
      return topology === "cross-silo"
        ? { available: true, warning: "跨机构参与方较少，DP 噪声对精度的影响会比较明显" }
        : { available: true };
    },
  },
  {
    id: "encrypted",
    label: "加密计算",
    hint: "在密文上完成聚合或协议计算",
    mechanisms: ["同态加密", "MPC / 秘密分享", "密钥服务"],
    check: ({ strategy }) => {
      if (strategy.computeKind === "protocol") return { available: true };
      if (strategy.computeKind !== "additive") return { available: false, reason: CANNOT_SUM(strategy) };
      return { available: true, warning: "同态加密会显著增加计算和通信耗时" };
    },
  },
  {
    id: "tee",
    label: "可信执行",
    hint: "协调方计算放进 TEE，并提供远程证明",
    mechanisms: ["TEE", "远程证明", "密封密钥"],
    check: ({ pattern, strategy }) => {
      if (pattern === "vertical-protocol") return { available: false, reason: `当前纵向 runner（${strategy.runner}）不提供 TEE 执行` };
      return { available: true, warning: "需要协调方节点具备 TEE 硬件，并在接入时完成远程证明" };
    },
  },
];

export function protectionOf(id: string | null): Protection | undefined {
  return id ? PROTECTIONS.find((protection) => protection.id === id) : undefined;
}
