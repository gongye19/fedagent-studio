import { describe, expect, it } from "vitest";
import { FLOW_STEPS, isRunStage, labelOf, nextFlowStep, previousFlowStep } from "./flow";

describe("project flow navigation", () => {
  it("goes from the locked configuration through participants to delivery", () => {
    expect(FLOW_STEPS.map((step) => step.label)).toEqual(["配置", "参与方", "准入检查", "创建环境", "执行", "评测", "交付"]);
    expect(nextFlowStep("configure")).toBe("participants");
    expect(nextFlowStep("participants")).toBe("preflight");
    expect(nextFlowStep("publish")).toBeNull();
    expect(labelOf("publish")).toBe("交付");
  });

  it("moves backward without leaving the first step", () => {
    expect(previousFlowStep("preflight")).toBe("participants");
    expect(previousFlowStep("configure")).toBeNull();
  });

  it("separates setup steps from run stages", () => {
    expect(isRunStage("configure")).toBe(false);
    expect(isRunStage("participants")).toBe(false);
    expect(isRunStage("preflight")).toBe(true);
  });
});
