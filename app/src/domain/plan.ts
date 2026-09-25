/**
 * 由维度选择推导出的前端运行计划。
 *
 * FrontendRunPlan 是后端 RunSpec 的前身：不可变、可展示、只描述"要做什么"。
 * 联邦对象、执行模式、输入接入方式、runner、评测和输出都由平台推导，不让用户选。
 */
import {
  COMPUTE_KIND_LABEL,
  INPUT_KIND_LABEL,
  PATTERN_LABEL,
  SHARING_MODES,
  enhancementOf,
  strategyOf,
  combinedAdoption,
  type ComputeKind,
  type ExecutionPattern,
  type InputKind,
  type Adoption,
  type ScenarioId,
} from "./taxonomy";
import {
  LAYERS,
  builtinProtection,
  exchangedFor,
  isComplete,
  isLayerVisible,
  layerOptions,
  paramsFor,
  scenarioFor,
  type Selection,
} from "./selection";

export type ExecutionLocations = {
  controlPlane: string;
  coordinator: string;
  participantWorker: string;
  evaluator: string;
};

export type FrontendRunPlan = {
  schemaVersion: "frontend.run-plan/v1";
  simulated: true;
  scenario: { id: ScenarioId; label: string; inputKindLabel: string };
  /** 演示指标的键：场景，或 场景:peft。 */
  metricsKey: string;
  path: { title: string; value: string }[];
  strategy: { id: string; label: string };
  pattern: ExecutionPattern;
  patternLabel: string;
  exchanged: string;
  computeKind: ComputeKind;
  computeKindLabel: string;
  /** 维度 3：内置保护 + 已选增强；mechanisms 为两者合并后的机制清单。 */
  security: { builtin: string[]; enhancements: { id: string; label: string }[]; mechanisms: string[] };
  runner: string;
  references: string[];
  input: { kind: InputKind; label: string };
  locations: ExecutionLocations;
  evaluation: string;
  output: string;
  minParticipants: number;
  adoption: Adoption;
  params: { id: string; label: string; value: string; valueLabel: string }[];
  warnings: string[];
};

const LOCATIONS: Record<ExecutionPattern, Omit<ExecutionLocations, "controlPlane">> = {
  iterative: {
    coordinator: "平台上的 Flower SuperLink + ServerApp（按策略合并）",
    participantWorker: "各参与方的 Flower SuperNode，本地运行 ClientApp 训练",
    evaluator: "各方本地验证 + 平台独立评测沙箱",
  },
  "vertical-protocol": {
    coordinator: "平台上的 NVFlare 服务端（协调求交和训练步骤）",
    participantWorker: "各参与方的 NVFlare 客户端（标签方 + 特征方）",
    evaluator: "标签方本地验证",
  },
  "aggregate-once": {
    coordinator: "平台沙箱中的统计服务",
    participantWorker: "不需要常驻节点（各方上传汇总表）",
    evaluator: "平台一致性检查",
  },
  "merge-once": {
    coordinator: "平台沙箱中的记忆合并器",
    participantWorker: "不需要常驻节点（各方上传记忆文件）",
    evaluator: "平台回放评测沙箱",
  },
};
/** 已经能推导出的部分，供右侧面板在选择过程中实时展示。 */
export type PlanPreview = {
  scenario?: string;
  pattern?: string;
  exchanged?: string;
  computeKind?: string;
  runner?: string;
  mechanisms?: string[];
};

export function planPreview(selection: Selection): PlanPreview {
  const scenario = scenarioFor(selection);
  if (!scenario) return {};
  const preview: PlanPreview = {
    scenario: scenario.label,
    pattern: PATTERN_LABEL[scenario.pattern],
  };
  const strategy = strategyOf(selection.strategy);
  if (strategy) {
    preview.exchanged = exchangedFor(selection);
    preview.computeKind = COMPUTE_KIND_LABEL[strategy.computeKind];
    preview.runner = strategy.runner;
  }
  preview.mechanisms = securityMechanisms(selection);
  return preview;
}

function securityMechanisms(selection: Selection): string[] {
  const added = selection.enhancements.flatMap((id) => enhancementOf(id)?.mechanisms ?? []);
  return [...builtinProtection(selection), ...added];
}

function selectedLabel(selection: Selection, id: (typeof LAYERS)[number]["id"]): string {
  return layerOptions(id, selection).find((option) => option.choice.id === selection[id])?.choice.label ?? "";
}

/** 维度全部答完才生成计划；否则返回 null。 */
export function buildRunPlan(selection: Selection): FrontendRunPlan | null {
  if (!isComplete(selection)) return null;
  const scenario = scenarioFor(selection);
  const strategy = strategyOf(selection.strategy);
  if (!scenario || !strategy) return null;
  const pattern = scenario.pattern;

  const warnings: string[] = [];
  for (const layer of LAYERS) {
    if (!isLayerVisible(layer.id, selection)) continue;
    const option = layerOptions(layer.id, selection).find((item) => item.choice.id === selection[layer.id]);
    if (option?.warning) warnings.push(option.warning);
  }
  for (const id of selection.enhancements) {
    const caution = enhancementOf(id)?.caution;
    if (caution) warnings.push(caution);
  }
  // LoRA 属于大模型方法，和场景、策略一起决定整体是否前沿。
  const sharing = SHARING_MODES.find((mode) => mode.id === selection.sharing);
  const adoption = combinedAdoption(scenario.adoption, strategy.adoption, sharing?.adoption ?? "mainstream");

  return {
    schemaVersion: "frontend.run-plan/v1",
    simulated: true,
    scenario: { id: scenario.id, label: scenario.label, inputKindLabel: INPUT_KIND_LABEL[scenario.input.kind] },
    metricsKey: selection.sharing === "peft" ? `${scenario.id}:peft` : scenario.id,
    path: LAYERS
      .filter((layer) => isLayerVisible(layer.id, selection))
      .map((layer) => ({ title: layer.title, value: selectedLabel(selection, layer.id) })),
    strategy: { id: strategy.id, label: strategy.label },
    pattern,
    patternLabel: PATTERN_LABEL[pattern],
    exchanged: exchangedFor(selection) ?? strategy.exchanged,
    computeKind: strategy.computeKind,
    computeKindLabel: COMPUTE_KIND_LABEL[strategy.computeKind],
    security: {
      builtin: builtinProtection(selection),
      enhancements: selection.enhancements.map((id) => ({ id, label: enhancementOf(id)?.label ?? id })),
      mechanisms: securityMechanisms(selection),
    },
    runner: strategy.runner,
    references: [...strategy.references],
    input: { ...scenario.input },
    locations: { controlPlane: "Federation Studio 控制面", ...LOCATIONS[pattern] },
    evaluation: scenario.evaluation,
    output: scenario.output(selection),
    minParticipants: scenario.minParticipants,
    adoption,
    params: paramsFor(selection).map((param) => {
      const value = selection.params[param.id] ?? param.defaultValue;
      return {
        id: param.id,
        label: param.label,
        value,
        valueLabel: param.options.find((option) => option.id === value)?.label ?? value,
      };
    }),
    warnings,
  };
}
