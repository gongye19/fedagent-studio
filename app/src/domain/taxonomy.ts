/**
 * 联邦协作的基础注册表：场景、算力规格、数据类型和模型。
 *
 * 这些条目被 7 个配置维度（dimensions.ts）、运行计划（plan.ts）和模拟器共同引用。
 * 收录原则（demo 阶段）：只保留最通用、最主流、且有持续维护实现的方法；大模型 / Agent 相关方法例外保留，
 * 内部标为 frontier（界面不显示）。完整设计见 docs/DIMENSIONS.md。
 */

export type Adoption = "mainstream" | "frontier";

/** 场景、模型和共享方式里只要有一个是前沿，整体就是前沿。 */
export function combinedAdoption(...levels: (Adoption | undefined)[]): Adoption {
  return levels.includes("frontier") ? "frontier" : "mainstream";
}

export type Choice = {
  id: string;
  label: string;
  hint?: string;
  adoption?: Adoption;
};

/** 协作在数学上做的是哪类计算，展示在平台推导里。 */
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

/* 维度 1：协作场景，按参与方式分组。 */
export type InputKind = "nodes" | "files";

export const INPUT_KIND_LABEL: Record<InputKind, string> = {
  nodes: "连接节点 · 多轮运行",
  files: "上传文件 · 一次完成",
};

export type ScenarioId = "horizontal-training" | "vertical-training" | "federated-analytics" | "agent-memory";

export type Scenario = Choice & {
  id: ScenarioId;
  hint: string;
  adoption: Adoption;
  input: InputKind;
  pattern: ExecutionPattern;
  /** 执行框架：横向照 Flower，纵向用隐语 SecretFlow，文件类场景由平台服务执行。 */
  runner: string;
};

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "horizontal-training",
    label: "横向联邦训练",
    hint: "各方特征相同、样本不同，本地训练、多轮聚合。",
    adoption: "mainstream",
    input: "nodes",
    pattern: "iterative",
    runner: "Flower",
  },
  {
    id: "vertical-training",
    label: "纵向联邦训练",
    hint: "各方样本重叠、特征不同，隐私求交后在加密协议下联合建模。",
    adoption: "mainstream",
    input: "nodes",
    pattern: "vertical-protocol",
    runner: "隐语 SecretFlow",
  },
  {
    id: "federated-analytics",
    label: "联邦统计分析",
    hint: "各方上传分组汇总统计，平台计算全局指标。",
    adoption: "mainstream",
    input: "files",
    pattern: "aggregate-once",
    runner: "平台统计服务",
  },
  {
    id: "agent-memory",
    label: "Agent 记忆联邦",
    hint: "各方上传 Agent 记忆，平台脱敏、合并、验证后分发。",
    adoption: "frontier",
    input: "files",
    pattern: "merge-once",
    runner: "平台记忆合并服务",
  },
];

export function scenarioOf(id: string | null): Scenario | undefined {
  return id ? SCENARIOS.find((scenario) => scenario.id === id) : undefined;
}

/* 维度 2：算力规格。按 vCPU、内存和单卡显存描述，节点需要在三项上都不低于要求。 */
export type ComputeId = "cpu-general" | "cpu-compute" | "gpu-16" | "gpu-24" | "gpu-80";

export type ComputeSpec = Choice & {
  id: ComputeId;
  hint: string;
  vcpu: number;
  memoryGb: number;
  gpuGb: number;
};

export const COMPUTE_SPECS: readonly ComputeSpec[] = [
  { id: "cpu-general", label: "通用 CPU", hint: "8 vCPU · 32 GB 内存", vcpu: 8, memoryGb: 32, gpuGb: 0 },
  { id: "cpu-compute", label: "计算型 CPU", hint: "32 vCPU · 128 GB 内存", vcpu: 32, memoryGb: 128, gpuGb: 0 },
  { id: "gpu-16", label: "GPU 16 GB", hint: "T4 级 · 8 vCPU · 32 GB 内存", vcpu: 8, memoryGb: 32, gpuGb: 16 },
  { id: "gpu-24", label: "GPU 24 GB", hint: "A10 / L4 级 · 16 vCPU · 64 GB 内存", vcpu: 16, memoryGb: 64, gpuGb: 24 },
  { id: "gpu-80", label: "GPU 80 GB", hint: "A100 / H100 级 · 32 vCPU · 256 GB 内存", vcpu: 32, memoryGb: 256, gpuGb: 80 },
];

export function computeOf(id: string | null | undefined): ComputeSpec | undefined {
  return id ? COMPUTE_SPECS.find((spec) => spec.id === id) : undefined;
}

export type Requirement = { vcpu?: number; gpuGb?: number };

export function satisfies(spec: ComputeSpec | undefined, requirement: Requirement | undefined): boolean {
  if (!requirement) return true;
  if (!spec) return false;
  return spec.vcpu >= (requirement.vcpu ?? 0) && spec.gpuGb >= (requirement.gpuGb ?? 0);
}

/** 节点实际规格是否不低于项目要求的最低规格。 */
export function meetsSpec(actual: string | null | undefined, required: string | null | undefined): boolean {
  const have = computeOf(actual);
  const need = computeOf(required);
  if (!need) return true;
  if (!have) return false;
  return have.vcpu >= need.vcpu && have.memoryGb >= need.memoryGb && have.gpuGb >= need.gpuGb;
}

export type DeploymentId = "aliyun" | "tencent" | "huawei" | "aws" | "azure" | "on-prem" | "hosted";

export const DEPLOYMENTS: readonly (Choice & { id: DeploymentId })[] = [
  { id: "aliyun", label: "阿里云", hint: "平台在你授权的云账号中创建节点实例" },
  { id: "tencent", label: "腾讯云", hint: "平台在你授权的云账号中创建节点实例" },
  { id: "huawei", label: "华为云", hint: "平台在你授权的云账号中创建节点实例" },
  { id: "aws", label: "AWS", hint: "平台在你授权的云账号中创建节点实例" },
  { id: "azure", label: "Azure", hint: "平台在你授权的云账号中创建节点实例" },
  { id: "on-prem", label: "私有机房", hint: "平台提供节点安装包，一条命令启动" },
  { id: "hosted", label: "平台托管", hint: "在平台隔离沙箱中执行，参与方无需部署节点" },
];

export function deploymentOf(id: string | null | undefined) {
  return id ? DEPLOYMENTS.find((item) => item.id === id) : undefined;
}

/* 维度 3：数据类型。 */
export type DataTypeId = "image" | "table" | "instruction" | "vertical-table" | "summary-table" | "memory-jsonl";

export type DataType = Choice & { id: DataTypeId; scenario: ScenarioId; requirement?: Requirement };

export const DATA_TYPES: readonly DataType[] = [
  { id: "image", label: "图像", hint: "带标签的图像，如医学影像、质检图片", scenario: "horizontal-training" },
  { id: "table", label: "结构化表格", hint: "CSV / Parquet，各方列结构一致", scenario: "horizontal-training" },
  { id: "instruction", label: "文本指令（JSONL）", hint: "指令或对话数据，用于大模型微调，需要 GPU", scenario: "horizontal-training", requirement: { gpuGb: 16 } },
  { id: "vertical-table", label: "结构化表格（含对齐主键）", hint: "各方以用户 ID 等主键关联，标签方另含标签列", scenario: "vertical-training" },
  { id: "summary-table", label: "分组汇总表（CSV）", hint: "按地区、年龄段等分组的计数与求和", scenario: "federated-analytics" },
  { id: "memory-jsonl", label: "Agent 记忆（JSONL）", hint: "每行一条记忆：内容、类型、来源、时间", scenario: "agent-memory" },
];

export function dataTypeOf(id: string | null | undefined): DataType | undefined {
  return id ? DATA_TYPES.find((item) => item.id === id) : undefined;
}

/* 维度 4：模型 / 分析对象。 */
export type ModelFamily = "cnn" | "mlp" | "tree" | "linear" | "llm" | "vertical-tree" | "vertical-linear" | "stats" | "memory";

export type Model = Choice & {
  scenario: ScenarioId;
  dataType: DataTypeId;
  family: ModelFamily;
  requirement?: Requirement;
  /** 大模型微调所需的单卡显存（GB）。 */
  peft?: { lora: number; qlora: number };
  /** 每轮（1 个本地 epoch）的大致耗时，分钟。 */
  perRoundMinutes?: readonly [number, number];
};

export const MODELS: readonly Model[] = [
  { id: "resnet18", label: "ResNet-18", hint: "图像分类 · CPU 可运行，建议 GPU", scenario: "horizontal-training", dataType: "image", family: "cnn", perRoundMinutes: [1, 3] },
  { id: "mlp", label: "MLP", hint: "表格分类 / 回归 · CPU", scenario: "horizontal-training", dataType: "table", family: "mlp", perRoundMinutes: [0.3, 1] },
  { id: "xgboost", label: "XGBoost", hint: "表格梯度提升树 · CPU", scenario: "horizontal-training", dataType: "table", family: "tree", perRoundMinutes: [0.3, 1] },
  { id: "logreg", label: "逻辑回归", hint: "表格二分类 · 可解释 · CPU", scenario: "horizontal-training", dataType: "table", family: "linear", perRoundMinutes: [0.2, 0.5] },
  { id: "qwen2.5-1.5b", label: "Qwen2.5-1.5B-Instruct", hint: "LoRA / QLoRA 需 GPU 16 GB", scenario: "horizontal-training", dataType: "instruction", family: "llm", adoption: "frontier", requirement: { gpuGb: 16 }, peft: { lora: 16, qlora: 16 }, perRoundMinutes: [4, 8] },
  { id: "qwen3-1.7b", label: "Qwen3-1.7B", hint: "LoRA / QLoRA 需 GPU 16 GB", scenario: "horizontal-training", dataType: "instruction", family: "llm", adoption: "frontier", requirement: { gpuGb: 16 }, peft: { lora: 16, qlora: 16 }, perRoundMinutes: [4, 9] },
  { id: "llama-3.2-3b", label: "Llama-3.2-3B-Instruct", hint: "LoRA 需 GPU 24 GB，QLoRA 需 16 GB", scenario: "horizontal-training", dataType: "instruction", family: "llm", adoption: "frontier", requirement: { gpuGb: 16 }, peft: { lora: 24, qlora: 16 }, perRoundMinutes: [7, 14] },
  { id: "secureboost", label: "SecureBoost", hint: "纵向梯度提升树 · 建议 ≥16 vCPU", scenario: "vertical-training", dataType: "vertical-table", family: "vertical-tree", requirement: { vcpu: 16 } },
  { id: "ss-lr", label: "纵向逻辑回归（SS-LR）", hint: "基于秘密分享 · 可解释 · 通用 CPU", scenario: "vertical-training", dataType: "vertical-table", family: "vertical-linear" },
  { id: "stats-basic", label: "基础统计量", hint: "计数、求和、均值、方差、比例", scenario: "federated-analytics", dataType: "summary-table", family: "stats" },
  { id: "stats-distribution", label: "分布与分位数", hint: "统一分箱的直方图、中位数与分位数", scenario: "federated-analytics", dataType: "summary-table", family: "stats" },
  { id: "memory-entries", label: "Agent 记忆条目", hint: "经验、事实、操作步骤等记忆", scenario: "agent-memory", dataType: "memory-jsonl", family: "memory", adoption: "frontier" },
];

export function modelOf(id: string | null | undefined): Model | undefined {
  return id ? MODELS.find((model) => model.id === id) : undefined;
}

export type Availability = { available: boolean };
