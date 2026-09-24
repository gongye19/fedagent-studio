// 领域类型。这一份是 L2/L3/L4/L5 共用的词汇表。
//
// 关键约定：产物只用「对象类型 + 架构 + 基座」三个字段判定能不能一起合并（C2），
// 其余字段都是给人看的信任依据，不参与判定。

export type ObjectType = "lora" | "skill-cards";

/** 聚合在数学上到底做了什么——这个决定了密文下能不能算。 */
export type ComputeKind =
  /** 纯加权和。同态加密、安全聚合都能做。 */
  | "additive"
  /** 加权和 + 与取值无关的随机掩码（DARE 的随机丢弃属于这类）。 */
  | "additive-masked"
  /** 需要比较取值大小（取幅值 top-k、符号投票）。密文下做不到。 */
  | "compare"
  /** 需要读懂内容才能分组去重。密文下做不到。 */
  | "content-aware";

export type ResourceClass = "cpu-small" | "cpu-bigmem" | "gpu";

export type Artifact = {
  id: string;
  name: string;
  objectType: ObjectType;
  domain: string;
  /** 判定字段一：模型架构。层数、隐藏维、注意力头必须完全一致才能合并。 */
  architecture: string;
  /** 判定字段二：基座 checkpoint。同架构不同基座也合不了。 */
  baseCheckpoint: string;
  /** LoRA 的秩。不参与 C2 判定，但方法层面有要求（见 requiresSameRank）。 */
  rank?: number;
  provenance: string;
  trainingMethod: string;
  sizeBytes: number;
  createdAt: string;
  /** 已有评测。合并后要拿它跟新结果对比（C4）。 */
  metrics: Record<string, number>;
  owner: "platform" | "me";
  /** 由哪几个产物合出来的；原始上传的产物没有这个字段。 */
  lineage?: string[];
};

export type Method = {
  id: string;
  name: string;
  summary: string;
  accepts: ObjectType[];
  computeKind: ComputeKind;
  /** 为 true 时参与合并的 LoRA 必须同秩。 */
  requiresSameRank: boolean;
  minArtifacts: number;
  resourceClass: ResourceClass;
  backend: string;
  reference: string;
};

export type Privacy = {
  id: string;
  name: string;
  summary: string;
  /** 这种保护方式下平台还能做哪几类计算。 */
  supports: ComputeKind[];
  resourceClass: ResourceClass;
  note?: string;
};

export type Evaluation = {
  id: string;
  name: string;
  summary: string;
  accepts: ObjectType[];
  resourceClass: ResourceClass;
  datasetId?: string;
};

export type Dataset = {
  id: string;
  name: string;
  domain: string;
  samples: number;
  purpose: "finetune" | "eval";
};

export type Recipe = {
  artifactIds: string[];
  methodId: string;
  privacyId: string;
  /** 不选就跳过平台侧微调（S6）。 */
  datasetId: string | null;
  evaluationId: string;
};

/** 一条被排除的选项，连同原因。界面上必须把原因显示出来，不能只置灰（C1）。 */
export type Blocked<T> = {
  item: T;
  reason: string;
};

export type Choices<T> = {
  allowed: T[];
  blocked: Blocked<T>[];
};
