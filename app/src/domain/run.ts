// L3 Run 编排与状态机。
//
// 铁律：这个文件里不许出现任何按产物类型的分支（C3）。不同联邦场景
// 走的是同一条控制面生命周期，差异全部在 L5 runner 适配器里。
// 第二条铁律：没有走完评测就拿不到产物（C4）——publish 只能从 evaluate 之后进入。

import type { Artifact, Recipe } from "./types";

export type StageId = "preflight" | "provision" | "federate" | "evaluate" | "publish";
export type StageStatus = "pending" | "running" | "done" | "skipped" | "failed";

export type Stage = {
  id: StageId;
  name: string;
  status: StageStatus;
  detail: string;
};

/** 每个参与产物在某个指标上的原始值。C4 要求对比里能看到这些。 */
export type MetricSource = { artifactId: string; artifactName: string; value: number };

export type ComparisonRow = {
  metric: string;
  sources: MetricSource[];
  /** 参与产物里的最好值，作为「合并前」的基准。 */
  before: number;
  after: number;
  delta: number;
};

export type RunResult = {
  artifactId: string;
  name: string;
  sizeBytes: number;
  metrics: Record<string, number>;
  comparison: ComparisonRow[];
};

export type Run = {
  id: string;
  createdAt: string;
  recipe: Recipe;
  stages: Stage[];
  result: RunResult | null;
  error: string | null;
};

const STAGE_NAMES: Record<StageId, string> = {
  preflight: "Agent 准入检查",
  provision: "创建隔离执行环境",
  federate: "执行联邦任务",
  evaluate: "评测",
  publish: "产出版本",
};

const ORDER: StageId[] = ["preflight", "provision", "federate", "evaluate", "publish"];

export function createRun(id: string, recipe: Recipe, createdAt: string): Run {
  return {
    id,
    createdAt,
    recipe,
    stages: ORDER.map((stageId) => ({
      id: stageId,
      name: STAGE_NAMES[stageId],
      status: "pending",
      detail: "",
    })),
    result: null,
    error: null,
  };
}

/** 下一个该跑的阶段；全部跑完或已失败时返回 null。 */
export function nextStage(run: Run): Stage | null {
  if (run.error) return null;
  return run.stages.find((stage) => stage.status === "pending") ?? null;
}

export function stageOf(run: Run, id: StageId): Stage {
  const stage = run.stages.find((item) => item.id === id);
  if (!stage) throw new Error(`未知阶段 ${id}`);
  return stage;
}

function replace(run: Run, id: StageId, patch: Partial<Stage>): Run {
  return {
    ...run,
    stages: run.stages.map((stage) => (stage.id === id ? { ...stage, ...patch } : stage)),
  };
}

export function startStage(run: Run, id: StageId): Run {
  return replace(run, id, { status: "running" });
}

export function finishStage(run: Run, id: StageId, detail: string): Run {
  return replace(run, id, { status: "done", detail });
}

export function failRun(run: Run, id: StageId, error: string): Run {
  return { ...replace(run, id, { status: "failed", detail: error }), error };
}

export function attachResult(run: Run, result: RunResult): Run {
  return { ...run, result };
}

export function isFinished(run: Run): boolean {
  return run.stages.every((stage) => stage.status === "done" || stage.status === "skipped");
}

/**
 * C4 闸门：产物可下载 ⟺ 评测已完成且版本已产出。
 * 界面上的下载入口必须问这个函数，不许自己判断。
 */
export function canDownload(run: Run): boolean {
  if (run.error || !run.result) return false;
  return stageOf(run, "evaluate").status === "done" && stageOf(run, "publish").status === "done";
}

export function progressOf(run: Run): number {
  const settled = run.stages.filter(
    (stage) => stage.status === "done" || stage.status === "skipped",
  ).length;
  return settled / run.stages.length;
}

// ── 评测对比的构造 ──────────────────────────────────────────

/**
 * 合并前的基准取参与产物里的最好值，不取平均——用平均会让「合并后比所有输入都差」
 * 这种情况看起来仍然是提升，那正是要暴露的失败形态。
 */
export function buildComparison(
  selected: Artifact[],
  metricKeys: readonly string[],
  after: Record<string, number>,
): ComparisonRow[] {
  return metricKeys.map((metric) => {
    const sources: MetricSource[] = selected.map((artifact) => ({
      artifactId: artifact.id,
      artifactName: artifact.name,
      value: artifact.metrics[metric] ?? 0,
    }));
    const before = Math.max(...sources.map((source) => source.value));
    const value = after[metric] ?? 0;
    return { metric, sources, before, after: value, delta: value - before };
  });
}

/**
 * 涨跌按页面上显示的百分点算，不按浮点原值。
 * 否则会出现「91% → 91%」却被标成下降这种自相矛盾的显示。
 */
export function deltaPoints(row: ComparisonRow): number {
  return Math.round(row.after * 100) - Math.round(row.before * 100);
}

/** 有任何一个指标掉下来就该提醒——这就是「看起来像正常升级」的失败形态。 */
export function regressions(comparison: ComparisonRow[]): ComparisonRow[] {
  return comparison.filter((row) => deltaPoints(row) < 0);
}
