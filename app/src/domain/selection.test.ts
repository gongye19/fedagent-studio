import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  applyTemplate,
  builtinProtection,
  canDeselect,
  choose,
  currentLayer,
  displayOptions,
  enhancementOptions,
  exchangedFor,
  isAutoSelected,
  isComplete,
  layerApplies,
  layerOptions,
  toggle,
  toggleEnhancement,
  visibleLayers,
  type LayerId,
  type Selection,
} from "./selection";
import { SCENARIOS, STRATEGIES } from "./taxonomy";

const availableIds = (selection: Selection, layer: LayerId) => layerOptions(layer, selection)
  .filter((option) => option.available)
  .map((option) => option.choice.id);
const availableEnhancements = (selection: Selection) => enhancementOptions(selection)
  .filter((item) => item.available)
  .map((item) => item.enhancement.id);

const horizontal = () => applyTemplate("horizontal-training");

describe("scenario-first selection", () => {
  it("offers four scenarios, grouped by how they run", () => {
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual(["horizontal-training", "vertical-training", "federated-analytics", "agent-memory"]);
    expect(SCENARIOS.filter((scenario) => scenario.input.kind === "nodes").map((scenario) => scenario.id)).toEqual(["horizontal-training", "vertical-training"]);
    expect(SCENARIOS.filter((scenario) => scenario.input.kind === "files").map((scenario) => scenario.id)).toEqual(["federated-analytics", "agent-memory"]);
  });

  it("shows nothing selectable until a scenario is chosen", () => {
    expect(visibleLayers(EMPTY_SELECTION)).toEqual([]);
    expect(currentLayer(EMPTY_SELECTION)).toBeNull();
    expect(displayOptions("modelClass", EMPTY_SELECTION).every((option) => !option.available)).toBe(true);
    expect(toggle(EMPTY_SELECTION, "modelClass", "neural")).toBe(EMPTY_SELECTION);
  });

  it("fills the horizontal training sub-items with defaults and leaves the strategy to the user", () => {
    const selection = horizontal();
    expect([selection.modelClass, selection.sharing]).toEqual(["neural", "full"]);
    expect(selection.strategy).toBeNull();
    expect(currentLayer(selection)).toBe("strategy");
    expect(availableIds(selection, "strategy")).toEqual(["hfl-fedavg", "hfl-fedprox"]);
  });

  it("uses sub-items only for horizontal training", () => {
    for (const id of ["vertical-training", "federated-analytics", "agent-memory"] as const) {
      const selection = applyTemplate(id);
      expect(layerApplies("modelClass", selection), id).toBe(false);
      expect(layerApplies("sharing", selection), id).toBe(false);
      expect(visibleLayers(selection).map((layer) => layer.id), id).toEqual(["strategy"]);
    }
  });

  it("restricts LoRA to neural networks and gives tree models only XGBoost Bagging", () => {
    const tree = choose(horizontal(), "modelClass", "tree");
    expect(tree.sharing).toBe("full");
    expect(availableIds(tree, "sharing")).toEqual(["full"]);
    expect(tree.strategy).toBe("hfl-xgb-bagging");
    expect(isAutoSelected("strategy", tree)).toBe(true);
    expect(layerOptions("strategy", tree).find((option) => option.choice.id === "hfl-fedavg")?.available).toBe(false);
  });

  it("switches the exchanged object to LoRA when sharing LoRA", () => {
    const lora = choose(choose(horizontal(), "sharing", "peft"), "strategy", "hfl-fedavg");
    expect(exchangedFor(lora)).toBe("LoRA 增量");
    expect(exchangedFor(choose(horizontal(), "strategy", "hfl-fedavg"))).toBe("模型参数增量");
  });

  it("clears downstream choices that become invalid when an upstream choice changes", () => {
    const lora = choose(choose(horizontal(), "sharing", "peft"), "strategy", "hfl-fedprox");
    expect(isComplete(lora)).toBe(true);
    const tree = choose(lora, "modelClass", "tree");
    expect(tree.sharing).toBe("full");
    expect(tree.strategy).toBe("hfl-xgb-bagging");
  });

  it("auto-selects the only strategy of vertical training", () => {
    const vertical = applyTemplate("vertical-training");
    expect(vertical.strategy).toBe("vfl-secure-xgboost");
    expect(isComplete(vertical)).toBe(true);
  });

  it("does not let sub-items be deselected, but lets strategies be deselected", () => {
    const training = choose(horizontal(), "strategy", "hfl-fedprox");
    expect(canDeselect(training, "modelClass")).toBe(false);
    expect(toggle(training, "modelClass", "neural")).toBe(training);
    expect(toggle(training, "strategy", "hfl-fedprox").strategy).toBeNull();
  });

  it("lists only the chosen scenario's strategies once a scenario is set", () => {
    expect(displayOptions("strategy", EMPTY_SELECTION)).toHaveLength(STRATEGIES.length);
    const memory = displayOptions("strategy", applyTemplate("agent-memory"));
    expect(memory.map((option) => option.choice.id)).toEqual(["mem-dedup", "mem-arbitration"]);
    expect(memory.every((option) => option.available)).toBe(true);
  });

  it("keeps run defaults internal to the scenario", () => {
    expect(horizontal().params).toEqual({ rounds: "20", "local-epochs": "1" });
    expect(applyTemplate("agent-memory").params).toEqual({});
  });

  it("gives every scenario at least one strategy and every strategy a runner and reference", () => {
    for (const scenario of SCENARIOS) {
      expect(availableIds(applyTemplate(scenario.id), "strategy").length, scenario.id).toBeGreaterThan(0);
    }
    for (const strategy of STRATEGIES) {
      expect(strategy.runner, strategy.id).toBeTruthy();
      expect(strategy.references.length, strategy.id).toBeGreaterThan(0);
    }
  });

  it("follows Flower for horizontal training and NVFlare for vertical training", () => {
    expect(new Set(STRATEGIES.filter((item) => item.scenario === "horizontal-training").map((item) => item.runner))).toEqual(new Set(["Flower"]));
    expect(STRATEGIES.filter((item) => item.scenario === "vertical-training").map((item) => item.runner)).toEqual(["NVFlare"]);
  });
});

describe("security and privacy", () => {
  it("offers only the enhancements the strategy's runner actually provides", () => {
    expect(availableEnhancements(choose(horizontal(), "strategy", "hfl-fedavg"))).toEqual(["secagg", "dp"]);
    expect(availableEnhancements(choose(horizontal(), "modelClass", "tree"))).toEqual([]);
    expect(availableEnhancements(applyTemplate("vertical-training"))).toEqual([]);
    expect(availableEnhancements(choose(applyTemplate("federated-analytics"), "strategy", "fa-basic-stats"))).toEqual(["dp"]);
    expect(availableEnhancements(choose(applyTemplate("agent-memory"), "strategy", "mem-dedup"))).toEqual([]);
  });

  it("always includes the baseline protection and protocol built-ins", () => {
    expect(builtinProtection(EMPTY_SELECTION)).toEqual(["mTLS", "隔离沙箱", "审计日志"]);
    expect(builtinProtection(applyTemplate("vertical-training"))).toEqual(expect.arrayContaining(["ECDH PSI", "Paillier 同态加密"]));
    const stats = choose(applyTemplate("federated-analytics"), "strategy", "fa-histogram");
    expect(builtinProtection(stats)).toEqual(expect.arrayContaining(["最小分组阈值", "统一分箱"]));
    expect(builtinProtection(choose(applyTemplate("agent-memory"), "strategy", "mem-dedup"))).toContain("敏感信息脱敏");
  });

  it("lets secure aggregation and differential privacy be combined and toggled", () => {
    const fedavg = choose(horizontal(), "strategy", "hfl-fedavg");
    const both = toggleEnhancement(toggleEnhancement(fedavg, "secagg"), "dp");
    expect(both.enhancements).toEqual(["secagg", "dp"]);
    expect(toggleEnhancement(both, "secagg").enhancements).toEqual(["dp"]);
  });

  it("ignores enhancements the runner does not provide", () => {
    const vertical = applyTemplate("vertical-training");
    expect(toggleEnhancement(vertical, "secagg")).toBe(vertical);
  });

  it("drops enhancements the new strategy does not support", () => {
    const fedavg = toggleEnhancement(choose(horizontal(), "strategy", "hfl-fedavg"), "secagg");
    expect(fedavg.enhancements).toEqual(["secagg"]);
    expect(choose(fedavg, "modelClass", "tree").enhancements).toEqual([]);
    expect(toggle(fedavg, "strategy", "hfl-fedavg").enhancements).toEqual([]);
  });
});
