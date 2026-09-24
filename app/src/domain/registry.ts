// L2 注册表。新增一个联邦方法 = 在这里加一条声明 + 在 backends.ts 加一个适配器，
// 编排层和状态机零改动（C5）。
//
// 每条声明里最重要的是 computeKind：它说的是这个方法在数学上到底做了什么，
// 加密方式能不能配它，全靠这一个字段推出来，不靠人工维护一张互斥表。

import type { Dataset, Evaluation, Method, Privacy } from "./types";

export const METHODS: Method[] = [
  {
    id: "weighted-average",
    name: "加权平均",
    summary: "按权重对各方的增量求加权和。最稳妥的基线，任何加密方式都配得上。",
    accepts: ["lora"],
    computeKind: "additive",
    requiresSameRank: true,
    minArtifacts: 2,
    resourceClass: "cpu-small",
    backend: "mergekit",
    reference: "Model Soup / FedAvg",
  },
  {
    id: "task-arithmetic",
    name: "Task Arithmetic",
    summary: "把每个增量当作一个任务向量相加，可按领域调正负权重。等价于轮数为 1 的 FedAvg。",
    accepts: ["lora"],
    computeKind: "additive",
    requiresSameRank: true,
    minArtifacts: 2,
    resourceClass: "cpu-small",
    backend: "mergekit",
    reference: "Task Arithmetic (TMLR 2025 证明与 FedAvg 等价)",
  },
  {
    id: "ties",
    name: "TIES-Merging",
    summary: "先按幅值裁掉小改动，再让符号冲突的参数投票，最后只合并方向一致的部分。",
    accepts: ["lora"],
    computeKind: "compare",
    requiresSameRank: true,
    minArtifacts: 2,
    resourceClass: "cpu-small",
    backend: "mergekit",
    reference: "TIES-Merging",
  },
  {
    id: "dare",
    name: "DARE",
    summary: "随机丢弃大部分增量再按比例放大剩下的。丢弃与取值无关，所以密文下也能做。",
    accepts: ["lora"],
    computeKind: "additive-masked",
    requiresSameRank: true,
    minArtifacts: 2,
    resourceClass: "cpu-small",
    backend: "mergekit",
    reference: "DARE",
  },
  {
    id: "lora-concat",
    name: "LoRA 拼接",
    summary: "不做平均，把各方的低秩矩阵按列拼起来，秩相加。允许各方秩不同。",
    accepts: ["lora"],
    computeKind: "additive",
    requiresSameRank: false,
    minArtifacts: 2,
    resourceClass: "cpu-small",
    backend: "mergekit",
    reference: "LoRA concatenation",
  },
  {
    id: "card-merge",
    name: "经验卡去重合并",
    summary: "按签名去重、按语义分组、按有益与有害次数过滤，再与基线版本按卡片编号合并。",
    accepts: ["skill-cards"],
    computeKind: "content-aware",
    requiresSameRank: false,
    minArtifacts: 2,
    resourceClass: "cpu-small",
    backend: "evomed-merge",
    reference: "evomed-skill-card-merge v5",
  },
];

export const PRIVACIES: Privacy[] = [
  {
    id: "none",
    name: "不加密",
    summary: "只有传输层加密。平台能看到上传内容的明文。",
    supports: ["additive", "additive-masked", "compare", "content-aware"],
    resourceClass: "cpu-small",
  },
  {
    id: "redaction",
    name: "字段脱敏",
    summary: "上传前按约定裁掉敏感字段，剩下的仍是明文。裁掉哪些字段在产物里有记录。",
    supports: ["additive", "additive-masked", "compare", "content-aware"],
    resourceClass: "cpu-small",
  },
  {
    id: "secagg",
    name: "安全聚合",
    summary: "各方用互相抵消的掩码遮住自己的增量，平台只能解出总和，看不到任何单方内容。",
    supports: ["additive", "additive-masked"],
    resourceClass: "cpu-small",
    note: "平台看不见单方增量，所以任何需要逐个比较的方法都做不了。",
  },
  {
    id: "he-ckks",
    name: "同态加密",
    summary: "上传密文，平台直接在密文上求和。适合浮点权重。",
    supports: ["additive", "additive-masked"],
    resourceClass: "cpu-bigmem",
    note: "密钥材料是 GB 级，慢在预处理与转密，密文求和本身只要几毫秒。",
  },
  {
    id: "dp",
    name: "差分隐私",
    summary: "上传前按预算加噪并裁剪范数，用可量化的 ε 换取可证明的隐私。",
    supports: ["additive", "additive-masked", "compare"],
    resourceClass: "cpu-small",
    note: "噪声会扰乱内容的字面取值，所以按内容分组去重的方法不适用。",
  },
  {
    id: "tee",
    name: "可信执行环境",
    summary: "平台在硬件飞地里解密并明文计算，飞地外拿不到内容。",
    supports: ["additive", "additive-masked", "compare", "content-aware"],
    resourceClass: "cpu-bigmem",
    note: "唯一能配所有方法的方案，代价是绑定特定硬件。",
  },
];

export const EVALUATIONS: Evaluation[] = [
  {
    id: "central-benchmark",
    name: "中心化基准评测",
    summary: "在平台的公开评测集上跑一遍，所有产出可横向比较。",
    accepts: ["lora", "skill-cards"],
    resourceClass: "gpu",
    datasetId: "eval-mixed",
  },
  {
    id: "domain-suite",
    name: "领域评测套件",
    summary: "按参与产物覆盖的领域各跑一套，能看出合并有没有削弱某一个领域。",
    accepts: ["lora"],
    resourceClass: "gpu",
    datasetId: "eval-domain",
  },
  {
    id: "federated-eval",
    name: "联邦评测",
    summary: "各方在自己的留出集上跑，只回传指标，样本不出本地。",
    accepts: ["lora", "skill-cards"],
    resourceClass: "cpu-small",
  },
  {
    id: "case-replay",
    name: "病例回放评测",
    summary: "在本地留存的历史病例上逐例对比合并前后的结论。",
    accepts: ["skill-cards"],
    resourceClass: "cpu-small",
  },
];

export const DATASETS: Dataset[] = [
  { id: "ft-general", name: "通用指令对齐集", domain: "通用", samples: 52000, purpose: "finetune" },
  { id: "ft-zh-formal", name: "中文正式文体集", domain: "通用", samples: 18400, purpose: "finetune" },
  { id: "ft-domain-qa", name: "多领域问答集", domain: "混合", samples: 31200, purpose: "finetune" },
  { id: "eval-mixed", name: "综合基准评测集", domain: "混合", samples: 4800, purpose: "eval" },
  { id: "eval-domain", name: "分领域评测集", domain: "混合", samples: 7600, purpose: "eval" },
];

export const methodOf = (id: string) => METHODS.find((item) => item.id === id);
export const privacyOf = (id: string) => PRIVACIES.find((item) => item.id === id);
export const evaluationOf = (id: string) => EVALUATIONS.find((item) => item.id === id);
export const datasetOf = (id: string) => DATASETS.find((item) => item.id === id);
