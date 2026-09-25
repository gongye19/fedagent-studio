/**
 * 逐层选择引擎。
 *
 * 规则：
 * 1. 先选场景（维度 1）。只有前面的维度约束后面的维度。
 * 2. 场景下的子项（1.1 模型类别、1.2 共享方式）只在训练场景出现；不适用的子项整组置灰。
 * 3. 上游改选后，下游失效的选择被清空；只剩一个可选项时自动选中。
 * 4. 场景确定后，子项必须保留一个选择，不能取消；其他已选选项再点一次即取消。
 * 5. 维度 2 协作策略只列当前场景的策略。
 * 6. 维度 3 安全与隐私：内置保护随策略自动带上；可选增强可多选，只列策略所在 runner 实际提供的。
 */
import {
  BASELINE_PROTECTION,
  ENHANCEMENTS,
  MODEL_CLASSES,
  SHARING_MODES,
  STRATEGIES,
  scenarioOf,
  strategyOf,
  type Availability,
  type Choice,
  type Enhancement,
  type EnhancementId,
  type ParamDefinition,
  type Scenario,
  type ScenarioId,
} from "./taxonomy";

export type LayerId = "modelClass" | "sharing" | "strategy";

export type Selection = Record<LayerId, string | null> & {
  /** 已确定的场景（维度 1）。 */
  scenario: ScenarioId | null;
  /** 维度 3 已选的可选增强。 */
  enhancements: EnhancementId[];
  /** 运行默认值，不在界面展示。 */
  params: Record<string, string>;
};

export const EMPTY_SELECTION: Selection = {
  scenario: null,
  modelClass: null,
  sharing: null,
  strategy: null,
  enhancements: [],
  params: {},
};

/** 维度 1（场景）下的子项。 */
export const SCENARIO_LAYERS: readonly LayerId[] = ["modelClass", "sharing"];

export type LayerDefinition = {
  id: LayerId;
  /** 编号：维度 1 是场景，1.1–1.2 是它的子项；策略为维度 2。 */
  code: string;
  title: string;
  question: string;
};

export const LAYERS: readonly LayerDefinition[] = [
  { id: "modelClass", code: "1.1", title: "模型类别", question: "训练什么类型的模型？" },
  { id: "sharing", code: "1.2", title: "共享方式", question: "每轮交换整个模型，还是只交换 LoRA？" },
  { id: "strategy", code: "2", title: "协作策略", question: "用哪种算法协作？" },
];

export const SCENARIO_STEP = { code: "1", title: "场景", question: "要做哪一类联邦协作？" } as const;
export const SECURITY_STEP = { code: "3", title: "安全与隐私", question: "内置保护自动生效；可以按需叠加增强。" } as const;

export type OptionState = Availability & { choice: Choice };

/** 这个维度对当前场景是否有意义。 */
export function layerApplies(id: LayerId, selection: Selection): boolean {
  if (!selection.scenario) return false;
  return id === "strategy" || selection.scenario === "horizontal-training";
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
  return scenarioOf(selection.scenario);
}

const ok = (choice: Choice): OptionState => ({ choice, available: true });
const blocked = (choice: Choice, reason: string): OptionState => ({ choice, available: false, reason });

/** 某个维度当前的候选项及可用性。维度不适用或上游没答完时返回空数组。 */
export function layerOptions(id: LayerId, selection: Selection): OptionState[] {
  if (!isLayerVisible(id, selection)) return [];
  switch (id) {
    case "modelClass":
      return MODEL_CLASSES.map(ok);
    case "sharing":
      return SHARING_MODES.map((choice) => (
        choice.id === "peft" && selection.modelClass !== "neural" ? blocked(choice, "只适用于预训练神经网络") : ok(choice)
      ));
    case "strategy":
      return STRATEGIES
        .filter((strategy) => strategy.scenario === selection.scenario)
        .map((strategy) => (
          strategy.modelClasses && !strategy.modelClasses.includes(selection.modelClass ?? "")
            ? blocked(strategy, "与模型类别不兼容")
            : ok(strategy)
        ));
  }
}

/** 只剩一个可选项时，平台自动选中，界面标注"自动选中"。 */
export function isAutoSelected(id: LayerId, selection: Selection): boolean {
  return layerOptions(id, selection).filter((option) => option.available).length === 1;
}

export type DisplayOption = { choice: Choice; available: boolean; warning?: string; group?: string };

function candidatesOf(id: LayerId, selection: Selection): { choice: Choice; group?: string }[] {
  switch (id) {
    case "modelClass":
      return MODEL_CLASSES.map((choice) => ({ choice }));
    case "sharing":
      return SHARING_MODES.map((choice) => ({ choice }));
    case "strategy":
      // 选了场景后只列该场景的策略；未选场景时列出全部（置灰），按场景分组。
      return STRATEGIES
        .filter((strategy) => !selection.scenario || strategy.scenario === selection.scenario)
        .map((strategy) => ({ choice: strategy, group: scenarioOf(strategy.scenario)?.label }));
  }
}

/**
 * 界面展示用：每个维度始终列出候选项（协作策略在选了场景后只列该场景的）。
 * 只有上游已选、且与上游兼容的选项可点，其余置灰。维度不适用于当前场景时整组置灰。
 */
export function displayOptions(id: LayerId, selection: Selection): DisplayOption[] {
  const states = layerOptions(id, selection);
  return candidatesOf(id, selection).map(({ choice, group }) => {
    const state = states.find((option) => option.choice.id === choice.id);
    return { choice, group, available: Boolean(state?.available), warning: state?.available ? state.warning : undefined };
  });
}

/** 联邦对象：共享方式为 LoRA 时，交换的是 LoRA 增量。 */
export function exchangedFor(selection: Selection): string | undefined {
  const strategy = strategyOf(selection.strategy);
  if (!strategy) return undefined;
  return selection.sharing === "peft" ? "LoRA 增量" : strategy.exchanged;
}

/** 维度 3：当前策略的内置保护（基础保护 + 协议自带）。未选策略时只有基础保护。 */
export function builtinProtection(selection: Selection): string[] {
  return [...BASELINE_PROTECTION, ...(strategyOf(selection.strategy)?.builtin ?? [])];
}

/** 维度 3：列出全部可选增强，只有当前策略所在 runner 提供的可选。 */
export function enhancementOptions(selection: Selection): { enhancement: Enhancement; available: boolean }[] {
  const supported = strategyOf(selection.strategy)?.enhancements ?? [];
  return ENHANCEMENTS.map((enhancement) => ({ enhancement, available: supported.includes(enhancement.id) }));
}

export function toggleEnhancement(selection: Selection, id: EnhancementId): Selection {
  if (!enhancementOptions(selection).some((item) => item.enhancement.id === id && item.available)) return selection;
  const has = selection.enhancements.includes(id);
  return { ...selection, enhancements: has ? selection.enhancements.filter((item) => item !== id) : [...selection.enhancements, id] };
}

export function paramsFor(selection: Selection): ParamDefinition[] {
  return [...(scenarioFor(selection)?.params ?? [])];
}

/** 从上到下重新校验：清掉失效选择，自动选中唯一可选项，去掉不再支持的增强，补齐运行默认值。 */
export function normalize(selection: Selection): Selection {
  const next: Selection = { ...selection, enhancements: [...selection.enhancements], params: { ...selection.params } };
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

  const supported = strategyOf(next.strategy)?.enhancements ?? [];
  next.enhancements = next.enhancements.filter((id) => supported.includes(id));

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
  return normalize({ ...selection, [layer]: value });
}

/** 当前选项能否通过再点一次取消：场景下的子项必须保留一个选择。 */
export function canDeselect(_selection: Selection, layer: LayerId): boolean {
  return !SCENARIO_LAYERS.includes(layer);
}

/** 点一个选项：未选则选中；已选则取消（场景子项除外）。 */
export function toggle(selection: Selection, layer: LayerId, value: string): Selection {
  if (selection[layer] !== value) return choose(selection, layer, value);
  if (!canDeselect(selection, layer)) return selection;
  return normalize({ ...selection, [layer]: null });
}

/** 直接选场景：填好子项默认值；只有一个策略时自动选中，增强留给用户。 */
export function applyTemplate(id: ScenarioId): Selection {
  const scenario = scenarioOf(id);
  if (!scenario) return EMPTY_SELECTION;
  return normalize({ ...EMPTY_SELECTION, ...scenario.defaults, scenario: id });
}

/** 场景、适用的子项和策略都确定即可开始；安全增强是可选项。 */
export function isComplete(selection: Selection): boolean {
  return Boolean(selection.scenario)
    && LAYERS.every((layer) => !layerApplies(layer.id, selection) || Boolean(selection[layer.id]));
}

/** 用户当前该回答的维度：第一个可见但还没选的。 */
export function currentLayer(selection: Selection): LayerId | null {
  return visibleLayers(selection).find((layer) => !selection[layer.id])?.id ?? null;
}
