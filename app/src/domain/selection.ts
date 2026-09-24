/**
 * 逐层选择引擎。
 *
 * 规则：
 * 1. 只有前面的维度约束后面的维度。
 * 2. 不适用的维度自动跳过；上游没答完时，下游不出现。
 * 3. 上游改选后，下游失效的选择被清空；只剩一个可选项时自动选中。
 */
import {
  ARTIFACT_KINDS,
  CONTRIBUTIONS,
  GOALS,
  MODEL_CLASSES,
  PARTITIONS,
  PROTECTIONS,
  SHARING_MODES,
  STRATEGIES,
  TOPOLOGIES,
  matchScenario,
  robustAvailability,
  scenarioOf,
  strategyOf,
  type Availability,
  type Choice,
  type ParamDefinition,
  type ProtectionContext,
  type Scenario,
  type ScenarioId,
} from "./taxonomy";

export type LayerId =
  | "goal"
  | "contribution"
  | "partition"
  | "topology"
  | "modelClass"
  | "sharing"
  | "strategy"
  | "protection";

export type Selection = Record<LayerId, string | null> & {
  robust: boolean;
  params: Record<string, string>;
};

export const EMPTY_SELECTION: Selection = {
  goal: null,
  contribution: null,
  partition: null,
  topology: null,
  modelClass: null,
  sharing: null,
  strategy: null,
  protection: null,
  robust: false,
  params: {},
};

export type LayerDefinition = {
  id: LayerId;
  /** 维度序号，模型类别和共享方式同属维度 5。 */
  step: number;
  title: string;
  question: string;
};

export const LAYERS: readonly LayerDefinition[] = [
  { id: "goal", step: 1, title: "协作目标", question: "想共同完成什么？" },
  { id: "contribution", step: 2, title: "各方投入", question: "每个参与方拿出来的是什么？" },
  { id: "partition", step: 3, title: "数据关系", question: "各方数据怎么分布？" },
  { id: "topology", step: 4, title: "参与方形态", question: "谁参与，规模和稳定性如何？" },
  { id: "modelClass", step: 5, title: "模型形态 · 模型类别", question: "训练什么类型的模型？" },
  { id: "sharing", step: 5, title: "模型形态 · 共享方式", question: "模型怎么在各方之间共享？" },
  { id: "strategy", step: 6, title: "协作策略", question: "用哪种算法协作？" },
  { id: "protection", step: 7, title: "安全与信任", question: "要防谁、保护到什么程度？" },
];

export const PARAMS_STEP = { step: 8, title: "场景参数", question: "策略之外还有哪些可调项？" } as const;

export type OptionState = Availability & { choice: Choice };

export function layerOf(id: LayerId): LayerDefinition {
  return LAYERS.find((layer) => layer.id === id) ?? LAYERS[0];
}

/** 这个维度对当前路径是否有意义。 */
export function layerApplies(id: LayerId, selection: Selection): boolean {
  switch (id) {
    case "partition":
      return selection.contribution === "local-data";
    case "modelClass":
      return selection.goal === "train" && selection.contribution === "local-data";
    case "sharing":
      return selection.goal === "train" && (
        selection.contribution === "trained-artifact"
        || (selection.contribution === "local-data" && selection.partition === "horizontal")
      );
    default:
      return true;
  }
}

function upstreamAnswered(id: LayerId, selection: Selection): boolean {
  for (const layer of LAYERS) {
    if (layer.id === id) return true;
    if (layerApplies(layer.id, selection) && !selection[layer.id]) return false;
  }
  return true;
}

export function isLayerVisible(id: LayerId, selection: Selection): boolean {
  return layerApplies(id, selection) && upstreamAnswered(id, selection);
}

export function visibleLayers(selection: Selection): LayerDefinition[] {
  return LAYERS.filter((layer) => isLayerVisible(layer.id, selection));
}

export function scenarioFor(selection: Selection): Scenario | undefined {
  if (!isLayerVisible("strategy", selection)) return undefined;
  return matchScenario(selection);
}

export function protectionContext(selection: Selection): ProtectionContext | undefined {
  const scenario = scenarioFor(selection);
  const strategy = strategyOf(selection.strategy);
  if (!scenario || !strategy || !selection.topology) return undefined;
  return { scenario, strategy, pattern: scenario.pattern(selection), topology: selection.topology };
}

const ok = (choice: Choice, extra: Omit<Availability, "available"> = {}): OptionState => ({ choice, available: true, ...extra });
const blocked = (choice: Choice, reason: string): OptionState => ({ choice, available: false, reason });

function topologyOptions(selection: Selection): OptionState[] {
  const localHorizontal = selection.contribution === "local-data" && selection.partition === "horizontal";
  const vertical = selection.partition === "vertical";
  return TOPOLOGIES.map((choice) => {
    if (choice.id === "cross-silo") return ok(choice);
    if (vertical) return blocked(choice, "纵向协议需要少量稳定在线的机构节点");
    if (selection.contribution === "trained-artifact") return blocked(choice, "产物聚合在平台沙箱内一次完成，不需要常驻节点");
    if (choice.id === "cross-device") {
      if (localHorizontal && (selection.goal === "train" || selection.goal === "analytics")) return ok(choice);
      return blocked(choice, "端侧设备只支持横向数据上的训练和统计");
    }
    return ok(choice);
  });
}

function sharingOptions(selection: Selection): OptionState[] {
  if (selection.contribution === "trained-artifact") return ARTIFACT_KINDS.map((choice) => ok(choice));
  return SHARING_MODES.map((choice) => {
    if (choice.id === "full") return ok(choice);
    if (selection.modelClass !== "neural") return blocked(choice, "只适用于神经网络");
    if (choice.id === "peft" && selection.topology === "cross-device") {
      return ok(choice, { warning: "端侧设备需要具备本地微调大模型的算力，目前以研究验证为主" });
    }
    return ok(choice);
  });
}

function strategyOptions(selection: Selection): OptionState[] {
  const scenario = scenarioFor(selection);
  if (!scenario) return [];
  return STRATEGIES
    .filter((strategy) => strategy.scenario === scenario.id)
    .filter((strategy) => !strategy.contributions || strategy.contributions.includes(selection.contribution ?? ""))
    .map((strategy) => {
      const classMismatch = strategy.modelClasses && !strategy.modelClasses.includes(selection.modelClass ?? "");
      const sharingMismatch = strategy.sharing && !strategy.sharing.includes(selection.sharing ?? "");
      if (classMismatch || sharingMismatch) return blocked(strategy, strategy.blockedReason ?? "与前面的选择不兼容");
      if (strategy.partitions && !strategy.partitions.includes(selection.partition ?? "")) {
        return blocked(strategy, strategy.partitions.includes("vertical") ? "只适用于纵向数据" : "只适用于横向数据");
      }
      const warning = selection.topology ? strategy.topologyWarnings?.[selection.topology] : undefined;
      return ok(strategy, warning ? { warning } : {});
    });
}

function protectionOptions(selection: Selection): OptionState[] {
  const context = protectionContext(selection);
  if (!context) return [];
  return PROTECTIONS.map((protection) => ({ choice: protection, ...protection.check(context) }));
}

/** 某个维度当前的候选项及可用性。上游没答完时返回空数组。 */
export function layerOptions(id: LayerId, selection: Selection): OptionState[] {
  if (!isLayerVisible(id, selection)) return [];
  switch (id) {
    case "goal":
      return GOALS.map((choice) => ok(choice));
    case "contribution":
      // 与目标无关的投入属于类别错误，直接不列出，而不是置灰。
      return CONTRIBUTIONS.filter((choice) => (choice.goals as readonly string[]).includes(selection.goal ?? "")).map((choice) => ok(choice));
    case "partition":
      return PARTITIONS
        .filter((choice) => selection.goal === "train" || choice.id !== "transfer")
        .map((choice) => (choice.open ? ok(choice) : blocked(choice, "研究阶段，平台暂未开放")));
    case "topology":
      return topologyOptions(selection);
    case "modelClass":
      return MODEL_CLASSES.map((choice) => ok(choice));
    case "sharing":
      return sharingOptions(selection);
    case "strategy":
      return strategyOptions(selection);
    case "protection":
      return protectionOptions(selection);
  }
}

/** 只剩一个可选项时，平台自动选中，界面标注"唯一可选"。 */
export function isAutoSelected(id: LayerId, selection: Selection): boolean {
  return layerOptions(id, selection).filter((option) => option.available).length === 1;
}

export type DisplayOption = { choice: Choice; available: boolean; warning?: string; group?: string };

function candidatesOf(id: LayerId, selection: Selection): { choice: Choice; group?: string }[] {
  switch (id) {
    case "goal":
      return GOALS.map((choice) => ({ choice }));
    case "contribution":
      return CONTRIBUTIONS.map((choice) => ({ choice }));
    case "partition":
      return PARTITIONS.map((choice) => ({ choice }));
    case "topology":
      return TOPOLOGIES.map((choice) => ({ choice }));
    case "modelClass":
      return MODEL_CLASSES.map((choice) => ({ choice }));
    case "sharing":
      return (selection.contribution === "trained-artifact" ? ARTIFACT_KINDS : SHARING_MODES).map((choice) => ({ choice }));
    case "strategy":
      return STRATEGIES.map((strategy) => ({ choice: strategy, group: scenarioOf(strategy.scenario)?.label }));
    case "protection":
      return PROTECTIONS.map((choice) => ({ choice }));
  }
}

/**
 * 界面展示用：每个维度始终列出全部候选项。只有上游已选、且与上游兼容的选项可点，
 * 其余置灰。维度不适用于当前路径时整组置灰。
 */
export function displayOptions(id: LayerId, selection: Selection): DisplayOption[] {
  const states = layerOptions(id, selection);
  return candidatesOf(id, selection).map(({ choice, group }) => {
    const state = states.find((option) => option.choice.id === choice.id);
    return { choice, group, available: Boolean(state?.available), warning: state?.available ? state.warning : undefined };
  });
}

export function paramsFor(selection: Selection): ParamDefinition[] {
  const scenario = scenarioFor(selection);
  if (!scenario) return [];
  return scenario.params.filter((param) => !param.strategies || param.strategies.includes(selection.strategy ?? ""));
}

export function robustState(selection: Selection): Availability {
  const context = protectionContext(selection);
  if (!context) return { available: false, reason: "先完成协作策略" };
  return robustAvailability(context, selection.protection);
}

/** 从上到下重新校验：清掉失效选择，自动选中唯一可选项，补齐参数默认值。 */
export function normalize(selection: Selection): Selection {
  const next: Selection = { ...selection, params: { ...selection.params } };
  for (const layer of LAYERS) {
    if (!isLayerVisible(layer.id, next)) {
      next[layer.id] = null;
      continue;
    }
    const options = layerOptions(layer.id, next);
    const current = next[layer.id];
    if (current && !options.some((option) => option.available && option.choice.id === current)) next[layer.id] = null;
    if (!next[layer.id]) {
      const available = options.filter((option) => option.available);
      if (available.length === 1) next[layer.id] = available[0].choice.id;
    }
  }

  if (next.robust && !robustState(next).available) next.robust = false;

  const params: Record<string, string> = {};
  for (const param of paramsFor(next)) {
    const value = next.params[param.id];
    params[param.id] = value && param.options.some((option) => option.id === value) ? value : param.defaultValue;
  }
  next.params = params;
  return next;
}

export function choose(selection: Selection, layer: LayerId, value: string): Selection {
  const option = layerOptions(layer, selection).find((item) => item.choice.id === value);
  if (!option?.available) return selection;
  const next = normalize({ ...selection, [layer]: value });
  // 场景参数属于具体场景，换了场景就回到新场景的默认值。
  return scenarioFor(next)?.id === scenarioFor(selection)?.id ? next : normalize({ ...next, params: {} });
}

export function setParam(selection: Selection, id: string, value: string): Selection {
  const param = paramsFor(selection).find((item) => item.id === id);
  if (!param || !param.options.some((option) => option.id === value)) return selection;
  return { ...selection, params: { ...selection.params, [id]: value } };
}

export function setRobust(selection: Selection, robust: boolean): Selection {
  if (robust && !robustState(selection).available) return selection;
  return { ...selection, robust };
}

/** "从模板开始"：一键填好维度 1–5，策略和保护留给用户。 */
export function applyTemplate(id: ScenarioId): Selection {
  const scenario = scenarioOf(id);
  if (!scenario) return EMPTY_SELECTION;
  return normalize({ ...EMPTY_SELECTION, ...scenario.shortcut });
}

export function isComplete(selection: Selection): boolean {
  return LAYERS.every((layer) => !isLayerVisible(layer.id, selection) || Boolean(selection[layer.id]))
    && Boolean(scenarioFor(selection))
    && Boolean(selection.protection);
}

/** 用户当前该回答的维度：第一个可见但还没选的。 */
export function currentLayer(selection: Selection): LayerId | null {
  return visibleLayers(selection).find((layer) => !selection[layer.id])?.id ?? null;
}
