/**
 * 逐层选择引擎。
 *
 * 规则：
 * 1. 只有前面的维度约束后面的维度。
 * 2. 不适用的维度没有可选项；上游没答完时，下游也没有可选项（界面上置灰）。
 * 3. 上游改选后，下游失效的选择被清空；只剩一个可选项时自动选中。
 * 4. 场景（维度 1）一旦确定，子项只能在该场景内调整：会让路径离开该场景的选项不可选，且子项不能取消。
 * 5. 界面交互（displayOptions / toggle）要求先选场景，未选场景时子项不可选；
 *    choose 保留逐项选择的底层规则，用于枚举场景路径和测试依赖关系。
 * 6. 维度 3 安全与隐私：内置保护随策略自动带上；可选增强可多选，只列策略所在 runner 实际提供的。
 */
import {
  BASELINE_PROTECTION,
  CONTRIBUTIONS,
  ENHANCEMENTS,
  GOALS,
  MODEL_CLASSES,
  PARTITIONS,
  SHARING_MODES,
  STRATEGIES,
  matchScenario,
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

export type LayerId = "goal" | "contribution" | "partition" | "modelClass" | "sharing" | "strategy";

export type Selection = Record<LayerId, string | null> & {
  /** 已确定的场景（维度 1）。确定后子项 1.1–1.5 只能在场景内调整。 */
  scenario: ScenarioId | null;
  /** 维度 3 已选的可选增强。 */
  enhancements: EnhancementId[];
  params: Record<string, string>;
};

export const EMPTY_SELECTION: Selection = {
  goal: null,
  contribution: null,
  partition: null,
  modelClass: null,
  sharing: null,
  strategy: null,
  scenario: null,
  enhancements: [],
  params: {},
};

/** 维度 1（场景）的子项 1.1–1.5。 */
export const SCENARIO_LAYERS: readonly LayerId[] = ["goal", "contribution", "partition", "modelClass", "sharing"];

export type LayerDefinition = {
  id: LayerId;
  /** 编号：维度 1 是场景，1.1–1.5 是它的子项；策略为维度 2。场景参数只用默认值，不在界面展示。 */
  code: string;
  title: string;
  question: string;
};

export const LAYERS: readonly LayerDefinition[] = [
  { id: "goal", code: "1.1", title: "协作目标", question: "想共同完成什么？" },
  { id: "contribution", code: "1.2", title: "各方投入", question: "每个参与方拿出来的是什么？" },
  { id: "partition", code: "1.3", title: "数据关系", question: "各方数据怎么分布？" },
  { id: "modelClass", code: "1.4", title: "模型类别", question: "训练什么类型的模型？" },
  { id: "sharing", code: "1.5", title: "共享方式", question: "模型怎么在各方之间共享？" },
  { id: "strategy", code: "2", title: "协作策略", question: "用哪种算法协作？" },
];

export const SCENARIO_STEP = { code: "1", title: "场景", question: "要做哪一类联邦协作？" } as const;
export const SECURITY_STEP = { code: "3", title: "安全与隐私", question: "内置保护自动生效；可以按需叠加增强。" } as const;

export type OptionState = Availability & { choice: Choice };

/** 这个维度对当前路径是否有意义。 */
export function layerApplies(id: LayerId, selection: Selection): boolean {
  switch (id) {
    case "partition":
      return selection.contribution === "local-data";
    case "modelClass":
      return selection.goal === "train" && selection.contribution === "local-data";
    case "sharing":
      return selection.goal === "train" && selection.contribution === "local-data" && selection.partition === "horizontal";
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
  const matched = matchScenario(selection);
  return selection.scenario && matched?.id !== selection.scenario ? undefined : matched;
}

const ok = (choice: Choice, extra: Omit<Availability, "available"> = {}): OptionState => ({ choice, available: true, ...extra });
const blocked = (choice: Choice, reason: string): OptionState => ({ choice, available: false, reason });

function modelClassOptions(selection: Selection): OptionState[] {
  return MODEL_CLASSES.map((choice) => (
    selection.partition === "vertical" && choice.id === "neural"
      ? blocked(choice, "纵向神经网络（Split NN）不够通用，未收录")
      : ok(choice)
  ));
}

function sharingOptions(selection: Selection): OptionState[] {
  return SHARING_MODES.map((choice) => (
    choice.id === "peft" && selection.modelClass !== "neural" ? blocked(choice, "只适用于预训练神经网络") : ok(choice)
  ));
}

function strategyOptions(selection: Selection): OptionState[] {
  const scenario = scenarioFor(selection);
  if (!scenario) return [];
  return STRATEGIES
    .filter((strategy) => strategy.scenario === scenario.id)
    .filter((strategy) => !strategy.contributions || strategy.contributions.includes(selection.contribution ?? ""))
    .map((strategy) => (
      strategy.modelClasses && !strategy.modelClasses.includes(selection.modelClass ?? "")
        ? blocked(strategy, strategy.blockedReason ?? "与前面的选择不兼容")
        : ok(strategy)
    ));
}

/** 不考虑场景锁定时，某个维度的候选项及可用性。 */
function baseOptions(id: LayerId, selection: Selection): OptionState[] {
  if (!isLayerVisible(id, selection)) return [];
  switch (id) {
    case "goal":
      return GOALS.map((choice) => ok(choice));
    case "contribution":
      // 与目标无关的投入属于类别错误，直接不列出，而不是置灰。
      return CONTRIBUTIONS.filter((choice) => (choice.goals as readonly string[]).includes(selection.goal ?? "")).map((choice) => ok(choice));
    case "partition":
      return PARTITIONS.map((choice) => ok(choice));
    case "modelClass":
      return modelClassOptions(selection);
    case "sharing":
      return sharingOptions(selection);
    case "strategy":
      return strategyOptions(selection);
  }
}

type ScenarioPathValues = Record<LayerId, string | null>;

let pathCache: Map<ScenarioId, ScenarioPathValues[]> | null = null;

/** 枚举子项 1.1–1.5 的全部可达组合，按落到的场景分组。只算一次。 */
function scenarioPaths(id: ScenarioId): ScenarioPathValues[] {
  if (!pathCache) {
    const cache = new Map<ScenarioId, ScenarioPathValues[]>();
    const walk = (selection: Selection) => {
      const layer = SCENARIO_LAYERS.find((item) => isLayerVisible(item, selection) && !selection[item]);
      if (!layer) {
        const matched = matchScenario(selection);
        if (matched) cache.set(matched.id, [...(cache.get(matched.id) ?? []), { ...selection }]);
        return;
      }
      for (const option of baseOptions(layer, selection).filter((item) => item.available)) {
        walk(normalizeWith({ ...selection, [layer]: option.choice.id }, false));
      }
    };
    walk(EMPTY_SELECTION);
    pathCache = cache;
  }
  return pathCache.get(id) ?? [];
}

/** 在已确定的场景内，某个维度取这个值后是否还能落回同一个场景。 */
function staysInScenario(selection: Selection, layer: LayerId, value: string): boolean {
  if (!selection.scenario) return true;
  const upstream = SCENARIO_LAYERS.slice(0, SCENARIO_LAYERS.indexOf(layer));
  return scenarioPaths(selection.scenario).some((path) => (
    path[layer] === value && upstream.every((item) => path[item] === selection[item])
  ));
}

function optionsWith(id: LayerId, selection: Selection, useLock: boolean): OptionState[] {
  const base = baseOptions(id, selection);
  if (!useLock || !selection.scenario || !SCENARIO_LAYERS.includes(id)) return base;
  return base.map((option) => (
    option.available && !staysInScenario(selection, id, option.choice.id)
      ? { choice: option.choice, available: false, reason: "不属于当前场景" }
      : option
  ));
}

/** 某个维度当前的候选项及可用性（含场景锁定）。上游没答完时返回空数组。 */
export function layerOptions(id: LayerId, selection: Selection): OptionState[] {
  return optionsWith(id, selection, true);
}

/** 只剩一个可选项时，平台自动选中，界面标注"自动选中"。 */
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
 * 界面展示用：每个维度始终列出全部候选项（协作策略在选了场景后只列该场景的）。
 * 只有上游已选、且与上游兼容的选项可点，其余置灰。维度不适用于当前路径时整组置灰。
 */
export function displayOptions(id: LayerId, selection: Selection): DisplayOption[] {
  // 先选场景：未选场景时，场景子项全部不可选。
  const states = SCENARIO_LAYERS.includes(id) && !selection.scenario ? [] : layerOptions(id, selection);
  return candidatesOf(id, selection).map(({ choice, group }) => {
    const state = states.find((option) => option.choice.id === choice.id);
    return { choice, group, available: Boolean(state?.available), warning: state?.available ? state.warning : undefined };
  });
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
  const scenario = scenarioFor(selection);
  if (!scenario) return [];
  return scenario.params.filter((param) => !param.strategies || param.strategies.includes(selection.strategy ?? ""));
}

/** 从上到下重新校验：清掉失效选择，自动选中唯一可选项，锁定已确定的场景，补齐参数默认值。 */
export function normalize(selection: Selection): Selection {
  return normalizeWith(selection, true);
}

function normalizeWith(selection: Selection, useLock: boolean): Selection {
  const next: Selection = { ...selection, enhancements: [...selection.enhancements], params: { ...selection.params } };
  for (const layer of LAYERS) {
    if (!isLayerVisible(layer.id, next)) {
      next[layer.id] = null;
      continue;
    }
    const options = optionsWith(layer.id, next, useLock);
    const current = next[layer.id];
    if (current && !options.some((option) => option.available && option.choice.id === current)) next[layer.id] = null;
    if (!next[layer.id]) {
      const available = options.filter((option) => option.available);
      if (available.length === 1) next[layer.id] = available[0].choice.id;
    }
  }
  // 子项 1.1–1.5 选到能确定场景时，锁定这个场景。
  if (useLock && !next.scenario && isLayerVisible("strategy", next)) next.scenario = matchScenario(next)?.id ?? null;

  // 换了策略后，新 runner 不提供的增强自动去掉。
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
  const next = normalize({ ...selection, [layer]: value });
  // 场景参数属于具体场景，换了场景就回到新场景的默认值。
  return scenarioFor(next)?.id === scenarioFor(selection)?.id ? next : normalize({ ...next, params: {} });
}

/** 当前选项能否通过再点一次取消：场景确定后，场景子项必须保留一个选择。 */
export function canDeselect(selection: Selection, layer: LayerId): boolean {
  return !(selection.scenario && SCENARIO_LAYERS.includes(layer));
}

/** 点一个选项：未选则选中；已选则取消（场景确定后的子项除外）。 */
export function toggle(selection: Selection, layer: LayerId, value: string): Selection {
  if (SCENARIO_LAYERS.includes(layer) && !selection.scenario) return selection;
  if (selection[layer] !== value) return choose(selection, layer, value);
  if (!canDeselect(selection, layer)) return selection;
  return normalize({ ...selection, [layer]: null });
}

/** 直接选场景：锁定场景并自动填好子项 1.1–1.5（场景内有多个选项的子项用默认值），策略和增强留给用户。 */
export function applyTemplate(id: ScenarioId): Selection {
  const scenario = scenarioOf(id);
  if (!scenario) return EMPTY_SELECTION;
  return normalize({ ...EMPTY_SELECTION, ...scenario.shortcut, scenario: id });
}

/** 场景和策略都确定即可开始；安全增强是可选项。 */
export function isComplete(selection: Selection): boolean {
  return LAYERS.every((layer) => !isLayerVisible(layer.id, selection) || Boolean(selection[layer.id]))
    && Boolean(scenarioFor(selection));
}

/** 用户当前该回答的维度：第一个可见但还没选的。 */
export function currentLayer(selection: Selection): LayerId | null {
  return visibleLayers(selection).find((layer) => !selection[layer.id])?.id ?? null;
}
