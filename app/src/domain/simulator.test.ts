import { describe, expect, it } from "vitest";
import { buildRunPlan } from "./plan";
import type { Participant } from "./run";
import { applyScenario, choose, type Selection } from "./selection";
import { evaluationReport, preflightReport, stageWork } from "./simulator";
import { SCENARIOS, type ComputeId, type ScenarioId } from "./taxonomy";

function planFor(id: ScenarioId, adjust: (selection: Selection) => Selection = (selection) => selection) {
  const plan = buildRunPlan(adjust(applyScenario(id)));
  if (!plan) throw new Error(`plan expected for ${id}`);
  return plan;
}

function participants(count: number, spec: ComputeId | undefined, roles: string[] = []): Participant[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    name: `机构 ${index + 1}`,
    org: `机构 ${index + 1}`,
    role: roles[index] ?? "参与方",
    provides: "数据",
    detail: "",
    source: "partner",
    spec,
  }));
}

function defaults(id: ScenarioId): Participant[] {
  const plan = planFor(id);
  const roles = plan.pattern === "vertical-protocol" ? ["标签方", "特征方"] : [];
  return participants(plan.requirements.minParties, plan.requirements.compute?.id as ComputeId | undefined, roles);
}

describe("per-scenario simulators", () => {
  it("passes preflight and the delivery gate with enough compliant participants", () => {
    for (const scenario of SCENARIOS) {
      const plan = planFor(scenario.id);
      expect(preflightReport(plan, defaults(scenario.id)).passed, scenario.id).toBe(true);
      expect(evaluationReport(plan).passed, scenario.id).toBe(true);
    }
  });

  it("rejects nodes below the required compute spec", () => {
    const plan = planFor("horizontal-training");
    const report = preflightReport(plan, [...participants(2, "gpu-24"), ...participants(1, "gpu-16")]);
    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.label === "节点算力")?.status).toBe("fail");
  });

  it("rejects too few parties and vertical runs without exactly one label holder", () => {
    expect(preflightReport(planFor("horizontal-training"), participants(2, "gpu-24")).passed).toBe(false);
    expect(preflightReport(planFor("vertical-training"), participants(2, "cpu-compute", ["特征方", "特征方"])).passed).toBe(false);
  });

  it("describes execution in terms of the scenario's own pattern", () => {
    const logs = (id: ScenarioId) => {
      const plan = planFor(id);
      return stageWork("execute", plan, defaults(id)).logs.join(" ");
    };
    expect(logs("horizontal-training")).toContain("SuperNode");
    expect(logs("vertical-training")).toContain("ECDH-PSI");
    expect(logs("federated-analytics")).toContain("不直接平均");
    expect(logs("agent-memory")).toContain("脱敏");
  });

  it("runs the configured number of rounds and reports the estimate as the real duration", () => {
    const plan = planFor("horizontal-training", (selection) => choose(selection, "rounds", "50"));
    const work = stageWork("execute", plan, defaults("horizontal-training"));
    expect(work.detail).toContain("50 轮");
    expect(work.realCost).toBe(plan.estimate.duration);
  });

  it("uses the regression check for large models and names the baseline after the evaluation method", () => {
    const llm = evaluationReport(planFor("horizontal-training"));
    expect(llm.metrics.map((metric) => metric.name)).toContain("通用能力（回归检查）");
    const table = evaluationReport(planFor("horizontal-training", (selection) => choose(choose(selection, "dataType", "table"), "evaluation", "baseline")));
    expect(table.metrics[0].baselineLabel).toBe("最好的单方模型");
  });

  it("always reports the realistic duration next to the compressed demo time", () => {
    const plan = planFor("agent-memory");
    for (const stage of ["preflight", "provision", "execute", "evaluate"] as const) {
      const work = stageWork(stage, plan, defaults("agent-memory"));
      expect(work.realCost, stage).toMatch(/约|秒/);
      expect(work.demoMs, stage).toBeLessThan(5000);
    }
  });
});
