import { describe, expect, it } from "vitest";
import { defaultDatasetIds, matchedDatasets, type Participant } from "./demo";
import { buildRunPlan } from "./plan";
import { applyTemplate, choose, layerOptions, toggleEnhancement, type Selection } from "./selection";
import { evaluationReport, preflightReport, stageWork } from "./simulator";
import { SCENARIOS, type ScenarioId } from "./taxonomy";

function planFor(id: ScenarioId, adjust: (selection: Selection) => Selection = (selection) => selection) {
  let selection = applyTemplate(id);
  if (!selection.strategy) {
    const first = layerOptions("strategy", selection).find((option) => option.available);
    if (first) selection = choose(selection, "strategy", first.choice.id);
  }
  selection = adjust(selection);
  const plan = buildRunPlan(selection);
  if (!plan) throw new Error(`plan expected for ${id}`);
  const ids = defaultDatasetIds(selection);
  const participants: Participant[] = matchedDatasets(selection).filter((entry) => ids.includes(entry.id));
  return { plan, participants };
}

describe("per-scenario simulators", () => {
  it("passes preflight and the evaluation gate with each scenario's default participants", () => {
    for (const scenario of SCENARIOS) {
      const { plan, participants } = planFor(scenario.id);
      expect(preflightReport(plan, participants).passed, scenario.id).toBe(true);
      expect(evaluationReport(plan).passed, scenario.id).toBe(true);
    }
  });

  it("describes execution in terms of the scenario's own pattern", () => {
    const training = planFor("horizontal-training");
    expect(stageWork("execute", training.plan, training.participants, "quick").logs.join(" ")).toContain("SuperNode");

    const vertical = planFor("vertical-training");
    expect(stageWork("execute", vertical.plan, vertical.participants, "quick").logs.join(" ")).toContain("PSI");

    const analytics = planFor("federated-analytics");
    expect(stageWork("execute", analytics.plan, analytics.participants, "quick").logs.join(" ")).toContain("不直接平均");

    const memory = planFor("agent-memory");
    expect(stageWork("execute", memory.plan, memory.participants, "quick").logs.join(" ")).toContain("脱敏");
  });

  it("uses LoRA-specific metrics when sharing LoRA", () => {
    const { plan } = planFor("horizontal-training", (selection) => choose(selection, "sharing", "peft"));
    expect(evaluationReport(plan).metrics.map((metric) => metric.name)).toContain("通用能力（回归检查）");
  });

  it("uses fewer rounds for quick validation than for a standard run", () => {
    const { plan, participants } = planFor("horizontal-training");
    expect(stageWork("execute", plan, participants, "quick").detail).toContain("3 轮");
    expect(stageWork("execute", plan, participants, "standard").detail).toContain("20 轮");
  });

  it("always reports the realistic duration next to the compressed demo time", () => {
    const { plan, participants } = planFor("agent-memory");
    for (const stage of ["preflight", "provision", "execute", "evaluate"] as const) {
      const work = stageWork(stage, plan, participants, "quick");
      expect(work.realCost, stage).toMatch(/约|秒/);
      expect(work.demoMs, stage).toBeLessThan(5000);
    }
  });

  it("warns when secure aggregation has fewer than three participants", () => {
    const { plan, participants } = planFor("horizontal-training", (selection) => toggleEnhancement(selection, "secagg"));
    const report = preflightReport(plan, participants.slice(0, 2));
    expect(report.passed).toBe(true);
    expect(report.checks.some((check) => check.status === "warn" && check.label.includes("SecAgg"))).toBe(true);
  });

  it("rejects a vertical run without a label holder", () => {
    const { plan, participants } = planFor("vertical-training");
    const featuresOnly = participants.map((participant) => ({ ...participant, role: "特征方" }));
    expect(preflightReport(plan, featuresOnly).passed).toBe(false);
  });
});
