/**
 * 逐层选择引擎。
 *
 * 规则：
 * 1. 只有前面的维度约束后面的维度。
 * 2. 不适用的维度没有可选项；上游没答完时，下游也没有可选项（界面上置灰）。
 * 3. 上游改选后，下游失效的选择被清空；只剩一个可选项时自动选中。
 * 4. 场景（维度 1）一旦确定（直接选场景，或子项 1.1–1.6 选到能确定场景），子项只能在该场景内调整：
 *    会让路径离开该场景的选项不可选，且子项不能取消。换场景要重新选场景，或再点一次当前场景取消。
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
  /** 已确定的场景（维度 1）。确定后子项 1.1–1.6 只能在场景内调整。 */
  scenario: ScenarioId | null;
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
  scenario: null,
  params: {},
};

/** 维度 1（场景）的子项 1.1–1.6。 */
export const SCENARIO_LAYERS: readonly LayerId[] = ["goal", "contribution", "partition", "topology", "modelClass", "sharing"];

export type LayerDefinition = {
  id: LayerId;
  /** 编号：维度 1 是场景，1.1–1.6 是它的子项；策略、保护依次为维度 2、3。 */
  code: string;
  title: string;
  question: string;
};

export const LAYERS: readonly LayerDefinition[] = [
  { id: "goal", code: "1.1", title: "协作目标", question: "想共同完成什么？" },
  { id: "contribution", code: "1.2", title: "各方投入", question: "每个参与方拿出来的是什么？" },
  { id: "partition", code: "1.3", title: "数据关系", question: "各方数据怎么分布？" },
  { id: "topology", code: "1.4", title: "参与方形态", question: "谁参与，规模和稳定性如何？" },
  { id: "modelClass", code: "1.5", title: "模型类别", question: "训练什么类型的模型？" },
  { id: "sharing", code: "1.6", title: "共享方式", question: "模型怎么在各方之间共享？" },
  { id: "strategy", code: "2", title: "协作策略", question: "用哪种算法协作？" },
  { id: "protection", code: "3", title: "安全与信任", question: "要防谁、保护到什么程度？" },
];

export const SCENARIO_STEP = { code: "1", title: "场景", question: "要做哪一类联邦协作？" } as const;
export const PARAMS_STEP = { code: "4", title: "场景参数", question: "策略之外还有哪些可调项？" } as const;

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
  const matched = matchScenario(selection);
  return selection.scenario && matched?.id !== selection.scenario ? undefined : matched;
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
  return TOPOLOGIES.map((choice) => {
    if (choice.id === "cross-silo") return ok(choice);
    if (selection.partition === "vertical") return blocked(choice, "纵向协议需要少量稳定在线的机构节点");
    if (localHorizontal && (selection.goal === "train" || selection.goal === "analytics")) return ok(choice);
    return blocked(choice, "端侧设备只支持横向数据上的训练和统计");
  });
}

function modelClassOptions(selection: Selection): OptionState[] {
  return MODEL_CLASSES.map((choice) => (
    selection.partition === "vertical" && choice.id === "neural"
      ? blocked(choice, "纵向神经网络（Split NN）用得较少，暂未收录")
      : ok(choice)
  ));
}

function sharingOptions(selection: Selection): OptionState[] {
  if (selection.contribution === "trained-artifact") return ARTIFACT_KINDS.map((choice) => ok(choice));
  return SHARING_MODES.map((choice) => {
    if (choice.id === "full") return ok(choice);
    if (selection.modelClass !== "neural") return blocked(choice, "只适用于预训练神经网络");
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
      if (strategy.modelClasses && !strategy.modelClasses.includes(selection.modelClass ?? "")) {
        return blocked(strategy, strategy.blockedReason ?? "与前面的选择不兼容");
      }
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
    case "topology":
      return topologyOptions(selection);
    case "modelClass":
      return modelClassOptions(selection);
    case "sharing":
      return sharingOptions(selection);
    case "strategy":
      return strategyOptions(selection);
    case "protection":
      return protectionOptions(selection);
  }
}

type ScenarioPathValues = Record<LayerId, string | null>;

let pathCache: Map<ScenarioId, ScenarioPathValues[]> | null = null;

/** 枚举子项 1.1–1.6 的全部可达组合，按落到的场景分组。只算一次。 */
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

/** 从上到下重新校验：清掉失效选择，自动选中唯一可选项，锁定已确定的场景，补齐参数默认值。 */
export function normalize(selection: Selection): Selection {
  return normalizeWith(selection, true);
}

function normalizeWith(selection: Selection, useLock: boolean): Selection {
  const next: Selection = { ...selection, params: { ...selection.params } };
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
  // 子项 1.1–1.6 选到能确定场景时，锁定这个场景。
  if (useLock && !next.scenario && isLayerVisible("strategy", next)) next.scenario = matchScenario(next)?.id ?? null;

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
  if (selection[layer] !== value) return choose(selection, layer, value);
  if (!canDeselect(selection, layer)) return selection;
  return normalize({ ...selection, [layer]: null });
}

export function setParam(selection: Selection, id: string, value: string): Selection {
  const param = paramsFor(selection).find((item) => item.id === id);
  if (!param || !param.options.some((option) => option.id === value)) return selection;
  return { ...selection, params: { ...selection.params, [id]: value } };
}

/** 直接选场景：锁定场景并自动填好子项 1.1–1.6（场景内有多个选项的子项用默认值），策略和保护留给用户。 */
export function applyTemplate(id: ScenarioId): Selection {
  const scenario = scenarioOf(id);
  if (!scenario) return EMPTY_SELECTION;
  return normalize({ ...EMPTY_SELECTION, ...scenario.shortcut, scenario: id });
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
