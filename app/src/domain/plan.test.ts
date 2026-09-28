import { describe, expect, it } from "vitest";
import { buildRunPlan, configGroups, estimate, formatMinutes } from "./plan";
import { EMPTY_SELECTION, applyScenario, choose } from "./selection";
import { SCENARIOS } from "./taxonomy";

describe("frontend run plan", () => {
  it("is produced for every scenario once it is chosen", () => {
    expect(buildRunPlan(EMPTY_SELECTION)).toBeNull();
    for (const scenario of SCENARIOS) {
      const plan = buildRunPlan(applyScenario(scenario.id));
      expect(plan?.scenario.id, scenario.id).toBe(scenario.id);
      expect(plan?.schemaVersion).toBe("frontend.run-plan/v2");
      expect(plan?.groups.map((group) => group.dimension)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it("uses one plan shape and derives runner, pattern and exchanged object", () => {
    const lora = buildRunPlan(applyScenario("horizontal-training"));
    expect([lora?.runner, lora?.pattern, lora?.exchanged, lora?.deliverable]).toEqual(["Flower", "iterative", "LoRA 增量", "LoRA Adapter"]);
    expect(lora?.metricsKey).toBe("horizontal:llm");
    expect(lora?.locations.participantWorker).toContain("SuperNode");

    const vertical = buildRunPlan(applyScenario("vertical-training"));
    expect([vertical?.runner, vertical?.pattern, vertical?.exchanged]).toEqual(["隐语 SecretFlow", "vertical-protocol", "加密梯度与分裂统计"]);

    const memory = buildRunPlan(applyScenario("agent-memory"));
    expect([memory?.pattern, memory?.scenario.inputKind]).toEqual(["merge-once", "files"]);
    expect(memory?.locations.participantWorker).toContain("不需要常驻节点");
  });

  it("records requirements that participants must meet", () => {
    const plan = buildRunPlan(choose(applyScenario("horizontal-training"), "partyScale", "6-10"));
    expect(plan?.requirements.minParties).toBe(6);
    expect(plan?.requirements.compute?.id).toBe("gpu-24");
    expect(plan?.requirements.dataType.id).toBe("instruction");
    expect(buildRunPlan(applyScenario("federated-analytics"))?.requirements.compute).toBeNull();
  });

  it("lists the protection mechanisms that will actually run", () => {
    const vertical = buildRunPlan(applyScenario("vertical-training"));
    expect(vertical?.security.mechanisms).toEqual(["mTLS", "隔离沙箱", "审计日志", "ECDH-PSI", "OU 同态加密"]);

    const protectedRun = buildRunPlan(choose(choose(applyScenario("horizontal-training"), "secagg", "secagg-plus"), "dp", "3"));
    expect(protectedRun?.security.mechanisms).toEqual(expect.arrayContaining(["SecAgg+", "差分隐私 ε = 3"]));
    expect(protectedRun?.warnings.some((warning) => warning.includes("差分隐私"))).toBe(true);
  });

  it("warns about vertical training over the public internet and QLoRA precision", () => {
    const publicVertical = buildRunPlan(choose(applyScenario("vertical-training"), "network", "public"));
    expect(publicVertical?.warnings.some((warning) => warning.includes("专线"))).toBe(true);
    const qlora = buildRunPlan(choose(applyScenario("horizontal-training"), "sharing", "qlora"));
    expect(qlora?.warnings.some((warning) => warning.includes("QLoRA"))).toBe(true);
  });

  it("marks plans that use large-model or agent methods", () => {
    expect(buildRunPlan(applyScenario("horizontal-training"))?.adoption).toBe("frontier");
    expect(buildRunPlan(choose(applyScenario("horizontal-training"), "dataType", "table"))?.adoption).toBe("mainstream");
    expect(buildRunPlan(applyScenario("agent-memory"))?.adoption).toBe("frontier");
  });

  it("builds the configuration list shown in the order summary", () => {
    const groups = configGroups(applyScenario("vertical-training"));
    const security = groups.find((group) => group.dimension === 6);
    expect(security?.rows.map((row) => row.title)).toEqual(["基础安全", "加密计算"]);
    expect(security?.rows[0].locked).toBe(true);
  });
});

describe("resource and duration estimate", () => {
  it("scales with rounds and protection", () => {
    const base = applyScenario("horizontal-training");
    const longer = choose(base, "rounds", "50");
    const [baseLow] = [estimate(base).duration];
    expect(estimate(longer).duration).not.toBe(baseLow);
    expect(estimate(base).resources).toBe("每方 1 个节点 · GPU 24 GB");
    expect(estimate(base).consumption).toContain("GPU·时");
    expect(estimate(applyScenario("vertical-training")).consumption).toContain("CPU 节点·时");
    expect(estimate(applyScenario("agent-memory")).resources).toBe("平台托管");
  });

  it("formats minutes and hours", () => {
    expect(formatMinutes([12, 40])).toBe("约 12–40 分钟");
    expect(formatMinutes([90, 180])).toBe("约 1.5–3 小时");
  });
});
