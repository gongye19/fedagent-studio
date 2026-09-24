import { describe, expect, it } from "vitest";
import { buildRunPlan, planPreview } from "./plan";
import { EMPTY_SELECTION, applyTemplate, choose, layerOptions, toggleEnhancement, type Selection } from "./selection";
import { SCENARIOS } from "./taxonomy";

/** 从场景开始，策略选第一个可用项。 */
function completed(scenarioId: (typeof SCENARIOS)[number]["id"]): Selection {
  const selection = applyTemplate(scenarioId);
  if (selection.strategy) return selection;
  const first = layerOptions("strategy", selection).find((option) => option.available);
  return first ? choose(selection, "strategy", first.choice.id) : selection;
}

describe("frontend run plan", () => {
  it("is only produced once every visible dimension is answered", () => {
    expect(buildRunPlan(EMPTY_SELECTION)).toBeNull();
    expect(buildRunPlan(applyTemplate("model-training"))).toBeNull();
    expect(buildRunPlan(completed("model-training"))).not.toBeNull();
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

    const agent = buildRunPlan(completed("agent-skill"));
    expect(agent?.pattern).toBe("artifact-processing");
    expect(agent?.input.kind).toBe("files");
    expect(agent?.locations.participantWorker).toContain("不需要常驻节点");

    const vertical = buildRunPlan(completed("vertical-modeling"));
    expect(vertical?.pattern).toBe("vertical-protocol");
    expect(vertical?.runner).toBe("FATE");
  });

  it("combines built-in protection with the selected enhancements", () => {
    const vertical = buildRunPlan(completed("vertical-modeling"));
    expect(vertical?.security.builtin).toEqual(expect.arrayContaining(["mTLS", "Paillier 同态加密", "ECDH PSI"]));
    expect(vertical?.security.enhancements).toEqual([]);

    const peft = buildRunPlan(toggleEnhancement(toggleEnhancement(applyTemplate("peft-finetune"), "secagg"), "dp"));
    expect(peft?.security.enhancements.map((item) => item.id)).toEqual(["secagg", "dp"]);
    expect(peft?.security.mechanisms).toEqual(expect.arrayContaining(["mTLS", "SecAgg+", "中心化差分隐私"]));
    expect(peft?.warnings.some((warning) => warning.includes("差分隐私"))).toBe(true);
  });

  it("records internally whether the plan uses a large-model / agent method", () => {
    const rag = buildRunPlan(completed("fedrag"));
    expect(rag?.adoption).toBe("frontier");

    const training = buildRunPlan(completed("model-training"));
    expect(training?.adoption).toBe("mainstream");
  });

  it("previews derived values while the user is still choosing", () => {
    const preview = planPreview(applyTemplate("fedrag"));
    expect(preview.scenario).toBe("联邦检索 FedRAG");
    expect(preview.pattern).toBe("查询时联邦");
    expect(preview.runner).toBeUndefined();
  });
});
