import { describe, expect, it } from "vitest";
import { buildRunPlan, planPreview } from "./plan";
import { EMPTY_SELECTION, applyTemplate, choose, layerOptions, type Selection } from "./selection";
import { SCENARIOS } from "./taxonomy";

/** 从模板开始，策略和保护都选第一个可用项。 */
function completed(scenarioId: (typeof SCENARIOS)[number]["id"]): Selection {
  let selection = applyTemplate(scenarioId);
  for (const layer of ["strategy", "protection"] as const) {
    if (selection[layer]) continue;
    const first = layerOptions(layer, selection).find((option) => option.available);
    if (first) selection = choose(selection, layer, first.choice.id);
  }
  return selection;
}

describe("frontend run plan", () => {
  it("is only produced once every visible dimension is answered", () => {
    expect(buildRunPlan(EMPTY_SELECTION)).toBeNull();
    expect(buildRunPlan(applyTemplate("peft-finetune"))).toBeNull();
    expect(buildRunPlan(completed("peft-finetune"))).not.toBeNull();
  });

  it("can be derived for every scenario template", () => {
    for (const scenario of SCENARIOS) {
      const plan = buildRunPlan(completed(scenario.id));
      expect(plan?.scenario.id, scenario.id).toBe(scenario.id);
      expect(plan?.simulated).toBe(true);
    }
  });

  it("derives execution pattern, exchanged object and runner instead of asking the user", () => {
    const peft = buildRunPlan(completed("peft-finetune"));
    expect(peft?.pattern).toBe("iterative");
    expect(peft?.exchanged).toBe("LoRA 增量");
    expect(peft?.runner).toBe("Flower");

    const merge = buildRunPlan(completed("model-merge"));
    expect(merge?.pattern).toBe("artifact-processing");
    expect(merge?.input.kind).toBe("files");
    expect(merge?.locations.participantWorker).toContain("不需要常驻节点");

    const vertical = buildRunPlan(completed("vertical-modeling"));
    expect(vertical?.pattern).toBe("vertical-protocol");
    expect(vertical?.runner).toBe("FATE");
  });

  it("switches analytics to the vertical protocol for vertical data", () => {
    const horizontal = buildRunPlan(completed("federated-analytics"));
    expect(horizontal?.pattern).toBe("single-round");

    const verticalSelection = choose(applyTemplate("federated-analytics"), "partition", "vertical");
    const plan = buildRunPlan(verticalSelection);
    expect(plan?.pattern).toBe("vertical-protocol");
    expect(plan?.strategy.id).toBe("fa-psi-stats");
  });

  it("marks the plan as frontier when the scenario or strategy is a large-model / agent method", () => {
    const rag = buildRunPlan(completed("fedrag"));
    expect(rag?.adoption).toBe("frontier");
    expect(rag?.warnings.some((warning) => warning.includes("前沿"))).toBe(true);

    const training = buildRunPlan(completed("model-training"));
    expect(training?.adoption).toBe("mainstream");
    expect(training?.warnings.some((warning) => warning.includes("前沿"))).toBe(false);
  });

  it("previews derived values while the user is still choosing", () => {
    const preview = planPreview(applyTemplate("fedrag"));
    expect(preview.scenario).toBe("联邦检索 FedRAG");
    expect(preview.pattern).toBe("查询时联邦");
    expect(preview.runner).toBeUndefined();
  });
});
