import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  SCENARIO_LAYERS,
  applyTemplate,
  builtinProtection,
  canDeselect,
  choose,
  currentLayer,
  displayOptions,
  enhancementOptions,
  isAutoSelected,
  isComplete,
  layerOptions,
  scenarioFor,
  toggle,
  toggleEnhancement,
  visibleLayers,
  type LayerId,
  type Selection,
} from "./selection";
import { SCENARIOS, STRATEGIES } from "./taxonomy";

function pick(selection: Selection, steps: [LayerId, string][]): Selection {
  return steps.reduce((current, [layer, value]) => choose(current, layer, value), selection);
}

const ids = (selection: Selection, layer: LayerId) => layerOptions(layer, selection).map((option) => option.choice.id);
const availableIds = (selection: Selection, layer: LayerId) => layerOptions(layer, selection)
  .filter((option) => option.available)
  .map((option) => option.choice.id);
const availableEnhancements = (selection: Selection) => enhancementOptions(selection)
  .filter((item) => item.available)
  .map((item) => item.enhancement.id);

describe("layered selection", () => {
  it("reveals dimensions in order, starting from the goal", () => {
    expect(visibleLayers(EMPTY_SELECTION).map((layer) => layer.id)).toEqual(["goal"]);
    expect(currentLayer(EMPTY_SELECTION)).toBe("goal");
    const train = choose(EMPTY_SELECTION, "goal", "train");
    expect(visibleLayers(train).map((layer) => layer.id)).toEqual(["goal", "contribution", "partition"]);
  });

  it("lists only contributions that make sense for the goal", () => {
    expect(ids(choose(EMPTY_SELECTION, "goal", "agent"), "contribution")).toEqual(["traces-skills", "trained-artifact"]);
    expect(choose(EMPTY_SELECTION, "goal", "train").contribution).toBe("local-data");
    expect(choose(EMPTY_SELECTION, "goal", "evaluate").contribution).toBe("local-test-data");
  });

  it("auto-selects a dimension when only one option remains", () => {
    const analytics = choose(EMPTY_SELECTION, "goal", "analytics");
    expect(analytics.contribution).toBe("local-data");
    expect(isAutoSelected("contribution", analytics)).toBe(true);
  });

  it("skips data relation and model shape where they do not apply", () => {
    const layers = visibleLayers(choose(EMPTY_SELECTION, "goal", "retrieval")).map((layer) => layer.id);
    expect(layers).not.toContain("partition");
    expect(layers).not.toContain("modelClass");
  });

  it("uses protocol-native encryption for vertical federation and excludes Split NN", () => {
    const vertical = pick(EMPTY_SELECTION, [["goal", "train"], ["partition", "vertical"]]);
    expect(visibleLayers(vertical).map((layer) => layer.id)).not.toContain("sharing");
    expect(availableIds(vertical, "modelClass")).toEqual(["tree", "linear"]);

    const tree = choose(vertical, "modelClass", "tree");
    expect(scenarioFor(tree)?.id).toBe("vertical-modeling");
    expect(tree.strategy).toBe("vfl-secureboost");
    expect(builtinProtection(tree)).toEqual(expect.arrayContaining(["Paillier 同态加密", "ECDH PSI"]));
    expect(choose(vertical, "modelClass", "linear").strategy).toBe("vfl-hetero-lr");
  });

  it("gives tree models only the XGBoost histogram strategy", () => {
    const tree = pick(EMPTY_SELECTION, [["goal", "train"], ["partition", "horizontal"], ["modelClass", "tree"]]);
    expect(tree.sharing).toBe("full");
    expect(availableIds(tree, "strategy")).toEqual(["train-xgb-histogram"]);
    expect(tree.strategy).toBe("train-xgb-histogram");
    const fedavg = layerOptions("strategy", tree).find((option) => option.choice.id === "train-fedavg");
    expect(fedavg?.available).toBe(false);
  });

  it("restricts LoRA to neural networks", () => {
    const linear = pick(EMPTY_SELECTION, [["goal", "train"], ["partition", "horizontal"], ["modelClass", "linear"]]);
    expect(availableIds(linear, "sharing")).toEqual(["full"]);
  });

  it("clears downstream choices that become invalid when an upstream choice changes", () => {
    const neural = choose(applyTemplate("model-training"), "strategy", "train-fedavg");
    expect(isComplete(neural)).toBe(true);
    const tree = choose(neural, "modelClass", "tree");
    expect(tree.strategy).toBe("train-xgb-histogram");
  });

  it("ignores unavailable choices", () => {
    const vertical = pick(EMPTY_SELECTION, [["goal", "train"], ["partition", "vertical"]]);
    expect(choose(vertical, "modelClass", "neural")).toBe(vertical);
  });

  it("locks the scenario when chosen directly and fills the sub-items", () => {
    const peft = applyTemplate("peft-finetune");
    expect(peft.scenario).toBe("peft-finetune");
    expect([peft.goal, peft.contribution, peft.partition, peft.modelClass, peft.sharing])
      .toEqual(["train", "local-data", "horizontal", "neural", "peft"]);
    expect(peft.strategy).toBe("peft-fedavg");
  });

  it("greys out options that would leave the locked scenario and keeps in-scenario alternatives", () => {
    const peft = applyTemplate("peft-finetune");
    expect(availableIds(peft, "goal")).toEqual(["train"]);
    expect(availableIds(peft, "sharing")).toEqual(["peft"]);
    expect(choose(peft, "sharing", "full")).toBe(peft);

    const training = applyTemplate("model-training");
    expect(availableIds(training, "modelClass")).toEqual(["neural", "tree", "linear"]);
    expect(availableIds(training, "sharing")).toEqual(["full"]);

    expect(availableIds(applyTemplate("federated-analytics"), "partition")).toEqual(["horizontal"]);
    expect(availableIds(applyTemplate("agent-skill"), "contribution")).toEqual(["traces-skills", "trained-artifact"]);
  });

  it("locks the scenario once the underlying choices determine it", () => {
    const partial = pick(EMPTY_SELECTION, [["goal", "train"], ["partition", "horizontal"], ["modelClass", "neural"]]);
    expect(partial.scenario).toBeNull();
    const locked = choose(partial, "sharing", "full");
    expect(locked.scenario).toBe("model-training");
    expect(availableIds(locked, "sharing")).toEqual(["full"]);
    expect(choose(EMPTY_SELECTION, "goal", "retrieval").scenario).toBe("fedrag");
  });

  it("never leaves a locked scenario with a dimension that has no selectable option", () => {
    for (const scenario of SCENARIOS) {
      const selection = applyTemplate(scenario.id);
      for (const layer of SCENARIO_LAYERS) {
        const options = layerOptions(layer, selection);
        if (options.length) expect(options.some((option) => option.available), `${scenario.id}/${layer}`).toBe(true);
      }
      expect(scenarioFor(selection)?.id, scenario.id).toBe(scenario.id);
    }
  });

  it("requires a scenario before any scenario sub-item can be chosen", () => {
    expect(displayOptions("goal", EMPTY_SELECTION).every((option) => !option.available)).toBe(true);
    expect(toggle(EMPTY_SELECTION, "goal", "train")).toBe(EMPTY_SELECTION);
  });

  it("does not let scenario sub-items be deselected, but lets strategies be deselected", () => {
    const training = choose(applyTemplate("model-training"), "strategy", "train-fedprox");
    expect(canDeselect(training, "modelClass")).toBe(false);
    expect(toggle(training, "modelClass", "neural")).toBe(training);
    expect(toggle(training, "strategy", "train-fedprox").strategy).toBeNull();
  });

  it("lists every candidate, and only the chosen scenario's strategies once a scenario is set", () => {
    const contributions = displayOptions("contribution", applyTemplate("agent-skill"));
    expect(contributions).toHaveLength(5);
    expect(contributions.filter((option) => option.available).map((option) => option.choice.id)).toEqual(["traces-skills", "trained-artifact"]);
    expect(displayOptions("strategy", EMPTY_SELECTION)).toHaveLength(STRATEGIES.length);
    const strategies = displayOptions("strategy", applyTemplate("fedrag"));
    expect(strategies.map((option) => option.choice.id)).toEqual(["rag-rrf", "rag-central-rerank"]);
    expect(strategies.every((option) => option.available)).toBe(true);
  });

  it("resets scenario parameters to the new scenario's defaults when the scenario changes", () => {
    const training = choose(applyTemplate("model-training"), "strategy", "train-fedavg");
    expect(training.params.rounds).toBe("20");
    expect(applyTemplate("peft-finetune").params.rounds).toBe("10");
  });

  it("maps every scenario to its own path and at least one strategy", () => {
    for (const scenario of SCENARIOS) {
      const selection = applyTemplate(scenario.id);
      expect(scenarioFor(selection)?.id, scenario.id).toBe(scenario.id);
      expect(availableIds(selection, "strategy").length, scenario.id).toBeGreaterThan(0);
    }
  });

  it("gives every strategy a runner and an open-source reference", () => {
    for (const strategy of STRATEGIES) {
      expect(SCENARIOS.some((scenario) => scenario.id === strategy.scenario), strategy.id).toBe(true);
      expect(strategy.runner, strategy.id).toBeTruthy();
      expect(strategy.references.length, strategy.id).toBeGreaterThan(0);
    }
  });

  it("keeps large-model and agent methods as the only frontier entries", () => {
    expect(SCENARIOS.filter((scenario) => scenario.adoption === "frontier").map((scenario) => scenario.id).sort())
      .toEqual(["agent-skill", "fedrag", "peft-finetune"]);
  });
});

describe("security and privacy", () => {
  it("offers only the enhancements the strategy's runner actually provides", () => {
    expect(availableEnhancements(choose(applyTemplate("model-training"), "strategy", "train-fedavg"))).toEqual(["secagg", "dp"]);
    expect(availableEnhancements(choose(applyTemplate("model-training"), "modelClass", "tree"))).toEqual(["he"]);
    expect(availableEnhancements(applyTemplate("peft-finetune"))).toEqual(["secagg", "dp"]);
    expect(availableEnhancements(choose(applyTemplate("fedrag"), "strategy", "rag-rrf"))).toEqual(["tee"]);
    expect(availableEnhancements(applyTemplate("vertical-modeling"))).toEqual([]);
    expect(availableEnhancements(applyTemplate("federated-analytics"))).toEqual([]);
  });

  it("always includes the baseline protection and protocol built-ins", () => {
    expect(builtinProtection(EMPTY_SELECTION)).toEqual(["mTLS", "隔离沙箱", "审计日志"]);
    const stats = choose(applyTemplate("federated-analytics"), "strategy", "fa-histogram");
    expect(builtinProtection(stats)).toEqual(expect.arrayContaining(["最小计数阈值", "分箱数上限", "统计值加噪"]));
  });

  it("lets secure aggregation and differential privacy be combined", () => {
    const peft = toggleEnhancement(toggleEnhancement(applyTemplate("peft-finetune"), "secagg"), "dp");
    expect(peft.enhancements).toEqual(["secagg", "dp"]);
    expect(toggleEnhancement(peft, "secagg").enhancements).toEqual(["dp"]);
  });

  it("ignores enhancements the runner does not provide", () => {
    const peft = applyTemplate("peft-finetune");
    expect(toggleEnhancement(peft, "he")).toBe(peft);
  });

  it("drops enhancements the new strategy does not support", () => {
    const fedavg = toggleEnhancement(choose(applyTemplate("model-training"), "strategy", "train-fedavg"), "secagg");
    expect(fedavg.enhancements).toEqual(["secagg"]);
    expect(choose(fedavg, "modelClass", "tree").enhancements).toEqual([]);
    expect(toggle(fedavg, "strategy", "train-fedavg").enhancements).toEqual([]);
  });
});
