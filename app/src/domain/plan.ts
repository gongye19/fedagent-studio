/**
 * 由 7 个维度的选择推导出的前端运行计划。
 *
 * FrontendRunPlan 是后端 RunSpec 的前身：不可变、可展示、只描述"要做什么"。
 * 执行框架、执行模式、交换对象、资源与耗时预估由平台推导，不让用户选；
 * 所有场景共用同一份计划格式，差异只落在各字段的取值上。
 */
import { DIMENSIONS, minParties, PARTY_SCALES, type DimensionId } from "./dimensions";
import { isComplete, valueLabel, visibleItems, type Selection } from "./selection";
import {
  COMPUTE_KIND_LABEL,
  INPUT_KIND_LABEL,
  PATTERN_LABEL,
  combinedAdoption,
  computeOf,
  dataTypeOf,
  modelOf,
  scenarioOf,
  type Adoption,
  type ComputeKind,
  type ExecutionPattern,
  type InputKind,
  type ModelFamily,
  type ScenarioId,
} from "./taxonomy";

export type ConfigRow = { code: string; title: string; value: string; locked: boolean };
export type ConfigGroup = { dimension: DimensionId; title: string; rows: ConfigRow[] };

/** 配置清单：7 个维度下当前显示的子项及其取值，订单摘要、项目配置页和邀请页共用。 */
export function configGroups(selection: Selection): ConfigGroup[] {
  if (!selection.scenario) return [];
  return DIMENSIONS.map((dimension) => ({
    dimension: dimension.id,
    title: dimension.title,
    rows: visibleItems(dimension.id, selection).map((state) => ({
      code: state.item.code,
      title: state.title,
      value: valueLabel(state.item.id, selection) ?? "—",
      locked: state.mode === "locked",
    })),
  }));
}

export type ExecutionLocations = {
  controlPlane: string;
  coordinator: string;
  participantWorker: string;
  evaluator: string;
};

export type Estimate = {
  resources: string;
  duration: string;
  consumption: string;
};

export type FrontendRunPlan = {
  schemaVersion: "frontend.run-plan/v2";
  simulated: true;
  selection: Selection;
  groups: ConfigGroup[];
  scenario: { id: ScenarioId; label: string; inputKind: InputKind; inputKindLabel: string };
  runner: string;
  pattern: ExecutionPattern;
  patternLabel: string;
  model: { id: string; label: string; family: ModelFamily };
  sharing: string | null;
  exchanged: string;
  computeKind: ComputeKind;
  computeKindLabel: string;
  aggregation: string;
  rounds: { value: number; label: string; title: string };
  requirements: {
    minParties: number;
    partyScale: string;
    compute: { id: string; label: string; hint: string } | null;
    network: string | null;
    deployment: string;
    dataType: { id: string; label: string };
    alignment: string;
  };
  security: { mechanisms: string[]; secagg: boolean; dp: string | null };
  evaluation: { id: string; label: string };
  deliverable: string;
  deliveryScope: { id: string; label: string };
  locations: ExecutionLocations;
  estimate: Estimate;
  metricsKey: string;
  adoption: Adoption;
  warnings: string[];
};

const LOCATIONS: Record<ExecutionPattern, Omit<ExecutionLocations, "controlPlane">> = {
  iterative: {
    coordinator: "平台上的 Flower SuperLink + ServerApp（按聚合算法合并）",
    participantWorker: "各参与方节点上的 Flower SuperNode，本地运行 ClientApp 训练",
    evaluator: "各方本地验证 + 平台独立评测沙箱",
  },
  "vertical-protocol": {
    coordinator: "平台上的隐语调度服务（协调隐私求交和训练步骤）",
    participantWorker: "各参与方节点上的隐语运行时（标签方 + 特征方）",
    evaluator: "标签方本地验证",
  },
  "aggregate-once": {
    coordinator: "平台隔离沙箱中的统计服务",
    participantWorker: "不需要常驻节点（各方上传汇总表）",
    evaluator: "平台一致性检查",
  },
  "merge-once": {
    coordinator: "平台隔离沙箱中的记忆合并服务",
    participantWorker: "不需要常驻节点（各方上传记忆文件）",
    evaluator: "平台回放评测沙箱",
  },
};

function exchangedFor(family: ModelFamily): string {
  switch (family) {
    case "llm":
      return "LoRA 增量";
    case "tree":
      return "本轮新增的树";
    case "vertical-tree":
      return "加密梯度与分裂统计";
    case "vertical-linear":
      return "秘密分享的梯度分片";
    case "stats":
      return "分组计数与求和";
    case "memory":
      return "脱敏后的记忆条目";
    default:
      return "模型参数增量";
  }
}

function computeKindFor(family: ModelFamily): ComputeKind {
  if (family === "tree") return "ensemble";
  if (family === "vertical-tree" || family === "vertical-linear") return "protocol";
  if (family === "memory") return "content";
  return "additive";
}

function metricsKeyFor(scenario: ScenarioId, family: ModelFamily): string {
  if (scenario === "horizontal-training") return family === "llm" ? "horizontal:llm" : family === "cnn" ? "horizontal:image" : "horizontal:table";
  return scenario;
}

/* 资源与耗时预估：按模型、轮次和保护机制粗略估算，只用于订单摘要中的量级参考。 */

const round1 = (value: number) => Math.round(value * 10) / 10;

export function formatMinutes([low, high]: readonly [number, number]): string {
  if (high < 90) return `约 ${Math.max(1, Math.round(low))}–${Math.max(2, Math.round(high))} 分钟`;
  return `约 ${round1(low / 60)}–${round1(high / 60)} 小时`;
}

function durationMinutes(selection: Selection): [number, number] {
  const model = modelOf(selection.model);
  const rounds = Number(selection.rounds ?? 1);
  switch (model?.family) {
    case "vertical-tree": {
      const psi: [number, number] = selection.alignment === "rr22-psi" ? [2, 6] : [5, 15];
      const factor = selection.crypto === "paillier" ? 3 : 1;
      return [psi[0] + rounds * 0.15 * factor, psi[1] + rounds * 0.4 * factor];
    }
    case "vertical-linear": {
      const psi: [number, number] = selection.alignment === "rr22-psi" ? [2, 6] : [5, 15];
      return [psi[0] + rounds * 0.1, psi[1] + rounds * 0.25];
    }
    case "stats":
      return [1, 5];
    case "memory":
      return [2, 10];
    default: {
      const [low, high] = model?.perRoundMinutes ?? [1, 3];
      const epochs = Number(selection.localEpochs ?? 1);
      let factor = epochs;
      if (selection.sampling === "half") factor *= 0.6;
      if (selection.secagg === "secagg-plus") factor *= 1.3;
      if (selection.sharing === "qlora") factor *= 1.3;
      return [3 + rounds * low * factor, 8 + rounds * high * factor];
    }
  }
}

export function estimate(selection: Selection): Estimate {
  const scenario = scenarioOf(selection.scenario);
  const minutes = durationMinutes(selection);
  const duration = formatMinutes(minutes);
  if (scenario?.input !== "nodes") {
    return { resources: "平台托管", duration, consumption: "平台托管，不占用参与方资源" };
  }
  const spec = computeOf(selection.compute);
  const parties = minParties(selection.partyScale);
  const unit = spec && spec.gpuGb > 0 ? "GPU·时" : "CPU 节点·时";
  const low = round1((minutes[0] / 60) * parties);
  const high = round1((minutes[1] / 60) * parties);
  return {
    resources: `每方 1 个节点 · ${spec?.label ?? "—"}`,
    duration,
    consumption: `约 ${Math.max(0.1, low)}–${Math.max(0.1, high)} ${unit}（按 ${parties} 方计）`,
  };
}

function securityMechanisms(selection: Selection): string[] {
  const mechanisms = ["mTLS", "隔离沙箱", "审计日志"];
  if (selection.alignment === "ecdh-psi") mechanisms.push("ECDH-PSI");
  if (selection.alignment === "rr22-psi") mechanisms.push("RR22-PSI");
  const crypto = valueLabel("crypto", selection);
  if (crypto) mechanisms.push(crypto);
  if (selection.secagg === "secagg-plus") mechanisms.push("SecAgg+");
  if (selection.dp && selection.dp !== "off") mechanisms.push(`差分隐私 ε = ${selection.dp}`);
  if (selection.scenario === "federated-analytics") mechanisms.push(`最小分组阈值 ${selection.outputProtection}`);
  if (selection.outputProtection === "redact") mechanisms.push("敏感信息脱敏");
  return mechanisms;
}

function warningsFor(selection: Selection): string[] {
  const warnings: string[] = [];
  const dp = selection.dp && selection.dp !== "off";
  if (dp && minParties(selection.partyScale) <= 3) warnings.push("参与方较少时，差分隐私噪声对结果的影响会比较明显");
  if (selection.dp === "1") warnings.push("ε = 1 保护较强，模型精度或统计误差可能明显变差");
  if (selection.scenario === "vertical-training" && selection.network === "public") {
    warnings.push("纵向协议每一步都要交换加密中间结果，公网带宽可能成为瓶颈，建议专线");
  }
  if (selection.sharing === "qlora") warnings.push("QLoRA 使用 4-bit 量化基座，精度可能略低于 LoRA");
  return warnings;
}

/** 场景选定后生成计划；未选场景时返回 null。 */
export function buildRunPlan(selection: Selection): FrontendRunPlan | null {
  if (!isComplete(selection)) return null;
  const scenario = scenarioOf(selection.scenario);
  const model = modelOf(selection.model);
  const dataType = dataTypeOf(selection.dataType);
  if (!scenario || !model || !dataType) return null;

  const spec = computeOf(selection.compute);
  const sharingChoice = selection.sharing === "lora" || selection.sharing === "qlora" ? "frontier" : undefined;

  return {
    schemaVersion: "frontend.run-plan/v2",
    simulated: true,
    selection: { ...selection },
    groups: configGroups(selection),
    scenario: { id: scenario.id, label: scenario.label, inputKind: scenario.input, inputKindLabel: INPUT_KIND_LABEL[scenario.input] },
    runner: scenario.runner,
    pattern: scenario.pattern,
    patternLabel: PATTERN_LABEL[scenario.pattern],
    model: { id: model.id, label: model.label, family: model.family },
    sharing: valueLabel("sharing", selection) ?? null,
    exchanged: exchangedFor(model.family),
    computeKind: computeKindFor(model.family),
    computeKindLabel: COMPUTE_KIND_LABEL[computeKindFor(model.family)],
    aggregation: valueLabel("aggregation", selection) ?? "—",
    rounds: {
      value: Number(selection.rounds ?? 1),
      label: valueLabel("rounds", selection) ?? "单轮",
      title: visibleItems(5, selection).find((state) => state.item.id === "rounds")?.title ?? "轮次",
    },
    requirements: {
      minParties: minParties(selection.partyScale),
      partyScale: PARTY_SCALES.find((item) => item.id === selection.partyScale)?.label ?? "—",
      compute: spec ? { id: spec.id, label: spec.label, hint: spec.hint } : null,
      network: valueLabel("network", selection) ?? null,
      deployment: valueLabel("deployment", selection) ?? "—",
      dataType: { id: dataType.id, label: dataType.label },
      alignment: valueLabel("alignment", selection) ?? "—",
    },
    security: {
      mechanisms: securityMechanisms(selection),
      secagg: selection.secagg === "secagg-plus",
      dp: selection.dp && selection.dp !== "off" ? `ε = ${selection.dp}` : null,
    },
    evaluation: { id: selection.evaluation ?? "", label: valueLabel("evaluation", selection) ?? "—" },
    deliverable: valueLabel("deliverable", selection) ?? "—",
    deliveryScope: { id: selection.deliveryScope ?? "all", label: valueLabel("deliveryScope", selection) ?? "全部参与方" },
    locations: { controlPlane: "Federation Studio 控制面", ...LOCATIONS[scenario.pattern] },
    estimate: estimate(selection),
    metricsKey: metricsKeyFor(scenario.id, model.family),
    adoption: combinedAdoption(scenario.adoption, model.adoption, sharingChoice),
    warnings: warningsFor(selection),
  };
}
