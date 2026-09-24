/**
 * 前端产品配置模型。
 *
 * 工作负载先约束数据关系、参与拓扑、策略和保护目标，再加载方法专属参数；
 * runner、评测和输出由配置派生。当前为静态原型，后续应迁移到版本化 schema。
 */
export type SelectOption = {
  id: string;
  label: string;
};

export type SettingDefinition = {
  id: string;
  label: string;
  options: readonly SelectOption[];
  defaultValue: string;
};

export type WorkloadDefinition = {
  id: string;
  label: string;
  partitionIds: readonly string[];
  topologyIds: readonly string[];
  strategies: readonly SelectOption[];
  settings: readonly SettingDefinition[];
  artifact: string;
  runner: string;
  evaluation: string;
  output: string;
  inputLabel: string;
  inputAccept: string;
};

export type FederationConfiguration = {
  workloadId: string;
  partitionId: string;
  topologyId: string;
  strategyId: string;
  protectionId: string;
  settings: Record<string, string>;
};

export const PARTITIONS: readonly SelectOption[] = [
  { id: "horizontal", label: "横向联邦" },
  { id: "vertical", label: "纵向联邦" },
  { id: "hybrid", label: "混合联邦" },
  { id: "non-training", label: "无训练数据协作" },
];

export const TOPOLOGIES: readonly SelectOption[] = [
  { id: "cross-silo", label: "跨机构 Cross-silo" },
  { id: "cross-device", label: "端侧设备 Cross-device" },
  { id: "hybrid-nodes", label: "混合节点" },
  { id: "local-simulation", label: "本地模拟" },
];

export const PROTECTIONS = [
  {
    id: "standard",
    label: "基础保护",
    mechanisms: ["mTLS", "Sandbox", "Audit log"],
  },
  {
    id: "private-aggregate",
    label: "隐藏单方更新",
    mechanisms: ["mTLS", "SecAgg+", "Update clipping"],
  },
  {
    id: "formal-privacy",
    label: "样本级隐私",
    mechanisms: ["SecAgg+", "Differential privacy", "Privacy accounting"],
  },
  {
    id: "encrypted-compute",
    label: "加密计算",
    mechanisms: ["Homomorphic encryption", "MPC", "Key service"],
  },
  {
    id: "confidential-compute",
    label: "可信执行环境",
    mechanisms: ["TEE", "Remote attestation", "Sealed secrets"],
  },
  {
    id: "high-assurance",
    label: "高保证组合",
    mechanisms: ["mTLS", "SecAgg / HE", "TEE", "Strict audit"],
  },
] as const;

const COMMON_MODELS: readonly SelectOption[] = [
  { id: "qwen-2.5-1.5b", label: "Qwen 2.5 1.5B Instruct" },
  { id: "llama-3.2-3b", label: "Llama 3.2 3B Instruct" },
  { id: "gemma-3-4b", label: "Gemma 3 4B IT" },
];

export const WORKLOADS: readonly WorkloadDefinition[] = [
  {
    id: "model-training",
    label: "模型联合训练",
    partitionIds: ["horizontal", "hybrid"],
    topologyIds: ["cross-silo", "cross-device", "hybrid-nodes", "local-simulation"],
    strategies: [
      { id: "fedavg", label: "FedAvg" },
      { id: "fedprox", label: "FedProx" },
      { id: "fedadam", label: "FedAdam" },
      { id: "fedyogi", label: "FedYogi" },
      { id: "scaffold", label: "SCAFFOLD" },
    ],
    settings: [
      {
        id: "model-family",
        label: "模型框架",
        options: [
          { id: "pytorch", label: "PyTorch" },
          { id: "xgboost", label: "XGBoost" },
          { id: "sklearn", label: "scikit-learn" },
        ],
        defaultValue: "pytorch",
      },
      {
        id: "task-type",
        label: "训练任务",
        options: [
          { id: "classification", label: "分类" },
          { id: "regression", label: "回归" },
          { id: "language", label: "语言建模" },
        ],
        defaultValue: "classification",
      },
      {
        id: "rounds",
        label: "联邦轮次",
        options: [
          { id: "10", label: "10 rounds" },
          { id: "20", label: "20 rounds" },
          { id: "50", label: "50 rounds" },
        ],
        defaultValue: "20",
      },
    ],
    artifact: "Model delta",
    runner: "Flower",
    evaluation: "Cross-site validation",
    output: "Global model",
    inputLabel: "Local training package",
    inputAccept: ".zip,.json,.yaml,.yml",
  },
  {
    id: "peft",
    label: "LoRA / Adapter 联合微调",
    partitionIds: ["horizontal"],
    topologyIds: ["cross-silo", "cross-device", "local-simulation"],
    strategies: [
      { id: "fedavg", label: "FedAvg" },
      { id: "fedprox", label: "FedProx" },
      { id: "fedadam", label: "FedAdam" },
    ],
    settings: [
      { id: "base-model", label: "基础模型", options: COMMON_MODELS, defaultValue: "qwen-2.5-1.5b" },
      {
        id: "adapter-type",
        label: "适配器",
        options: [
          { id: "lora", label: "LoRA" },
          { id: "qlora", label: "QLoRA" },
          { id: "adapter", label: "Adapter" },
        ],
        defaultValue: "lora",
      },
      {
        id: "rank",
        label: "LoRA Rank",
        options: [
          { id: "8", label: "8" },
          { id: "16", label: "16" },
          { id: "32", label: "32" },
        ],
        defaultValue: "16",
      },
      {
        id: "local-epochs",
        label: "本地训练",
        options: [
          { id: "1", label: "1 epoch" },
          { id: "2", label: "2 epochs" },
          { id: "3", label: "3 epochs" },
        ],
        defaultValue: "1",
      },
    ],
    artifact: "LoRA adapter",
    runner: "Flower",
    evaluation: "Local evaluation + metric aggregation",
    output: "Global adapter",
    inputLabel: "Instruction dataset or adapter",
    inputAccept: ".json,.jsonl,.parquet,.safetensors,.zip",
  },
  {
    id: "vertical-modeling",
    label: "纵向联合建模",
    partitionIds: ["vertical", "hybrid"],
    topologyIds: ["cross-silo", "local-simulation"],
    strategies: [
      { id: "hetero-lr", label: "Hetero Logistic Regression" },
      { id: "secureboost", label: "SecureBoost" },
      { id: "hetero-nn", label: "Hetero Neural Network" },
    ],
    settings: [
      {
        id: "label-owner",
        label: "标签持有方",
        options: [
          { id: "guest", label: "Guest" },
          { id: "host", label: "Host" },
          { id: "both", label: "双方" },
        ],
        defaultValue: "guest",
      },
      {
        id: "entity-key",
        label: "实体对齐键",
        options: [
          { id: "hashed-id", label: "Hashed user ID" },
          { id: "private-id", label: "Private ID" },
          { id: "custom-key", label: "自定义主键" },
        ],
        defaultValue: "hashed-id",
      },
      {
        id: "psi",
        label: "样本对齐",
        options: [
          { id: "ecdh-psi", label: "ECDH PSI" },
          { id: "rsa-psi", label: "RSA PSI" },
          { id: "oprf-psi", label: "OPRF PSI" },
        ],
        defaultValue: "ecdh-psi",
      },
    ],
    artifact: "Encrypted intermediate values",
    runner: "FATE",
    evaluation: "Federated validation",
    output: "Joint model",
    inputLabel: "Tabular data contract",
    inputAccept: ".csv,.parquet,.json",
  },
  {
    id: "federated-evaluation",
    label: "联邦评估",
    partitionIds: ["horizontal", "vertical", "hybrid", "non-training"],
    topologyIds: ["cross-silo", "cross-device", "hybrid-nodes", "local-simulation"],
    strategies: [
      { id: "metric-aggregation", label: "指标聚合" },
      { id: "cross-site", label: "跨站点评估" },
      { id: "private-metrics", label: "隐私聚合评估" },
    ],
    settings: [
      {
        id: "artifact-type",
        label: "待评测对象",
        options: [
          { id: "model", label: "完整模型" },
          { id: "adapter", label: "LoRA / Adapter" },
          { id: "endpoint", label: "推理 Endpoint" },
        ],
        defaultValue: "model",
      },
      {
        id: "evaluation-location",
        label: "评测位置",
        options: [
          { id: "local", label: "参与方本地" },
          { id: "public", label: "公共测试集" },
          { id: "cross-site", label: "跨站点" },
        ],
        defaultValue: "local",
      },
      {
        id: "suite",
        label: "评测套件",
        options: [
          { id: "task-suite", label: "任务指标" },
          { id: "safety-suite", label: "安全与合规" },
          { id: "custom-suite", label: "自定义套件" },
        ],
        defaultValue: "task-suite",
      },
    ],
    artifact: "Metrics",
    runner: "Flower",
    evaluation: "Selected evaluation suite",
    output: "Evaluation report",
    inputLabel: "Model or endpoint manifest",
    inputAccept: ".json,.yaml,.yml,.zip,.safetensors",
  },
  {
    id: "federated-analytics",
    label: "联邦统计分析",
    partitionIds: ["horizontal", "vertical", "hybrid", "non-training"],
    topologyIds: ["cross-silo", "cross-device", "hybrid-nodes", "local-simulation"],
    strategies: [
      { id: "secure-sum", label: "Secure Sum" },
      { id: "mean-variance", label: "Federated Mean / Variance" },
      { id: "histogram", label: "Federated Histogram" },
    ],
    settings: [
      {
        id: "operation",
        label: "统计操作",
        options: [
          { id: "count", label: "Count" },
          { id: "mean", label: "Mean" },
          { id: "distribution", label: "Distribution" },
        ],
        defaultValue: "count",
      },
      {
        id: "clipping",
        label: "数值裁剪",
        options: [
          { id: "auto", label: "自动估计" },
          { id: "bounded", label: "固定范围" },
          { id: "none", label: "不裁剪" },
        ],
        defaultValue: "auto",
      },
      {
        id: "visibility",
        label: "结果范围",
        options: [
          { id: "all", label: "全部参与方" },
          { id: "owner", label: "仅任务创建者" },
          { id: "selected", label: "指定参与方" },
        ],
        defaultValue: "all",
      },
    ],
    artifact: "Statistics",
    runner: "Flower",
    evaluation: "Consistency checks",
    output: "Aggregate report",
    inputLabel: "Analytics schema",
    inputAccept: ".csv,.parquet,.json",
  },
  {
    id: "fedrag",
    label: "联邦检索 / FedRAG",
    partitionIds: ["non-training", "hybrid"],
    topologyIds: ["cross-silo", "hybrid-nodes", "local-simulation"],
    strategies: [
      { id: "score-merge", label: "Score Merge" },
      { id: "rrf", label: "Reciprocal Rank Fusion" },
      { id: "secure-rerank", label: "Secure Re-ranking" },
    ],
    settings: [
      {
        id: "embedding-model",
        label: "Embedding 模型",
        options: [
          { id: "bge-m3", label: "BGE-M3" },
          { id: "e5-large", label: "E5 Large" },
          { id: "site-owned", label: "各站点自有模型" },
        ],
        defaultValue: "bge-m3",
      },
      {
        id: "index",
        label: "本地索引",
        options: [
          { id: "faiss", label: "FAISS" },
          { id: "qdrant", label: "Qdrant" },
          { id: "milvus", label: "Milvus" },
        ],
        defaultValue: "faiss",
      },
      {
        id: "top-k",
        label: "每站返回",
        options: [
          { id: "4", label: "Top 4" },
          { id: "8", label: "Top 8" },
          { id: "16", label: "Top 16" },
        ],
        defaultValue: "8",
      },
      {
        id: "return-policy",
        label: "返回内容",
        options: [
          { id: "snippets", label: "脱敏文本片段" },
          { id: "scores", label: "仅分数与引用" },
          { id: "tee", label: "TEE 内完整重排" },
        ],
        defaultValue: "snippets",
      },
    ],
    artifact: "Retrieved evidence",
    runner: "Flower + RAG worker",
    evaluation: "Retrieval + answer quality",
    output: "Federated answer",
    inputLabel: "Index or corpus manifest",
    inputAccept: ".json,.jsonl,.parquet,.zip",
  },
  {
    id: "personalized",
    label: "个性化联邦",
    partitionIds: ["horizontal", "hybrid"],
    topologyIds: ["cross-silo", "cross-device", "hybrid-nodes", "local-simulation"],
    strategies: [
      { id: "fedbn", label: "FedBN" },
      { id: "ditto", label: "Ditto" },
      { id: "fedrep", label: "FedRep" },
      { id: "local-head", label: "Local Head" },
      { id: "clustered-fl", label: "Clustered FL" },
    ],
    settings: [
      {
        id: "shared-part",
        label: "共享部分",
        options: [
          { id: "backbone", label: "Backbone" },
          { id: "representation", label: "Representation" },
          { id: "global-model", label: "Global model" },
        ],
        defaultValue: "backbone",
      },
      {
        id: "local-part",
        label: "本地保留",
        options: [
          { id: "head", label: "Prediction head" },
          { id: "batchnorm", label: "BatchNorm" },
          { id: "local-model", label: "完整本地模型" },
        ],
        defaultValue: "head",
      },
      {
        id: "evaluation",
        label: "评估目标",
        options: [
          { id: "global", label: "全局泛化" },
          { id: "personal", label: "本地个性化" },
          { id: "both", label: "两者同时" },
        ],
        defaultValue: "both",
      },
    ],
    artifact: "Shared representation",
    runner: "Flower",
    evaluation: "Global + personalized metrics",
    output: "Global and local models",
    inputLabel: "Local model package",
    inputAccept: ".zip,.json,.yaml,.yml,.safetensors",
  },
  {
    id: "heterogeneous-models",
    label: "异构模型协作",
    partitionIds: ["horizontal", "hybrid", "non-training"],
    topologyIds: ["cross-silo", "cross-device", "hybrid-nodes", "local-simulation"],
    strategies: [
      { id: "distillation", label: "Knowledge Distillation" },
      { id: "prototype", label: "Prototype Aggregation" },
      { id: "logit", label: "Logit Aggregation" },
      { id: "representation", label: "Representation Alignment" },
    ],
    settings: [
      {
        id: "exchange",
        label: "交换对象",
        options: [
          { id: "logits", label: "Logits" },
          { id: "prototypes", label: "Prototypes" },
          { id: "embeddings", label: "Embeddings" },
        ],
        defaultValue: "logits",
      },
      {
        id: "calibration",
        label: "校准数据",
        options: [
          { id: "public", label: "公共校准集" },
          { id: "synthetic", label: "合成数据" },
          { id: "data-free", label: "Data-free" },
        ],
        defaultValue: "public",
      },
      {
        id: "model-policy",
        label: "模型结构",
        options: [
          { id: "free", label: "各方自由选择" },
          { id: "family", label: "限定模型家族" },
          { id: "size", label: "仅限制输出维度" },
        ],
        defaultValue: "family",
      },
    ],
    artifact: "Logits / prototypes",
    runner: "Custom Flower strategy",
    evaluation: "Per-model and global metrics",
    output: "Site-specific models",
    inputLabel: "Model contract",
    inputAccept: ".json,.yaml,.yml,.zip",
  },
  {
    id: "agent-skill",
    label: "Agent / Skill 协作",
    partitionIds: ["non-training", "horizontal", "hybrid"],
    topologyIds: ["cross-silo", "hybrid-nodes", "local-simulation"],
    strategies: [
      { id: "policy-distillation", label: "Policy Distillation" },
      { id: "feedback-aggregation", label: "反馈与轨迹聚合" },
      { id: "skill-merge", label: "Skill Artifact Merge" },
    ],
    settings: [
      {
        id: "skill-artifact",
        label: "协作对象",
        options: [
          { id: "policy", label: "Agent policy" },
          { id: "trajectory", label: "执行轨迹" },
          { id: "skill", label: "Skill artifact" },
          { id: "adapter", label: "LoRA / Adapter" },
        ],
        defaultValue: "skill",
      },
      {
        id: "conflict-policy",
        label: "冲突处理",
        options: [
          { id: "agent-review", label: "Agent review" },
          { id: "vote", label: "参与方投票" },
          { id: "benchmark", label: "Benchmark 决策" },
        ],
        defaultValue: "agent-review",
      },
      {
        id: "skill-evaluation",
        label: "效果验证",
        options: [
          { id: "sandbox", label: "沙箱回放" },
          { id: "judge", label: "LLM Judge" },
          { id: "human", label: "人工审核" },
        ],
        defaultValue: "sandbox",
      },
    ],
    artifact: "Policy / skill artifact",
    runner: "Custom sandbox runner",
    evaluation: "Sandbox replay",
    output: "Versioned skill package",
    inputLabel: "Skill or trace package",
    inputAccept: ".zip,.json,.jsonl,.md,.yaml,.yml",
  },
];

export const DEFAULT_WORKLOAD_ID = "peft";

export function workloadOf(id: string): WorkloadDefinition {
  return WORKLOADS.find((item) => item.id === id) ?? WORKLOADS[0];
}

export function protectionOf(id: string) {
  return PROTECTIONS.find((item) => item.id === id) ?? PROTECTIONS[0];
}

export function optionLabel(options: readonly SelectOption[], id: string): string {
  return options.find((option) => option.id === id)?.label ?? id;
}

export function configurationFor(workloadId: string): FederationConfiguration {
  const workload = workloadOf(workloadId);
  return {
    workloadId: workload.id,
    partitionId: workload.partitionIds[0],
    topologyId: workload.topologyIds[0],
    strategyId: workload.strategies[0].id,
    protectionId: workload.id === "vertical-modeling" ? "encrypted-compute" : "private-aggregate",
    settings: Object.fromEntries(workload.settings.map((setting) => [setting.id, setting.defaultValue])),
  };
}

export const INITIAL_CONFIGURATION = configurationFor(DEFAULT_WORKLOAD_ID);

export function isConfigurationReady(configuration: FederationConfiguration): boolean {
  const workload = workloadOf(configuration.workloadId);
  return Boolean(
    workload.partitionIds.includes(configuration.partitionId)
    && workload.topologyIds.includes(configuration.topologyId)
    && workload.strategies.some((strategy) => strategy.id === configuration.strategyId)
    && PROTECTIONS.some((protection) => protection.id === configuration.protectionId)
    && workload.settings.every((setting) => configuration.settings[setting.id]),
  );
}

export function configurationSummary(configuration: FederationConfiguration) {
  const workload = workloadOf(configuration.workloadId);
  return {
    workload: workload.label,
    partition: optionLabel(PARTITIONS, configuration.partitionId),
    topology: optionLabel(TOPOLOGIES, configuration.topologyId),
    strategy: optionLabel(workload.strategies, configuration.strategyId),
    protection: protectionOf(configuration.protectionId).label,
    runner: workload.runner,
    artifact: workload.artifact,
    evaluation: workload.evaluation,
    output: workload.output,
  };
}
