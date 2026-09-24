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
    const vertical = planFor("vertical-modeling");
    expect(stageWork("execute", vertical.plan, vertical.participants, "quick").logs.join(" ")).toContain("PSI");

    const agent = planFor("agent-skill");
    expect(stageWork("execute", agent.plan, agent.participants, "quick").logs.join(" ")).toContain("合并");

    const rag = planFor("fedrag");
    expect(stageWork("execute", rag.plan, rag.participants, "quick").logs.join(" ")).toContain("检索");
  });

  it("uses fewer rounds for quick validation than for a standard run", () => {
    const { plan, participants } = planFor("model-training");
    expect(stageWork("execute", plan, participants, "quick").detail).toContain("3 轮");
    expect(stageWork("execute", plan, participants, "standard").detail).toContain("20 轮");
  });

  it("always reports the realistic duration next to the compressed demo time", () => {
    const { plan, participants } = planFor("peft-finetune");
    for (const stage of ["preflight", "provision", "execute", "evaluate"] as const) {
      const work = stageWork(stage, plan, participants, "quick");
      expect(work.realCost, stage).toMatch(/约|秒/);
      expect(work.demoMs, stage).toBeLessThan(5000);
    }
  });

  it("warns when secure aggregation has fewer than three participants", () => {
    const { plan, participants } = planFor("peft-finetune", (selection) => toggleEnhancement(selection, "secagg"));
    const report = preflightReport(plan, participants.slice(0, 2));
    expect(report.passed).toBe(true);
    expect(report.checks.some((check) => check.status === "warn" && check.label.includes("SecAgg"))).toBe(true);
  });

  it("rejects a vertical run without a label-holding guest", () => {
    const { plan, participants } = planFor("vertical-modeling");
    const hostsOnly = participants.map((participant) => ({ ...participant, role: "Host" }));
    expect(preflightReport(plan, hostsOnly).passed).toBe(false);
  });
});
