/**
 * 由维度选择推导出的前端运行计划。
 *
 * FrontendRunPlan 是后端 RunSpec 的前身：不可变、可展示、只描述"要做什么"。
 * 联邦对象、执行模式、输入接入方式、runner、评测和输出都由平台推导，不让用户选。
 */
import {
  COMPUTE_KIND_LABEL,
  PATTERN_LABEL,
  SCENARIO_GROUP_LABEL,
  protectionOf,
  strategyOf,
  combinedAdoption,
  type ComputeKind,
  type ExecutionPattern,
  type InputKind,
  type Adoption,
  type ScenarioGroup,
  type ScenarioId,
} from "./taxonomy";
import {
  LAYERS,
  isComplete,
  isLayerVisible,
  layerOptions,
  paramsFor,
  protectionContext,
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
  scenario: { id: ScenarioId; label: string; group: ScenarioGroup; groupLabel: string };
  path: { title: string; value: string }[];
  strategy: { id: string; label: string };
  pattern: ExecutionPattern;
  patternLabel: string;
  exchanged: string;
  computeKind: ComputeKind;
  computeKindLabel: string;
  protection: { id: string; label: string; mechanisms: string[] };
  runner: string;
  references: string[];
  input: { kind: InputKind; label: string; accept?: string };
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
    coordinator: "平台沙箱中的聚合器",
    participantWorker: "各参与方本地训练节点",
    evaluator: "各方本地评估 + 平台独立评测沙箱",
  },
  "single-round": {
    coordinator: "平台沙箱中的聚合服务",
    participantWorker: "各参与方本地计算节点",
    evaluator: "平台一致性检查",
  },
  "vertical-protocol": {
    coordinator: "平台沙箱中的协议协调方（Arbiter）",
    participantWorker: "Guest / Host 本地节点",
    evaluator: "标签方本地验证",
  },
  "artifact-processing": {
    coordinator: "平台沙箱中的合并器",
    participantWorker: "不需要常驻节点（产物进入隔离 staging）",
    evaluator: "平台独立评测沙箱",
  },
  "query-time": {
    coordinator: "平台沙箱中的查询路由与融合服务",
    participantWorker: "各方本地检索服务",
    evaluator: "平台评测沙箱（检索与答案质量）",
  },
  "evaluation-only": {
    coordinator: "平台沙箱中的评测调度",
    participantWorker: "各方本地评测节点或模型 Endpoint",
    evaluator: "平台汇总与报告检查",
  },
};

/** 已经能推导出的部分，供右侧面板在选择过程中实时展示。 */
export type PlanPreview = {
  scenario?: string;
  adoption?: Adoption;
  pattern?: string;
  exchanged?: string;
  computeKind?: string;
  runner?: string;
  references?: string[];
  mechanisms?: string[];
};

export function planPreview(selection: Selection): PlanPreview {
  const scenario = scenarioFor(selection);
  if (!scenario) return {};
  const preview: PlanPreview = {
    scenario: scenario.label,
    adoption: scenario.adoption,
    pattern: PATTERN_LABEL[scenario.pattern(selection)],
  };
  const strategy = strategyOf(selection.strategy);
  if (strategy) {
    preview.adoption = combinedAdoption(scenario.adoption, strategy.adoption);
    preview.exchanged = strategy.exchanged;
    preview.computeKind = COMPUTE_KIND_LABEL[strategy.computeKind];
    preview.runner = strategy.runner;
    preview.references = [...strategy.references];
  }
  const protection = protectionOf(selection.protection);
  if (protection) {
    preview.mechanisms = [...protection.mechanisms];
  }
  return preview;
}

function selectedLabel(selection: Selection, id: (typeof LAYERS)[number]["id"]): string {
  return layerOptions(id, selection).find((option) => option.choice.id === selection[id])?.choice.label ?? "";
}

/** 维度全部答完才生成计划；否则返回 null。 */
export function buildRunPlan(selection: Selection): FrontendRunPlan | null {
  if (!isComplete(selection)) return null;
  const scenario = scenarioFor(selection);
  const context = protectionContext(selection);
  const protection = protectionOf(selection.protection);
  if (!scenario || !context || !protection) return null;

  const { strategy, pattern } = context;
  const protectionState = protection.check(context);
  if (!protectionState.available) return null;

  const warnings: string[] = [];
  for (const layer of LAYERS) {
    if (!isLayerVisible(layer.id, selection)) continue;
    const option = layerOptions(layer.id, selection).find((item) => item.choice.id === selection[layer.id]);
    if (option?.warning) warnings.push(option.warning);
  }
  const adoption = combinedAdoption(scenario.adoption, strategy.adoption);
  if (adoption === "frontier") warnings.push("包含大模型 / Agent 前沿方法，工具链和最佳实践仍在快速变化");

  return {
    schemaVersion: "frontend.run-plan/v1",
    simulated: true,
    scenario: { id: scenario.id, label: scenario.label, group: scenario.group, groupLabel: SCENARIO_GROUP_LABEL[scenario.group] },
    path: LAYERS
      .filter((layer) => isLayerVisible(layer.id, selection))
      .map((layer) => ({ title: layer.title, value: selectedLabel(selection, layer.id) })),
    strategy: { id: strategy.id, label: strategy.label },
    pattern,
    patternLabel: PATTERN_LABEL[pattern],
    exchanged: strategy.exchanged,
    computeKind: strategy.computeKind,
    computeKindLabel: COMPUTE_KIND_LABEL[strategy.computeKind],
    protection: {
      id: protection.id,
      label: protection.label,
      mechanisms: [...protection.mechanisms],
    },
    runner: strategy.runner,
    references: [...strategy.references],
    input: { ...scenario.input },
    locations: { controlPlane: "Federation Studio 控制面", ...LOCATIONS[pattern] },
    evaluation: scenario.evaluation,
    output: scenario.output,
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
