/**
 * 配置引擎：在 7 个维度的子项上做逐项校验。
 *
 * 规则：
 * 1. 先选协作场景；场景决定其余子项是否出现、有哪些候选。
 * 2. 只有前面的子项约束后面的子项；按 ITEMS 的顺序从上到下校验。
 * 3. 每个子项都有推荐默认值：选完场景即得到一份完整配置；上游改选后，失效的下游回到推荐值。
 * 4. 子项都是单选且必须有值，已选选项再点一次不会取消；可选能力用"关闭"表示。
 *    再点一次当前场景即取消场景，回到空白配置。
 */
import {
  DIMENSIONS,
  ITEMS,
  ITEM_IDS,
  itemOf,
  type Candidate,
  type DimensionId,
  type ItemDefinition,
  type ItemId,
  type Selection,
} from "./dimensions";
import type { ScenarioId } from "./taxonomy";

export type { Candidate, ItemId, Selection } from "./dimensions";

export const EMPTY_SELECTION: Selection = Object.fromEntries(ITEM_IDS.map((id) => [id, null])) as Selection;

export type ItemMode = "hidden" | "locked" | "choice";

export type ItemState = {
  item: ItemDefinition;
  title: string;
  mode: ItemMode;
  candidates: Candidate[];
  value: string | null;
};

export function itemState(id: ItemId, selection: Selection): ItemState {
  const item = itemOf(id);
  const candidates = item.candidates(selection);
  return {
    item,
    title: item.title(selection),
    mode: !candidates ? "hidden" : candidates.length === 1 ? "locked" : "choice",
    candidates: candidates ?? [],
    value: selection[id],
  };
}

/** 某个维度下当前显示的子项（不含不适用的）。 */
export function visibleItems(dimension: DimensionId, selection: Selection): ItemState[] {
  return ITEMS.filter((item) => item.dimension === dimension)
    .map((item) => itemState(item.id, selection))
    .filter((state) => state.mode !== "hidden");
}

/** 选中值的显示文字。 */
export function valueLabel(id: ItemId, selection: Selection): string | undefined {
  const value = selection[id];
  return itemOf(id).candidates(selection)?.find((candidate) => candidate.choice.id === value)?.choice.label;
}

/** 从上到下重新校验：不适用的清空，失效或未选的补上推荐值。 */
export function normalize(selection: Selection): Selection {
  const next: Selection = { ...selection };
  for (const item of ITEMS) {
    const candidates = item.candidates(next);
    if (!candidates) {
      next[item.id] = null;
      continue;
    }
    const usable = candidates.filter((candidate) => candidate.available);
    if (usable.some((candidate) => candidate.choice.id === next[item.id])) continue;
    if (item.id === "scenario") continue;
    const preferred = item.preferred?.(next);
    next[item.id] = usable.find((candidate) => candidate.choice.id === preferred)?.choice.id ?? usable[0]?.choice.id ?? null;
  }
  return next;
}

/** 直接选场景：其余子项全部取该场景的推荐值。 */
export function applyScenario(id: ScenarioId): Selection {
  return normalize({ ...EMPTY_SELECTION, scenario: id });
}

/** 点一个选项：场景再点一次即取消；其他子项只接受可用的候选，再点一次不变。 */
export function choose(selection: Selection, id: ItemId, value: string): Selection {
  if (id === "scenario") {
    if (selection.scenario === value) return EMPTY_SELECTION;
    return applyScenario(value as ScenarioId);
  }
  const candidate = itemOf(id).candidates(selection)?.find((entry) => entry.choice.id === value);
  if (!candidate?.available || selection[id] === value) return selection;
  return normalize({ ...selection, [id]: value });
}

/** 场景已选、且每个适用的子项都有值。 */
export function isComplete(selection: Selection): boolean {
  if (!selection.scenario) return false;
  return ITEMS.every((item) => item.candidates(selection) === null || Boolean(selection[item.id]));
}

export { DIMENSIONS };
