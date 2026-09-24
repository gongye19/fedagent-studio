import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { backendFor, demoDuration, type Context } from "./backends";
import { evaluationOf, methodOf, privacyOf } from "./registry";
import { METRIC_KEYS, SEED_ARTIFACTS, artifactOf } from "./repository";
import {
  buildComparison, canDownload, createRun, deltaPoints, failRun, finishStage, isFinished,
  nextStage, progressOf, regressions, startStage, attachResult, type Run, type StageId,
} from "./run";
import type { Artifact, Recipe } from "./types";

const pick = (id: string) => {
  const found = artifactOf(SEED_ARTIFACTS, id);
  if (!found) throw new Error(`种子数据里没有 ${id}`);
  return found;
};

const LORA_RECIPE: Recipe = {
  artifactIds: ["news-summary", "legal-qa", "finance-report"],
  methodId: "ties",
  privacyId: "dp",
  datasetId: "ft-general",
  evaluationId: "central-benchmark",
};

const CARD_RECIPE: Recipe = {
  artifactIds: ["cards-internal", "cards-surgery", "cards-pediatrics"],
  methodId: "card-merge",
  privacyId: "redaction",
  datasetId: "ft-general",
  evaluationId: "case-replay",
};

function contextOf(recipe: Recipe): Context {
  const selected = recipe.artifactIds.map(pick);
  return {
    selected,
    method: methodOf(recipe.methodId)!,
    privacy: privacyOf(recipe.privacyId)!,
    evaluation: evaluationOf(recipe.evaluationId)!,
    datasetName: recipe.datasetId ? "通用指令对齐集" : null,
  };
}

/** 一路跑到底，返回终态。 */
function runToEnd(recipe: Recipe): Run {
  let run = createRun("run-1", recipe, "2026-09-23");
  const context = contextOf(recipe);
  const backend = backendFor(context.method);

  for (let guard = 0; guard < 20; guard += 1) {
    const stage = nextStage(run);
    if (!stage) break;
    run = startStage(run, stage.id);
    run = finishStage(run, stage.id, backend.plan(stage.id, context).detail);
  }

  const produced = backend.produce(context);
  return attachResult(run, {
    artifactId: "produced-1",
    name: produced.name,
    sizeBytes: produced.sizeBytes,
    metrics: produced.metrics,
    comparison: buildComparison(
      context.selected,
      METRIC_KEYS[context.selected[0].objectType],
      produced.metrics,
    ),
  });
}

// ── C3 两类产物走同一条状态机 ───────────────────────────────

describe("C3 统一编排", () => {
  test("LoRA 与经验卡的阶段序列完全相同", () => {
    const lora = createRun("a", LORA_RECIPE, "2026-09-23");
    const cards = createRun("b", CARD_RECIPE, "2026-09-23");
    expect(lora.stages.map((stage) => stage.id)).toEqual(cards.stages.map((stage) => stage.id));
    expect(lora.stages.map((stage) => stage.status)).toEqual(cards.stages.map((stage) => stage.status));
  });

  test("两类产物跑完后的状态迁移序列相同", () => {
    const lora = runToEnd(LORA_RECIPE);
    const cards = runToEnd(CARD_RECIPE);
    expect(lora.stages.map((stage) => [stage.id, stage.status]))
      .toEqual(cards.stages.map((stage) => [stage.id, stage.status]));
  });

  test("状态机源码里没有按产物类型的分支", () => {
    // C3 的最低通过线就是这条：差异必须全部落在 L5 适配器里。
    const source = readFileSync(new URL("./run.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/"lora"|'lora'|skill-cards/);
  });

  test("控制面生命周期固定为五个阶段", () => {
    const run = createRun("c", { ...LORA_RECIPE, datasetId: null }, "2026-09-23");
    expect(run.stages).toHaveLength(5);
    expect(run.stages.map((stage) => stage.id)).toEqual([
      "preflight", "provision", "federate", "evaluate", "publish",
    ]);
  });

  test("五个阶段按顺序运行", () => {
    let run = createRun("d", { ...LORA_RECIPE, datasetId: null }, "2026-09-23");
    const visited: StageId[] = [];
    for (let guard = 0; guard < 20; guard += 1) {
      const stage = nextStage(run);
      if (!stage) break;
      visited.push(stage.id);
      run = finishStage(startStage(run, stage.id), stage.id, "");
    }
    expect(visited).toEqual(["preflight", "provision", "federate", "evaluate", "publish"]);
    expect(isFinished(run)).toBe(true);
  });
});

// ── C4 评测闸门 ─────────────────────────────────────────────

describe("C4 没评测就拿不到产物", () => {
  test("刚建好的 Run 不能下载", () => {
    expect(canDownload(createRun("e", LORA_RECIPE, "2026-09-23"))).toBe(false);
  });

  test("合并完但没评测不能下载", () => {
    let run = createRun("f", LORA_RECIPE, "2026-09-23");
    run = finishStage(startStage(run, "preflight"), "preflight", "");
    run = finishStage(startStage(run, "provision"), "provision", "");
    run = finishStage(startStage(run, "federate"), "federate", "");
    expect(canDownload(run)).toBe(false);
  });

  test("有结果但评测未完成仍然不能下载", () => {
    let run = createRun("g", LORA_RECIPE, "2026-09-23");
    run = attachResult(run, {
      artifactId: "x", name: "x", sizeBytes: 1, metrics: {}, comparison: [],
    });
    expect(canDownload(run)).toBe(false);
  });

  test("走完全程才能下载", () => {
    expect(canDownload(runToEnd(LORA_RECIPE))).toBe(true);
  });

  test("中途失败不能下载", () => {
    let run = createRun("h", LORA_RECIPE, "2026-09-23");
    run = failRun(startStage(run, "federate"), "federate", "某一方的产物校验不通过");
    expect(canDownload(run)).toBe(false);
    expect(nextStage(run)).toBeNull();
  });
});

describe("C4 对比包含每个参与产物的原始指标", () => {
  const run = runToEnd(LORA_RECIPE);

  test("每个指标都列出全部参与产物", () => {
    expect(run.result).toBeTruthy();
    for (const row of run.result!.comparison) {
      expect(row.sources.map((source) => source.artifactId).sort())
        .toEqual([...LORA_RECIPE.artifactIds].sort());
      expect(row.sources.every((source) => source.artifactName.length > 0)).toBe(true);
    }
  });

  test("合并前的基准取参与产物里的最好值，不取平均", () => {
    const row = run.result!.comparison.find((item) => item.metric === "领域准确率")!;
    expect(row.before).toBe(Math.max(...row.sources.map((source) => source.value)));
  });

  test("能暴露出掉下来的指标", () => {
    // 合并会削弱拒答合规，这正是「看起来像正常升级」的失败形态。
    const dropped = regressions(run.result!.comparison).map((row) => row.metric);
    expect(dropped).toContain("拒答合规");
    expect(dropped).toContain("领域准确率");
  });

  test("综合基准确实提升，所以只看一个指标会看错", () => {
    const overall = run.result!.comparison.find((item) => item.metric === "综合基准")!;
    expect(overall.delta).toBeGreaterThan(0);
  });
});

// ── 进度与适配器 ────────────────────────────────────────────

describe("进度与后端声明", () => {
  test("进度按已完成阶段计算", () => {
    const run = createRun("i", { ...LORA_RECIPE, datasetId: null }, "2026-09-23");
    expect(progressOf(run)).toBe(0);
    expect(progressOf(runToEnd(LORA_RECIPE))).toBe(1);
  });

  test("每个阶段都声明了真实耗时与资源等级", () => {
    const context = contextOf(LORA_RECIPE);
    const backend = backendFor(context.method);
    const stages: StageId[] = ["preflight", "provision", "federate", "evaluate", "publish"];
    for (const stage of stages) {
      const work = backend.plan(stage, context);
      expect(work.realCost.length).toBeGreaterThan(0);
      expect(work.demoMs).toBeGreaterThan(0);
      expect(["cpu-small", "cpu-bigmem", "gpu"]).toContain(work.resourceClass);
    }
  });

  test("联邦 runner 用 CPU，中心化评测使用 GPU", () => {
    const context = contextOf(LORA_RECIPE);
    const backend = backendFor(context.method);
    expect(backend.plan("federate", context).resourceClass).not.toBe("gpu");
    expect(backend.plan("evaluate", context).resourceClass).toBe("gpu");
  });

  test("同态加密把合并挪到大内存 CPU，并说明慢在预处理", () => {
    const context = { ...contextOf(LORA_RECIPE), method: methodOf("dare")!, privacy: privacyOf("he-ckks")! };
    const work = backendFor(context.method).plan("federate", context);
    expect(work.resourceClass).toBe("cpu-bigmem");
    expect(work.realCost).toContain("预处理");
  });

  test("选联邦评测时评测阶段不需要 GPU", () => {
    const context = { ...contextOf(LORA_RECIPE), evaluation: evaluationOf("federated-eval")! };
    expect(backendFor(context.method).plan("evaluate", context).resourceClass).toBe("cpu-small");
  });

  test("演示时长覆盖完整生命周期", () => {
    const context = contextOf(LORA_RECIPE);
    expect(demoDuration(context)).toBeGreaterThan(0);
  });

  test("换方法会得到不同结果，否则演示里换方法没有意义", () => {
    const base = contextOf(LORA_RECIPE);
    const withTies = backendFor(base.method).produce(base).metrics;
    const average = { ...base, method: methodOf("weighted-average")! };
    const withAverage = backendFor(average.method).produce(average).metrics;
    expect(withTies["综合基准"]).not.toBe(withAverage["综合基准"]);
  });

  test("指标都落在 0 到 1 之间", () => {
    for (const recipe of [LORA_RECIPE, CARD_RECIPE]) {
      const context = contextOf(recipe);
      const metrics = backendFor(context.method).produce(context).metrics;
      for (const value of Object.values(metrics)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("种子数据", () => {
  test("每个产物的判定字段与信任字段都齐全", () => {
    for (const item of SEED_ARTIFACTS as Artifact[]) {
      expect(item.architecture).toBeTruthy();
      expect(item.baseCheckpoint).toBeTruthy();
      expect(item.provenance).toBeTruthy();
      expect(item.trainingMethod).toBeTruthy();
      expect(Object.keys(item.metrics).length).toBeGreaterThan(0);
    }
  });

  test("每个产物的指标键与它的对象类型一致", () => {
    for (const item of SEED_ARTIFACTS) {
      expect(Object.keys(item.metrics).sort()).toEqual([...METRIC_KEYS[item.objectType]].sort());
    }
  });
});

describe("涨跌显示与判定必须一致", () => {
  const row = {
    metric: "x", sources: [], before: 0.9100, after: 0.9094, delta: -0.0006,
  };

  test("四舍五入后相同的两个数不算下降", () => {
    // 91% → 91% 却标成下降，是自相矛盾的显示。
    expect(deltaPoints(row)).toBe(0);
    expect(regressions([row])).toHaveLength(0);
  });

  test("真的掉了一个百分点才算下降", () => {
    expect(regressions([{ ...row, after: 0.902 }])).toHaveLength(1);
  });
});
