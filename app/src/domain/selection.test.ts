import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  applyTemplate,
  choose,
  currentLayer,
  displayOptions,
  isAutoSelected,
  isComplete,
  layerOptions,
  paramsFor,
  scenarioFor,
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

describe("layered selection", () => {
  it("reveals dimensions one at a time, starting from the goal", () => {
    expect(visibleLayers(EMPTY_SELECTION).map((layer) => layer.id)).toEqual(["goal"]);
    expect(currentLayer(EMPTY_SELECTION)).toBe("goal");

    const withGoal = choose(EMPTY_SELECTION, "goal", "train");
    expect(visibleLayers(withGoal).map((layer) => layer.id)).toEqual(["goal", "contribution"]);
    expect(currentLayer(withGoal)).toBe("contribution");
  });

  it("lists only contributions that make sense for the goal", () => {
    expect(ids(choose(EMPTY_SELECTION, "goal", "train"), "contribution")).toEqual(["local-data", "trained-artifact"]);
    expect(ids(choose(EMPTY_SELECTION, "goal", "evaluate"), "contribution")).toEqual(["local-test-data", "model-endpoint"]);
  });

  it("auto-selects a dimension when only one option remains", () => {
    const analytics = choose(EMPTY_SELECTION, "goal", "analytics");
    expect(analytics.contribution).toBe("local-data");
    expect(isAutoSelected("contribution", analytics)).toBe(true);
  });

  it("skips data relation and model shape where they do not apply", () => {
    const retrieval = choose(EMPTY_SELECTION, "goal", "retrieval");
    const layers = visibleLayers(retrieval).map((layer) => layer.id);
    expect(layers).not.toContain("partition");
    expect(layers).not.toContain("modelClass");
    expect(layers).toContain("topology");
  });

  it("offers only horizontal and vertical data relations", () => {
    const train = pick(EMPTY_SELECTION, [["goal", "train"], ["contribution", "local-data"]]);
    expect(availableIds(train, "partition")).toEqual(["horizontal", "vertical"]);
  });

  it("limits vertical federation to cross-silo and protocol-native encryption", () => {
    const vertical = pick(EMPTY_SELECTION, [["goal", "train"], ["contribution", "local-data"], ["partition", "vertical"]]);
    expect(vertical.topology).toBe("cross-silo");
    expect(visibleLayers(vertical).map((layer) => layer.id)).not.toContain("sharing");

    const tree = choose(vertical, "modelClass", "tree");
    expect(scenarioFor(tree)?.id).toBe("vertical-modeling");
    expect(tree.strategy).toBe("vfl-secureboost");
    expect(tree.protection).toBe("encrypted");
  });

  it("only allows cross-device for horizontal training and analytics", () => {
    const train = pick(EMPTY_SELECTION, [["goal", "train"], ["contribution", "local-data"], ["partition", "horizontal"]]);
    expect(availableIds(train, "topology")).toContain("cross-device");

    const evaluate = pick(EMPTY_SELECTION, [["goal", "evaluate"], ["contribution", "local-test-data"]]);
    expect(availableIds(evaluate, "topology")).not.toContain("cross-device");
  });

  it("prevents tree models from choosing parameter-averaging strategies", () => {
    const tree = pick(EMPTY_SELECTION, [
      ["goal", "train"], ["contribution", "local-data"], ["partition", "horizontal"], ["topology", "cross-silo"], ["modelClass", "tree"],
    ]);
    expect(tree.sharing).toBe("full");
    expect(availableIds(tree, "strategy")).toEqual(["train-xgb-histogram"]);
    expect(tree.strategy).toBe("train-xgb-histogram");
    const fedavg = layerOptions("strategy", tree).find((option) => option.choice.id === "train-fedavg");
    expect(fedavg?.available).toBe(false);
    expect(fedavg?.reason).toContain("树模型");
  });

  it("restricts PEFT to neural networks", () => {
    const linear = pick(EMPTY_SELECTION, [
      ["goal", "train"], ["contribution", "local-data"], ["partition", "horizontal"], ["topology", "cross-silo"], ["modelClass", "linear"],
    ]);
    expect(availableIds(linear, "sharing")).toEqual(["full"]);
  });

  it("derives protection availability from the strategy's compute kind", () => {
    const merge = applyTemplate("model-merge");
    const ties = choose(merge, "strategy", "merge-ties");
    const options = layerOptions("protection", ties);
    expect(options.find((option) => option.choice.id === "hide-updates")?.available).toBe(false);
    expect(options.find((option) => option.choice.id === "encrypted")?.available).toBe(false);
    expect(options.find((option) => option.choice.id === "tee")?.available).toBe(true);

    const weighted = choose(merge, "strategy", "merge-weighted");
    expect(availableIds(weighted, "protection")).toContain("encrypted");
  });

  it("greys out neural networks for vertical data because Split NN is not included", () => {
    const vertical = pick(EMPTY_SELECTION, [["goal", "train"], ["contribution", "local-data"], ["partition", "vertical"]]);
    expect(availableIds(vertical, "modelClass")).toEqual(["tree", "linear"]);
    expect(choose(vertical, "modelClass", "linear").strategy).toBe("vfl-hetero-lr");
  });

  it("clears downstream choices that become invalid when an upstream choice changes", () => {
    const neural = pick(applyTemplate("model-training"), [["strategy", "train-fedavg"], ["protection", "hide-updates"]]);
    expect(isComplete(neural)).toBe(true);

    const tree = choose(neural, "modelClass", "tree");
    expect(tree.sharing).toBe("full");
    // FedAvg 对树模型失效被清掉，直方图聚合是唯一可选项，被自动选中。
    expect(tree.strategy).toBe("train-xgb-histogram");

    const merge = choose(pick(applyTemplate("model-merge"), [["strategy", "merge-weighted"], ["protection", "encrypted"]]), "strategy", "merge-ties");
    expect(merge.protection).toBeNull();
    expect(isComplete(merge)).toBe(false);
  });

  it("keeps downstream choices that are still valid", () => {
    const peft = pick(applyTemplate("peft-finetune"), [["strategy", "peft-fedprox"], ["protection", "standard"]]);
    const device = choose(peft, "topology", "cross-device");
    expect(device.strategy).toBe("peft-fedprox");
    expect(device.protection).toBe("standard");
  });

  it("ignores unavailable choices", () => {
    const vertical = pick(EMPTY_SELECTION, [["goal", "train"], ["contribution", "local-data"], ["partition", "vertical"]]);
    expect(choose(vertical, "topology", "cross-device")).toBe(vertical);
  });

  it("shows strategy-specific parameters only for that strategy", () => {
    const merge = applyTemplate("model-merge");
    expect(paramsFor(choose(merge, "strategy", "merge-weighted")).map((param) => param.id)).not.toContain("density");
    expect(paramsFor(choose(merge, "strategy", "merge-ties")).map((param) => param.id)).toContain("density");
  });

  it("always lists every candidate and greys out those not yet reachable or not supported", () => {
    const empty = displayOptions("topology", EMPTY_SELECTION);
    expect(empty.map((option) => option.choice.id)).toEqual(["cross-silo", "cross-device"]);
    expect(empty.every((option) => !option.available)).toBe(true);

    const train = choose(EMPTY_SELECTION, "goal", "train");
    const contributions = displayOptions("contribution", train);
    expect(contributions).toHaveLength(6);
    expect(contributions.filter((option) => option.available).map((option) => option.choice.id)).toEqual(["local-data", "trained-artifact"]);

    const vertical = pick(train, [["contribution", "local-data"], ["partition", "vertical"]]);
    const topology = displayOptions("topology", vertical);
    expect(topology.filter((option) => option.available).map((option) => option.choice.id)).toEqual(["cross-silo"]);
    expect(topology.every((option) => !("reason" in option))).toBe(true);
  });

  it("lists every strategy grouped by scenario and enables only the matched scenario's", () => {
    const options = displayOptions("strategy", applyTemplate("fedrag"));
    expect(options).toHaveLength(STRATEGIES.length);
    expect(new Set(options.filter((option) => option.available).map((option) => option.group))).toEqual(new Set(["联邦检索 FedRAG"]));
  });

  it("switches the sharing candidates to artifact kinds for trained artifacts", () => {
    const artifacts = pick(EMPTY_SELECTION, [["goal", "train"], ["contribution", "trained-artifact"]]);
    expect(displayOptions("sharing", artifacts).map((option) => option.choice.id)).toEqual(["full-weights", "adapter"]);
  });

  it("resets scenario parameters to the new scenario's defaults when the scenario changes", () => {
    const training = choose(applyTemplate("model-training"), "strategy", "train-fedavg");
    expect(training.params.rounds).toBe("20");
    const peft = applyTemplate("peft-finetune");
    expect(peft.params.rounds).toBe("10");
    expect(peft.params.rank).toBe("16");
  });

  it("locks the scenario when chosen directly and fills dimensions 1–5", () => {
    const peft = applyTemplate("peft-finetune");
    expect(peft.scenario).toBe("peft-finetune");
    expect([peft.goal, peft.contribution, peft.partition, peft.topology, peft.modelClass, peft.sharing])
      .toEqual(["train", "local-data", "horizontal", "cross-silo", "neural", "peft"]);
  });

  it("greys out options that would leave the locked scenario and keeps in-scenario alternatives", () => {
    const peft = applyTemplate("peft-finetune");
    expect(availableIds(peft, "goal")).toEqual(["train"]);
    expect(availableIds(peft, "sharing")).toEqual(["peft"]);
    expect(availableIds(peft, "modelClass")).toEqual(["neural"]);
    expect(availableIds(peft, "topology")).toEqual(["cross-silo", "cross-device"]);
    expect(choose(peft, "sharing", "full")).toBe(peft);

    const device = choose(peft, "topology", "cross-device");
    expect(device.scenario).toBe("peft-finetune");
    expect(scenarioFor(device)?.id).toBe("peft-finetune");

    const training = applyTemplate("model-training");
    expect(availableIds(training, "modelClass")).toEqual(["neural", "tree", "linear"]);
    expect(availableIds(training, "sharing")).toEqual(["full"]);

    const analytics = applyTemplate("federated-analytics");
    expect(availableIds(analytics, "partition")).toEqual(["horizontal", "vertical"]);
    expect(choose(analytics, "partition", "vertical").scenario).toBe("federated-analytics");
  });

  it("locks the scenario once dimension-by-dimension choices determine it", () => {
    const partial = pick(EMPTY_SELECTION, [["goal", "train"], ["contribution", "local-data"], ["partition", "horizontal"], ["topology", "cross-silo"], ["modelClass", "neural"]]);
    expect(partial.scenario).toBeNull();
    expect(availableIds(partial, "sharing")).toEqual(["full", "peft"]);

    const locked = choose(partial, "sharing", "full");
    expect(locked.scenario).toBe("model-training");
    expect(availableIds(locked, "sharing")).toEqual(["full"]);
    expect(availableIds(locked, "goal")).toEqual(["train"]);

    expect(choose(EMPTY_SELECTION, "goal", "retrieval").scenario).toBe("fedrag");
  });

  it("never leaves a locked scenario with a dimension that has no selectable option", () => {
    for (const scenario of SCENARIOS) {
      const selection = applyTemplate(scenario.id);
      for (const layer of ["goal", "contribution", "partition", "topology", "modelClass", "sharing"] as const) {
        const options = layerOptions(layer, selection);
        if (options.length) expect(options.some((option) => option.available), `${scenario.id}/${layer}`).toBe(true);
      }
      expect(scenarioFor(selection)?.id, scenario.id).toBe(scenario.id);
    }
  });

  it("maps every scenario template to its own path and at least one runnable strategy", () => {
    for (const scenario of SCENARIOS) {
      const selection = applyTemplate(scenario.id);
      expect(scenarioFor(selection)?.id, scenario.id).toBe(scenario.id);
      expect(availableIds(selection, "strategy").length, scenario.id).toBeGreaterThan(0);
    }
  });

  it("marks only large-model and agent methods as frontier", () => {
    const frontierScenarios = new Set(STRATEGIES.filter((strategy) => strategy.adoption === "frontier").map((strategy) => strategy.scenario));
    expect(frontierScenarios).toEqual(new Set(["peft-finetune", "model-merge", "fedrag", "agent-skill"]));
    expect(SCENARIOS.filter((scenario) => scenario.adoption === "frontier").map((scenario) => scenario.id).sort())
      .toEqual(["agent-skill", "fedrag", "model-merge", "peft-finetune"]);
  });

  it("gives every strategy a scenario, runner and open-source reference", () => {
    for (const strategy of STRATEGIES) {
      expect(SCENARIOS.some((scenario) => scenario.id === strategy.scenario), strategy.id).toBe(true);
      expect(strategy.runner, strategy.id).toBeTruthy();
      expect(strategy.references.length, strategy.id).toBeGreaterThan(0);
    }
  });
});
