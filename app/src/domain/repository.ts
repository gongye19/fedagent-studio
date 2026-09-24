// L4 仓库。demo 阶段是内存里的一组种子产物；接真后端时换成查询即可，
// 上层只依赖这里导出的函数签名。
//
// 元数据里 architecture / baseCheckpoint / rank 是判定字段，
// provenance / trainingMethod / metrics 是信任字段——合并失败最常见的形态是
// 「看起来像正常升级」，所以来源和既有指标必须是一等字段，不能是可选备注。

import type { Artifact } from "./types";

const LORA_METRICS = ["综合基准", "领域准确率", "指令遵循", "拒答合规"] as const;
const CARD_METRICS = ["诊断准确率", "检查项命中", "结论一致性"] as const;

export const METRIC_KEYS: Record<string, readonly string[]> = {
  lora: LORA_METRICS,
  "skill-cards": CARD_METRICS,
};

const MB = 1024 * 1024;

export const SEED_ARTIFACTS: Artifact[] = [
  {
    id: "news-summary",
    name: "新闻摘要与事实核查",
    objectType: "lora",
    domain: "新闻",
    architecture: "llama-3.1-8b",
    baseCheckpoint: "Llama-3.1-8B-Instruct",
    rank: 16,
    provenance: "智库数据中心",
    trainingMethod: "12 万条编辑部标注稿件，LoRA 监督微调",
    sizeBytes: 42 * MB,
    createdAt: "2026-07-14",
    metrics: { 综合基准: 0.71, 领域准确率: 0.88, 指令遵循: 0.83, 拒答合规: 0.94 },
    owner: "platform",
  },
  {
    id: "legal-qa",
    name: "法律条文问答",
    objectType: "lora",
    domain: "法律",
    architecture: "llama-3.1-8b",
    baseCheckpoint: "Llama-3.1-8B-Instruct",
    rank: 16,
    provenance: "京衡法律科技",
    trainingMethod: "现行法规与判例问答对 8.6 万条，LoRA 监督微调",
    sizeBytes: 42 * MB,
    createdAt: "2026-08-02",
    metrics: { 综合基准: 0.69, 领域准确率: 0.91, 指令遵循: 0.8, 拒答合规: 0.96 },
    owner: "platform",
  },
  {
    id: "finance-report",
    name: "财报解读",
    objectType: "lora",
    domain: "金融",
    architecture: "llama-3.1-8b",
    baseCheckpoint: "Llama-3.1-8B-Instruct",
    rank: 16,
    provenance: "中信证券研究所",
    trainingMethod: "A 股年报与研报摘要 5.2 万条，LoRA 监督微调",
    sizeBytes: 42 * MB,
    createdAt: "2026-08-21",
    metrics: { 综合基准: 0.7, 领域准确率: 0.86, 指令遵循: 0.82, 拒答合规: 0.93 },
    owner: "platform",
  },
  {
    id: "gov-writing",
    name: "政务公文写作",
    objectType: "lora",
    domain: "政务",
    architecture: "llama-3.1-8b",
    baseCheckpoint: "Llama-3.1-8B-Instruct",
    rank: 32,
    provenance: "市数据局",
    trainingMethod: "公开公文语料 3.1 万篇，LoRA 监督微调，秩 32",
    sizeBytes: 84 * MB,
    createdAt: "2026-06-30",
    metrics: { 综合基准: 0.67, 领域准确率: 0.89, 指令遵循: 0.85, 拒答合规: 0.97 },
    owner: "platform",
  },
  {
    id: "retail-support",
    name: "零售客服对话",
    objectType: "lora",
    domain: "零售",
    architecture: "llama-3.1-8b",
    baseCheckpoint: "Llama-3.1-8B-Instruct",
    rank: 16,
    provenance: "云仓客服中台",
    trainingMethod: "脱敏客服会话 21 万轮，LoRA 监督微调",
    sizeBytes: 42 * MB,
    createdAt: "2026-09-05",
    metrics: { 综合基准: 0.66, 领域准确率: 0.84, 指令遵循: 0.87, 拒答合规: 0.91 },
    owner: "platform",
  },
  {
    id: "legal-retrieval-qwen",
    name: "中文法律检索",
    objectType: "lora",
    domain: "法律",
    architecture: "qwen2.5-7b",
    baseCheckpoint: "Qwen2.5-7B-Instruct",
    rank: 16,
    provenance: "智法云",
    trainingMethod: "法条检索与重排样本 6.4 万条，LoRA 监督微调",
    sizeBytes: 38 * MB,
    createdAt: "2026-07-28",
    metrics: { 综合基准: 0.68, 领域准确率: 0.9, 指令遵循: 0.79, 拒答合规: 0.95 },
    owner: "platform",
  },
  {
    id: "review-analysis-qwen",
    name: "电商评论分析",
    objectType: "lora",
    domain: "零售",
    architecture: "qwen2.5-7b",
    baseCheckpoint: "Qwen2.5-7B-Instruct",
    rank: 16,
    provenance: "橙序科技",
    trainingMethod: "商品评论情感与属性标注 14 万条，LoRA 监督微调",
    sizeBytes: 38 * MB,
    createdAt: "2026-08-16",
    metrics: { 综合基准: 0.64, 领域准确率: 0.85, 指令遵循: 0.81, 拒答合规: 0.9 },
    owner: "platform",
  },
  {
    id: "edge-intent",
    name: "边缘端意图识别",
    objectType: "lora",
    domain: "通用",
    architecture: "llama-3.2-3b",
    baseCheckpoint: "Llama-3.2-3B-Instruct",
    rank: 8,
    provenance: "端智能实验室",
    trainingMethod: "短指令意图样本 9.8 万条，LoRA 监督微调，秩 8",
    sizeBytes: 11 * MB,
    createdAt: "2026-09-11",
    metrics: { 综合基准: 0.58, 领域准确率: 0.82, 指令遵循: 0.76, 拒答合规: 0.88 },
    owner: "platform",
  },
  {
    id: "cards-internal",
    name: "诊断经验卡 · 内科与神经",
    objectType: "skill-cards",
    domain: "医疗",
    architecture: "evomed-card-v5",
    baseCheckpoint: "evomed-r1",
    provenance: "华东三院",
    trainingMethod: "本院脱敏诊断记录整理，只含抽象触发条件与目标动作",
    sizeBytes: 180 * 1024,
    createdAt: "2026-09-18",
    metrics: { 诊断准确率: 0.8, 检查项命中: 0.85, 结论一致性: 0.79 },
    owner: "platform",
  },
  {
    id: "cards-surgery",
    name: "诊断经验卡 · 外科与肌骨",
    objectType: "skill-cards",
    domain: "医疗",
    architecture: "evomed-card-v5",
    baseCheckpoint: "evomed-r1",
    provenance: "江南骨科医院",
    trainingMethod: "本院脱敏诊断记录整理，只含抽象触发条件与目标动作",
    sizeBytes: 132 * 1024,
    createdAt: "2026-09-18",
    metrics: { 诊断准确率: 0.85, 检查项命中: 0.81, 结论一致性: 0.83 },
    owner: "platform",
  },
  {
    id: "cards-pediatrics",
    name: "诊断经验卡 · 妇儿与消化",
    objectType: "skill-cards",
    domain: "医疗",
    architecture: "evomed-card-v5",
    baseCheckpoint: "evomed-r1",
    provenance: "海湾妇儿医院",
    trainingMethod: "本院脱敏诊断记录整理，只含抽象触发条件与目标动作",
    sizeBytes: 164 * 1024,
    createdAt: "2026-09-18",
    metrics: { 诊断准确率: 0.75, 检查项命中: 0.88, 结论一致性: 0.77 },
    owner: "platform",
  },
  {
    id: "mine-legal",
    name: "本所法律问答微调",
    objectType: "lora",
    domain: "法律",
    architecture: "llama-3.1-8b",
    baseCheckpoint: "Llama-3.1-8B-Instruct",
    rank: 16,
    provenance: "本机构",
    trainingMethod: "内部案卷问答 1.2 万条，LoRA 监督微调",
    sizeBytes: 42 * MB,
    createdAt: "2026-09-20",
    metrics: { 综合基准: 0.63, 领域准确率: 0.87, 指令遵循: 0.78, 拒答合规: 0.92 },
    owner: "me",
  },
  {
    id: "mine-cards",
    name: "本院诊断经验卡 第 3 批",
    objectType: "skill-cards",
    domain: "医疗",
    architecture: "evomed-card-v5",
    baseCheckpoint: "evomed-r1",
    provenance: "本机构",
    trainingMethod: "本院脱敏诊断记录整理，第 3 批增量",
    sizeBytes: 96 * 1024,
    createdAt: "2026-09-22",
    metrics: { 诊断准确率: 0.78, 检查项命中: 0.83, 结论一致性: 0.75 },
    owner: "me",
  },
];

export function formatSize(bytes: number): string {
  if (bytes >= MB) return `${Math.round(bytes / MB)}\u00a0MB`;
  return `${Math.round(bytes / 1024)}\u00a0KB`;
}

export function artifactOf(all: Artifact[], id: string): Artifact | undefined {
  return all.find((item) => item.id === id);
}

export function domainsOf(all: Artifact[]): string[] {
  return [...new Set(all.map((item) => item.domain))].sort();
}
