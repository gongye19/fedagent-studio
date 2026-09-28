/**
 * 7 个配置维度及其子项，按云服务下单的顺序排列：
 * 1 协作场景 → 2 参与方与算力 → 3 数据 → 4 模型 → 5 算法与训练 → 6 安全与隐私 → 7 评测与交付。
 *
 * 每个子项按当前选择给出候选：
 * - 返回 null：该子项不适用于当前场景，界面不显示；
 * - 只有一个候选：由场景或平台固定，界面显示为锁定值；
 * - 多个候选：可选，与前面选择冲突的置灰。
 * 所有子项都有推荐默认值，选完场景即得到一份完整配置。只有前面的约束后面的。
 */
import {
  COMPUTE_SPECS,
  DATA_TYPES,
  DEPLOYMENTS,
  MODELS,
  SCENARIOS,
  computeOf,
  modelOf,
  satisfies,
  scenarioOf,
  type Choice,
  type ModelFamily,
} from "./taxonomy";

export type DimensionId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type ItemId =
  | "scenario"
  | "partyScale"
  | "deployment"
  | "compute"
  | "network"
  | "dataAccess"
  | "dataType"
  | "alignment"
  | "model"
  | "sharing"
  | "aggregation"
  | "rounds"
  | "sampling"
  | "localEpochs"
  | "baseline"
  | "secagg"
  | "dp"
  | "crypto"
  | "outputProtection"
  | "evaluation"
  | "deliverable"
  | "deliveryScope";

export type Selection = Record<ItemId, string | null>;

export type Candidate = { choice: Choice; available: boolean };

/** cards：带说明的选项卡；chips：参数类的紧凑选项。 */
export type ItemDisplay = "cards" | "chips";

export type ItemDefinition = {
  id: ItemId;
  dimension: DimensionId;
  code: string;
  title: (selection: Selection) => string;
  display: ItemDisplay;
  candidates: (selection: Selection) => Candidate[] | null;
  preferred?: (selection: Selection) => string | undefined;
};

export const DIMENSIONS: readonly { id: DimensionId; title: string; question: string }[] = [
  { id: 1, title: "协作场景", question: "要完成哪一类联邦协作？" },
  { id: 2, title: "参与方与算力", question: "有几方参与，每方节点需要什么配置？" },
  { id: 3, title: "数据", question: "数据如何接入、如何对齐？" },
  { id: 4, title: "模型", question: "训练或计算的对象是什么？" },
  { id: 5, title: "算法与训练", question: "如何聚合，训练多少轮？" },
  { id: 6, title: "安全与隐私", question: "需要哪些保护机制？" },
  { id: 7, title: "评测与交付", question: "如何评估结果，交付给谁？" },
];

/* 选项表。 */

export const PARTY_SCALES: readonly (Choice & { min: number })[] = [
  { id: "2", label: "2 方", hint: "双方合作，纵向联合建模最常见", min: 2 },
  { id: "3-5", label: "3–5 方", hint: "常见的跨机构联盟规模", min: 3 },
  { id: "6-10", label: "6–10 方", hint: "行业联盟或集团内多个分支", min: 6 },
];

export function minParties(scale: string | null): number {
  return PARTY_SCALES.find((item) => item.id === scale)?.min ?? 2;
}

const NETWORKS: readonly Choice[] = [
  { id: "public", label: "公网（TLS）", hint: "节点主动连接平台，无需开放入站端口" },
  { id: "leased", label: "专线", hint: "低延迟、高带宽，纵向协议推荐" },
];

const DATA_ACCESS = {
  nodes: { id: "node-local", label: "节点本地", hint: "数据留在各方节点，只交换加密或聚合后的中间结果" },
  files: { id: "file-upload", label: "文件上传", hint: "各方上传汇总文件，在平台隔离沙箱中处理" },
} as const;

const ALIGNMENTS = {
  schema: { id: "schema", label: "结构一致性校验", hint: "检查各方字段和格式一致" },
  ecdh: { id: "ecdh-psi", label: "ECDH-PSI", hint: "通信量低，适合百万级以内样本或带宽受限" },
  rr22: { id: "rr22-psi", label: "RR22-PSI", hint: "计算更快，适合千万级以上样本，通信量较大" },
} as const;

const SHARING = {
  lora: { id: "lora", label: "LoRA", hint: "冻结基座，只训练和交换低秩适配器" },
  qlora: { id: "qlora", label: "QLoRA", hint: "4-bit 量化基座 + LoRA，显存需求更低" },
  full: { id: "full", label: "全量参数", hint: "每轮交换完整模型参数" },
  trees: { id: "trees", label: "树集成", hint: "每轮交换各方本地新增的树" },
  sharded: { id: "sharded", label: "分片持有", hint: "各方只持有自身特征对应的模型部分" },
} as const;

const PARAMETRIC_FAMILIES: readonly ModelFamily[] = ["cnn", "mlp", "linear", "llm"];

const AGGREGATIONS = {
  fedavg: { id: "fedavg", label: "FedAvg", hint: "按样本量加权平均，最常用的基线" },
  fedprox: { id: "fedprox", label: "FedProx", hint: "本地目标加近端项，适合各方数据分布差异大" },
  fedadam: { id: "fedadam", label: "FedAdam", hint: "服务端自适应优化，收敛更稳" },
  bagging: { id: "xgb-bagging", label: "XGBoost Bagging", hint: "各方本地训练的树合并为一个集成模型" },
  sgb: { id: "sgb-protocol", label: "SecureBoost 协议", hint: "标签方加密梯度，特征方计算分裂统计，标签方选择最佳分裂" },
  sslr: { id: "sslr-protocol", label: "SS-LR 协议", hint: "梯度在秘密分享状态下计算，任何一方都看不到明文" },
  sum: { id: "sum", label: "求和聚合", hint: "汇总各方计数与求和，重算全局比例、均值和方差" },
  memory: { id: "dedup-arbitration", label: "去重与冲突仲裁", hint: "按语义去重，冲突条目由 Agent 审阅后保留一致的版本" },
} as const;

const CRYPTO = {
  ou: { id: "ou", label: "OU 同态加密", hint: "性能约为 Paillier 的 3–4 倍，内存占用约减半" },
  paillier: { id: "paillier", label: "Paillier 同态加密", hint: "经典加法同态，兼容性最好" },
  ss: { id: "secret-sharing", label: "秘密分享（SPU）", hint: "基于多方安全计算的秘密分享" },
} as const;

const EVALUATIONS = {
  local: { id: "local", label: "各方本地验证", hint: "各方用本地验证集评估全局模型，平台汇总指标" },
  holdout: { id: "holdout", label: "平台独立测试集", hint: "发起方提供测试集，在平台沙箱中评估" },
  baseline: { id: "baseline", label: "与单方基线对比", hint: "对比各方单独训练的模型，确认联邦带来提升" },
  labelParty: { id: "label-party", label: "标签方验证", hint: "标签方在验证集上计算 AUC、KS" },
  singleParty: { id: "single-party", label: "与标签方单方模型对比", hint: "对比标签方只用自身特征训练的模型" },
  consistency: { id: "consistency", label: "一致性校验", hint: "核对分组结构、总数与各方提交是否一致" },
  replay: { id: "replay", label: "沙箱任务回放", hint: "用合并后的记忆回放一组测试任务，对比成功率" },
} as const;

export const DELIVERY_SCOPES: readonly Choice[] = [
  { id: "initiator", label: "仅发起方" },
  { id: "all", label: "全部参与方" },
  { id: "selected", label: "指定参与方", hint: "交付时由发起方勾选" },
];

/* 便捷函数。 */

const available = (choice: Choice): Candidate => ({ choice, available: true });
const when = (choice: Choice, ok: boolean): Candidate => ({ choice, available: ok });
const option = (id: string, label: string, hint?: string): Choice => ({ id, label, hint });

const scenario = (selection: Selection) => scenarioOf(selection.scenario);
const usesNodes = (selection: Selection) => scenario(selection)?.input === "nodes";
const family = (selection: Selection) => modelOf(selection.model)?.family;
const isScenario = (selection: Selection, id: string) => selection.scenario === id;
const isHorizontal = (selection: Selection) => isScenario(selection, "horizontal-training");
const isVertical = (selection: Selection) => isScenario(selection, "vertical-training");

export const ITEMS: readonly ItemDefinition[] = [
  {
    id: "scenario",
    dimension: 1,
    code: "1",
    title: () => "协作场景",
    display: "cards",
    candidates: () => SCENARIOS.map(available),
  },

  {
    id: "partyScale",
    dimension: 2,
    code: "2.1",
    title: () => "参与方数量",
    display: "chips",
    candidates: (s) => (s.scenario ? PARTY_SCALES.map(available) : null),
    preferred: (s) => (isVertical(s) ? "2" : "3-5"),
  },
  {
    id: "deployment",
    dimension: 2,
    code: "2.2",
    title: (s) => (usesNodes(s) ? "我方部署位置" : "执行位置"),
    display: "chips",
    candidates: (s) => {
      if (!s.scenario) return null;
      return usesNodes(s)
        ? DEPLOYMENTS.filter((item) => item.id !== "hosted").map(available)
        : DEPLOYMENTS.filter((item) => item.id === "hosted").map(available);
    },
    preferred: () => "aliyun",
  },
  {
    id: "compute",
    dimension: 2,
    code: "2.3",
    title: () => "节点算力规格（每方最低）",
    display: "cards",
    candidates: (s) => (usesNodes(s) ? COMPUTE_SPECS.map(available) : null),
    preferred: (s) => (isVertical(s) ? "cpu-compute" : "gpu-24"),
  },
  {
    id: "network",
    dimension: 2,
    code: "2.4",
    title: () => "网络",
    display: "chips",
    candidates: (s) => (usesNodes(s) ? NETWORKS.map(available) : null),
    preferred: (s) => (isVertical(s) ? "leased" : "public"),
  },

  {
    id: "dataAccess",
    dimension: 3,
    code: "3.1",
    title: () => "数据接入方式",
    display: "cards",
    candidates: (s) => (s.scenario ? [available(usesNodes(s) ? DATA_ACCESS.nodes : DATA_ACCESS.files)] : null),
  },
  {
    id: "dataType",
    dimension: 3,
    code: "3.2",
    title: () => "数据类型",
    display: "cards",
    candidates: (s) => (s.scenario
      ? DATA_TYPES.filter((type) => type.scenario === s.scenario).map((type) => when(type, satisfies(computeOf(s.compute), type.requirement) || !usesNodes(s)))
      : null),
    preferred: (s) => (isHorizontal(s) ? "instruction" : undefined),
  },
  {
    id: "alignment",
    dimension: 3,
    code: "3.3",
    title: () => "样本对齐",
    display: "cards",
    candidates: (s) => {
      if (!s.scenario) return null;
      return isVertical(s) ? [available(ALIGNMENTS.ecdh), available(ALIGNMENTS.rr22)] : [available(ALIGNMENTS.schema)];
    },
  },

  {
    id: "model",
    dimension: 4,
    code: "4.1",
    title: (s) => (isScenario(s, "federated-analytics") ? "分析类型" : isScenario(s, "agent-memory") ? "合并对象" : "模型"),
    display: "cards",
    candidates: (s) => (s.scenario
      ? MODELS.filter((model) => model.scenario === s.scenario && model.dataType === s.dataType)
        .map((model) => when(model, satisfies(computeOf(s.compute), model.requirement) || !usesNodes(s)))
      : null),
  },
  {
    id: "sharing",
    dimension: 4,
    code: "4.2",
    title: () => "参数共享方式",
    display: "cards",
    candidates: (s) => {
      if (isVertical(s)) return [available(SHARING.sharded)];
      if (!isHorizontal(s)) return null;
      const model = modelOf(s.model);
      if (model?.peft) {
        const gpu = computeOf(s.compute)?.gpuGb ?? 0;
        return [when(SHARING.lora, gpu >= model.peft.lora), when(SHARING.qlora, gpu >= model.peft.qlora)];
      }
      return [available(model?.family === "tree" ? SHARING.trees : SHARING.full)];
    },
  },

  {
    id: "aggregation",
    dimension: 5,
    code: "5.1",
    title: (s) => (isScenario(s, "agent-memory") ? "合并方式" : isScenario(s, "federated-analytics") ? "聚合方式" : "聚合算法"),
    display: "cards",
    candidates: (s) => {
      const kind = family(s);
      if (!kind) return null;
      if (PARAMETRIC_FAMILIES.includes(kind)) return [AGGREGATIONS.fedavg, AGGREGATIONS.fedprox, AGGREGATIONS.fedadam].map(available);
      if (kind === "tree") return [available(AGGREGATIONS.bagging)];
      if (kind === "vertical-tree") return [available(AGGREGATIONS.sgb)];
      if (kind === "vertical-linear") return [available(AGGREGATIONS.sslr)];
      if (kind === "stats") return [available(AGGREGATIONS.sum)];
      return [available(AGGREGATIONS.memory)];
    },
  },
  {
    id: "rounds",
    dimension: 5,
    code: "5.2",
    title: (s) => {
      const kind = family(s);
      if (kind === "vertical-tree") return "树数量";
      if (kind === "vertical-linear") return "迭代次数";
      return usesNodes(s) ? "训练轮次" : "执行轮次";
    },
    display: "chips",
    candidates: (s) => {
      const kind = family(s);
      if (!kind) return null;
      if (kind === "vertical-tree") return ["50", "100", "200"].map((n) => available(option(n, `${n} 棵`)));
      if (kind === "vertical-linear") return ["20", "50", "100"].map((n) => available(option(n, `${n} 次`)));
      if (!usesNodes(s)) return [available(option("1", "单轮"))];
      return ["10", "20", "50"].map((n) => available(option(n, `${n} 轮`)));
    },
    preferred: (s) => {
      const kind = family(s);
      if (kind === "vertical-tree") return "100";
      if (kind === "vertical-linear") return "50";
      return kind === "llm" ? "10" : "20";
    },
  },
  {
    id: "sampling",
    dimension: 5,
    code: "5.3",
    title: () => "每轮参与比例",
    display: "chips",
    candidates: (s) => (isHorizontal(s)
      ? [available(option("all", "全部参与方")), when(option("half", "每轮抽样 50%", "参与方较多时缩短每轮耗时"), s.partyScale !== "2")]
      : null),
  },
  {
    id: "localEpochs",
    dimension: 5,
    code: "5.4",
    title: (s) => (family(s) === "tree" ? "每轮本地新增树" : "每轮本地训练"),
    display: "chips",
    candidates: (s) => {
      if (!isHorizontal(s)) return null;
      const unit = family(s) === "tree" ? "棵" : "个 epoch";
      return ["1", "2", "5"].map((n) => available(option(n, `${n} ${unit}`)));
    },
  },

  {
    id: "baseline",
    dimension: 6,
    code: "6.1",
    title: () => "基础安全",
    display: "cards",
    candidates: (s) => (s.scenario ? [available(option("baseline", "mTLS · 隔离沙箱 · 审计日志", "传输加密、计算隔离、全程留痕，所有项目默认启用"))] : null),
  },
  {
    id: "secagg",
    dimension: 6,
    code: "6.2",
    title: () => "安全聚合",
    display: "chips",
    candidates: (s) => (isHorizontal(s)
      ? [
        available(option("off", "关闭")),
        when(option("secagg-plus", "SecAgg+", "协调方只能看到聚合结果，看不到单方更新（需 ≥3 方）"), s.partyScale !== "2" && family(s) !== "tree"),
      ]
      : null),
  },
  {
    id: "dp",
    dimension: 6,
    code: "6.3",
    title: () => "差分隐私",
    display: "chips",
    candidates: (s) => {
      if (!isHorizontal(s) && !isScenario(s, "federated-analytics")) return null;
      const supported = family(s) !== "tree";
      return [
        available(option("off", "关闭")),
        when(option("8", "ε = 8", "保护较弱，对结果影响很小"), supported),
        when(option("3", "ε = 3", "中等强度，常用的折中"), supported),
        when(option("1", "ε = 1", "保护较强，结果误差可能明显增大"), supported),
      ];
    },
  },
  {
    id: "crypto",
    dimension: 6,
    code: "6.4",
    title: () => "加密计算",
    display: "cards",
    candidates: (s) => {
      if (!isVertical(s)) return null;
      return family(s) === "vertical-linear" ? [available(CRYPTO.ss)] : [available(CRYPTO.ou), available(CRYPTO.paillier)];
    },
  },
  {
    id: "outputProtection",
    dimension: 6,
    code: "6.5",
    title: (s) => (isScenario(s, "federated-analytics") ? "最小分组阈值" : "输出保护"),
    display: "chips",
    candidates: (s) => {
      if (isScenario(s, "federated-analytics")) {
        return ["5", "10", "20"].map((n) => available(option(n, `小于 ${n} 条不公布`, "样本数低于阈值的分组在报告中隐藏")));
      }
      if (isScenario(s, "agent-memory")) return [available(option("redact", "敏感信息脱敏", "自动识别并移除账号、密钥、手机号等个人信息"))];
      return null;
    },
    preferred: () => "10",
  },

  {
    id: "evaluation",
    dimension: 7,
    code: "7.1",
    title: () => "评测方式",
    display: "cards",
    candidates: (s) => {
      if (isHorizontal(s)) return [EVALUATIONS.local, EVALUATIONS.holdout, EVALUATIONS.baseline].map(available);
      if (isVertical(s)) return [EVALUATIONS.labelParty, EVALUATIONS.singleParty].map(available);
      if (isScenario(s, "federated-analytics")) return [available(EVALUATIONS.consistency)];
      if (isScenario(s, "agent-memory")) return [available(EVALUATIONS.replay)];
      return null;
    },
  },
  {
    id: "deliverable",
    dimension: 7,
    code: "7.2",
    title: () => "交付物",
    display: "cards",
    candidates: (s) => {
      if (!s.scenario) return null;
      const kind = family(s);
      if (kind === "llm") return [available(option("adapter", "LoRA Adapter", "只含适配器权重，与基座模型配合使用"))];
      if (kind === "tree") return [available(option("xgb-model", "全局 XGBoost 模型"))];
      if (isHorizontal(s)) return [available(option("weights", "全局模型权重"))];
      if (isVertical(s)) return [available(option("sharded-model", "分片联合模型", "各方各持一份，预测时需要各方共同计算"))];
      if (isScenario(s, "federated-analytics")) return [available(option("report", "统计报告"))];
      return [available(option("memory-file", "合并后的记忆文件"))];
    },
  },
  {
    id: "deliveryScope",
    dimension: 7,
    code: "7.3",
    title: () => "交付范围",
    display: "chips",
    candidates: (s) => (s.scenario ? DELIVERY_SCOPES.map(available) : null),
    preferred: () => "all",
  },
];

export const ITEM_IDS: readonly ItemId[] = ITEMS.map((item) => item.id);

export function itemOf(id: ItemId): ItemDefinition {
  const item = ITEMS.find((entry) => entry.id === id);
  if (!item) throw new Error(`unknown item ${id}`);
  return item;
}
