// L2 能力矩阵。四类选择之间的全部约束都在这个文件里判定，别处不许重复实现（C1、C2）。
//
// 设计要点：互斥关系不是手工维护的一张表，而是从两个声明推出来的——
// 方法声明自己在数学上做什么（computeKind），加密方式声明自己还允许做哪几类计算（supports）。
// 这样新增任何一方都不需要回头改另一方。

import { EVALUATIONS, METHODS, PRIVACIES } from "./registry";
import type {
  Artifact, Choices, ComputeKind, Evaluation, Method, ObjectType, Privacy, Recipe,
} from "./types";

export const OBJECT_TYPE_LABEL: Record<ObjectType, string> = {
  lora: "LoRA 权重",
  "skill-cards": "经验卡",
};

/** 每类计算在做什么，用来拼拒绝原因。 */
const KIND_ACTION: Record<ComputeKind, string> = {
  additive: "只做加权求和",
  "additive-masked": "只做加权求和与随机掩码",
  compare: "要逐个比较各方参数的大小",
  "content-aware": "要读懂内容才能分组去重",
};

/** 每种保护方式限制了什么，用来拼拒绝原因。 */
const PRIVACY_LIMIT: Record<string, string> = {
  secagg: "安全聚合下平台只能解出总和，看不到任何一方的单独内容",
  "he-ckks": "密文上只能做加法，既比较不了大小也读不出内容",
  dp: "差分隐私加的噪声会改变内容的字面取值",
};

// ── C2：产物之间能不能一起合并 ──────────────────────────────

export type Mergeability = { ok: true } | { ok: false; reason: string };

/**
 * 只看三件事：对象类型、架构、基座 checkpoint。
 * 架构一致是硬前置——层数、隐藏维、注意力头必须完全相同，
 * 同架构但基座不同（例如同为 8B 但一个是 Llama-3.1 一个是 Llama-3.2）同样合不了。
 */
export function mergeability(base: Artifact, candidate: Artifact): Mergeability {
  if (base.id === candidate.id) return { ok: true };
  if (base.objectType !== candidate.objectType) {
    return {
      ok: false,
      reason: `对象类型不同：已选的是${OBJECT_TYPE_LABEL[base.objectType]}，这个是${OBJECT_TYPE_LABEL[candidate.objectType]}。`,
    };
  }
  if (base.architecture !== candidate.architecture) {
    return {
      ok: false,
      reason: `架构不同：已选的是 ${base.architecture}，这个是 ${candidate.architecture}。合并要求层数、隐藏维和注意力头完全一致。`,
    };
  }
  if (base.baseCheckpoint !== candidate.baseCheckpoint) {
    return {
      ok: false,
      reason: `基座不同：已选的基于 ${base.baseCheckpoint}，这个基于 ${candidate.baseCheckpoint}。架构相同但基座不同也合不了。`,
    };
  }
  return { ok: true };
}

/**
 * 数据列表的收窄。先选方法再选数据，所以这里要同时看两件事：
 * 方法接不接受这种对象类型、这个产物能不能和已选的第一个合并。
 */
export function narrowArtifacts(
  all: Artifact[], selectedIds: string[], method?: Method,
): Choices<Artifact> {
  const base = all.find((item) => item.id === selectedIds[0]);
  const allowed: Artifact[] = [];
  const blocked: Choices<Artifact>["blocked"] = [];

  for (const item of all) {
    if (method && !method.accepts.includes(item.objectType)) {
      blocked.push({
        item,
        reason: `「${method.name}」处理不了${OBJECT_TYPE_LABEL[item.objectType]}，它只接受${method.accepts.map((type) => OBJECT_TYPE_LABEL[type]).join("、")}。`,
      });
      continue;
    }
    if (base) {
      const verdict = mergeability(base, item);
      if (!verdict.ok) {
        blocked.push({ item, reason: verdict.reason });
        continue;
      }
      // 秩的要求来自方法，不是产物本身，所以只有选了要求同秩的方法才拦。
      if (method?.requiresSameRank && base.rank !== undefined && item.rank !== base.rank) {
        blocked.push({
          item,
          reason: `「${method.name}」要求各方同秩。已选的是秩 ${base.rank}，这个是秩 ${item.rank}。`,
        });
        continue;
      }
    }
    allowed.push(item);
  }
  return { allowed, blocked };
}

// ── C1：方法、加密与评测的逐级收窄 ──────────────────────────

export function narrowMethods(selected: Artifact[]): Choices<Method> {
  if (!selected.length) return { allowed: METHODS, blocked: [] };

  const objectType = selected[0].objectType;
  const ranks = new Set(selected.map((item) => item.rank).filter((rank) => rank !== undefined));

  const allowed: Method[] = [];
  const blocked: Choices<Method>["blocked"] = [];
  for (const method of METHODS) {
    if (!method.accepts.includes(objectType)) {
      blocked.push({
        item: method,
        reason: `「${method.name}」处理不了${OBJECT_TYPE_LABEL[objectType]}，它只接受${method.accepts.map((type) => OBJECT_TYPE_LABEL[type]).join("、")}。`,
      });
      continue;
    }
    if (method.requiresSameRank && ranks.size > 1) {
      blocked.push({
        item: method,
        reason: `「${method.name}」要求各方同秩，当前选了秩 ${[...ranks].sort((a, b) => a! - b!).join(" 和 ")} 两种。改用「LoRA 拼接」，或去掉不同秩的产物。`,
      });
      continue;
    }
    if (selected.length < method.minArtifacts) {
      blocked.push({
        item: method,
        reason: `「${method.name}」至少需要 ${method.minArtifacts} 个产物，当前选了 ${selected.length} 个。`,
      });
      continue;
    }
    allowed.push(method);
  }
  return { allowed, blocked };
}

/** 加密方式能不能配这个方法，完全由 method.computeKind ∈ privacy.supports 决定。 */
export function narrowPrivacies(method: Method | undefined): Choices<Privacy> {
  if (!method) return { allowed: PRIVACIES, blocked: [] };

  const allowed: Privacy[] = [];
  const blocked: Choices<Privacy>["blocked"] = [];
  for (const privacy of PRIVACIES) {
    if (privacy.supports.includes(method.computeKind)) {
      allowed.push(privacy);
      continue;
    }
    blocked.push({ item: privacy, reason: rejectionReason(method, privacy) });
  }
  return { allowed, blocked };
}

/** 拒绝原因要同时说清「方法要干什么」和「这种保护让不了它干」，再给一条出路。 */
export function rejectionReason(method: Method, privacy: Privacy): string {
  const limit = PRIVACY_LIMIT[privacy.id] ?? `${privacy.name}下这类计算做不了`;
  const escape = suggestEscape(method);
  return `「${method.name}」${KIND_ACTION[method.computeKind]}，而${limit}。${escape}`;
}

function suggestEscape(method: Method): string {
  const fallback = METHODS.find(
    (item) =>
      item.id !== method.id &&
      item.accepts.some((type) => method.accepts.includes(type)) &&
      (item.computeKind === "additive" || item.computeKind === "additive-masked"),
  );
  if (fallback) return `改用「${fallback.name}」可以，或者换成可信执行环境。`;
  return "换成可信执行环境可以，它在硬件飞地里明文计算。";
}

export function narrowEvaluations(selected: Artifact[]): Choices<Evaluation> {
  if (!selected.length) return { allowed: EVALUATIONS, blocked: [] };

  const objectType = selected[0].objectType;
  const allowed: Evaluation[] = [];
  const blocked: Choices<Evaluation>["blocked"] = [];
  for (const evaluation of EVALUATIONS) {
    if (evaluation.accepts.includes(objectType)) allowed.push(evaluation);
    else {
      blocked.push({
        item: evaluation,
        reason: `「${evaluation.name}」评不了${OBJECT_TYPE_LABEL[objectType]}。`,
      });
    }
  }
  return { allowed, blocked };
}

// ── 提交前的整体复核 ────────────────────────────────────────

/** 返回空数组表示配方合法。界面在这之前就该拦住，这里是最后一道保险。 */
export function validateRecipe(recipe: Recipe, all: Artifact[]): string[] {
  const errors: string[] = [];
  const selected = recipe.artifactIds
    .map((id) => all.find((item) => item.id === id))
    .filter((item): item is Artifact => Boolean(item));

  if (selected.length !== recipe.artifactIds.length) errors.push("有产物已不在仓库中。");
  if (selected.length < 2) errors.push("至少要选两个产物才能联邦。");

  const base = selected[0];
  if (base) {
    for (const item of selected.slice(1)) {
      const verdict = mergeability(base, item);
      if (!verdict.ok) errors.push(`${item.name}：${verdict.reason}`);
    }
  }

  const method = narrowMethods(selected).allowed.find((item) => item.id === recipe.methodId);
  if (!method) {
    errors.push("所选联邦方法不适用于当前产物。");
    return errors;
  }
  if (!narrowPrivacies(method).allowed.some((item) => item.id === recipe.privacyId)) {
    errors.push("所选加密方式与联邦方法不兼容。");
  }
  if (!narrowEvaluations(selected).allowed.some((item) => item.id === recipe.evaluationId)) {
    errors.push("所选评测方案不适用于当前产物。");
  }
  return errors;
}

/** 整张矩阵，给界面上的「兼容性一览」用。 */
export function capabilityMatrix() {
  return METHODS.map((method) => ({
    method,
    cells: PRIVACIES.map((privacy) => ({
      privacy,
      ok: privacy.supports.includes(method.computeKind),
      reason: privacy.supports.includes(method.computeKind) ? null : rejectionReason(method, privacy),
    })),
  }));
}
