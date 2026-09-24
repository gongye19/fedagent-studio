import { describe, expect, it } from "vitest";
import { isRunStage, nextFlowStep, previousFlowStep } from "./flow";

describe("run flow navigation", () => {
  it("moves through the wizard in order", () => {
    expect(nextFlowStep("configure")).toBe("inputs");
    expect(nextFlowStep("inputs")).toBe("preflight");
    expect(nextFlowStep("provision")).toBe("execute");
    expect(nextFlowStep("evaluate")).toBe("publish");
    expect(nextFlowStep("publish")).toBeNull();
  });

  it("moves backward without leaving the first step", () => {
    expect(previousFlowStep("preflight")).toBe("inputs");
    expect(previousFlowStep("configure")).toBeNull();
  });

  it("separates setup steps from run stages", () => {
    expect(isRunStage("configure")).toBe(false);
    expect(isRunStage("inputs")).toBe(false);
    expect(isRunStage("preflight")).toBe(true);
  });
});
