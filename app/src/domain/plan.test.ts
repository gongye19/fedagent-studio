import { describe, expect, it } from "vitest";
import { buildRunPlan, planPreview } from "./plan";
import { EMPTY_SELECTION, applyTemplate, choose, layerOptions, toggleEnhancement, type Selection } from "./selection";
import { SCENARIOS, type ScenarioId } from "./taxonomy";

/** 从场景开始，策略选第一个可用项。 */
function completed(scenarioId: ScenarioId, adjust: (selection: Selection) => Selection = (selection) => selection): Selection {
  const selection = adjust(applyTemplate(scenarioId));
  if (selection.strategy) return selection;
  const first = layerOptions("strategy", selection).find((option) => option.available);
  return first ? choose(selection, "strategy", first.choice.id) : selection;
}

const lora = (selection: Selection) => choose(selection, "sharing", "peft");

describe("frontend run plan", () => {
  it("is only produced once every applicable dimension is answered", () => {
    expect(buildRunPlan(EMPTY_SELECTION)).toBeNull();
    expect(buildRunPlan(applyTemplate("horizontal-training"))).toBeNull();
    expect(buildRunPlan(completed("horizontal-training"))).not.toBeNull();
    expect(buildRunPlan(applyTemplate("vertical-training"))).not.toBeNull();
  });

  it("can be derived for every scenario", () => {
    for (const scenario of SCENARIOS) {
      const plan = buildRunPlan(completed(scenario.id));
      expect(plan?.scenario.id, scenario.id).toBe(scenario.id);
      expect(plan?.simulated).toBe(true);
    }
  });

  it("derives execution pattern, input mode, exchanged object and runner instead of asking the user", () => {
    const training = buildRunPlan(completed("horizontal-training", lora));
    expect(training?.pattern).toBe("iterative");
    expect(training?.input.kind).toBe("nodes");
    expect(training?.exchanged).toBe("LoRA 增量");
    expect(training?.output).toBe("全局 LoRA");
    expect(training?.metricsKey).toBe("horizontal-training:peft");
    expect(training?.runner).toBe("Flower");
    expect(training?.locations.participantWorker).toContain("SuperNode");

    const vertical = buildRunPlan(completed("vertical-training"));
    expect(vertical?.pattern).toBe("vertical-protocol");
    expect(vertical?.runner).toBe("NVFlare");

    const memory = buildRunPlan(completed("agent-memory"));
    expect(memory?.pattern).toBe("merge-once");
    expect(memory?.input.kind).toBe("files");
    expect(memory?.locations.participantWorker).toContain("不需要常驻节点");
  });

  it("combines built-in protection with the selected enhancements", () => {
    const vertical = buildRunPlan(completed("vertical-training"));
    expect(vertical?.security.builtin).toEqual(expect.arrayContaining(["mTLS", "Paillier 同态加密", "ECDH PSI"]));
    expect(vertical?.security.enhancements).toEqual([]);

    const fedavg = choose(applyTemplate("horizontal-training"), "strategy", "hfl-fedavg");
    const plan = buildRunPlan(toggleEnhancement(toggleEnhancement(fedavg, "secagg"), "dp"));
    expect(plan?.security.enhancements.map((item) => item.id)).toEqual(["secagg", "dp"]);
    expect(plan?.security.mechanisms).toEqual(expect.arrayContaining(["mTLS", "SecAgg+", "中心化差分隐私"]));
    expect(plan?.warnings.some((warning) => warning.includes("差分隐私"))).toBe(true);
  });

  it("records internally whether the plan uses a large-model / agent method", () => {
    expect(buildRunPlan(completed("agent-memory"))?.adoption).toBe("frontier");
    expect(buildRunPlan(completed("horizontal-training", lora))?.adoption).toBe("frontier");
    expect(buildRunPlan(completed("horizontal-training"))?.adoption).toBe("mainstream");
  });

  it("previews derived values while the user is still choosing", () => {
    const preview = planPreview(applyTemplate("federated-analytics"));
    expect(preview.scenario).toBe("联邦统计分析");
    expect(preview.pattern).toBe("单轮汇总");
    expect(preview.runner).toBeUndefined();
  });
});
