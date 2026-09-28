import { describe, expect, it } from "vitest";
import { DIMENSIONS, ITEMS } from "./dimensions";
import {
  EMPTY_SELECTION,
  applyScenario,
  choose,
  isComplete,
  itemState,
  valueLabel,
  visibleItems,
  type ItemId,
  type Selection,
} from "./selection";
import { SCENARIOS } from "./taxonomy";

const available = (selection: Selection, id: ItemId) => itemState(id, selection).candidates
  .filter((candidate) => candidate.available)
  .map((candidate) => candidate.choice.id);
const shown = (selection: Selection, id: ItemId) => itemState(id, selection).candidates.map((candidate) => candidate.choice.id);
const mode = (selection: Selection, id: ItemId) => itemState(id, selection).mode;
const pick = (selection: Selection, steps: [ItemId, string][]) => steps.reduce((current, [id, value]) => choose(current, id, value), selection);

const horizontal = () => applyScenario("horizontal-training");

describe("seven configuration dimensions", () => {
  it("orders the dimensions like a cloud order and gives every item a dimension", () => {
    expect(DIMENSIONS.map((dimension) => dimension.title)).toEqual(["协作场景", "参与方与算力", "数据", "模型", "算法与训练", "安全与隐私", "评测与交付"]);
    for (const item of ITEMS) expect(DIMENSIONS.some((dimension) => dimension.id === item.dimension), item.id).toBe(true);
  });

  it("shows only the scenario before a scenario is chosen", () => {
    expect(isComplete(EMPTY_SELECTION)).toBe(false);
    for (const dimension of DIMENSIONS.slice(1)) expect(visibleItems(dimension.id, EMPTY_SELECTION), `${dimension.id}`).toEqual([]);
  });

  it("fills a complete recommended configuration as soon as a scenario is chosen", () => {
    for (const scenario of SCENARIOS) {
      const selection = applyScenario(scenario.id);
      expect(isComplete(selection), scenario.id).toBe(true);
    }
    const training = horizontal();
    expect([training.compute, training.dataType, training.model, training.sharing, training.aggregation, training.rounds])
      .toEqual(["gpu-24", "instruction", "qwen2.5-1.5b", "lora", "fedavg", "10"]);
  });

  it("clears the configuration when the chosen scenario is clicked again", () => {
    expect(choose(horizontal(), "scenario", "horizontal-training")).toEqual(EMPTY_SELECTION);
  });

  it("keeps a single-choice item selected when it is clicked again", () => {
    const training = horizontal();
    expect(choose(training, "compute", "gpu-24")).toBe(training);
  });
});

describe("dependencies between dimensions", () => {
  it("greys out instruction data and large models on CPU-only nodes", () => {
    const cpu = choose(horizontal(), "compute", "cpu-general");
    expect(available(cpu, "dataType")).toEqual(["image", "table"]);
    expect(cpu.dataType).toBe("image");
    expect(cpu.model).toBe("resnet18");
  });

  it("lists only the models that match the data type", () => {
    const table = choose(horizontal(), "dataType", "table");
    expect(shown(table, "model")).toEqual(["mlp", "xgboost", "logreg"]);
    expect(shown(horizontal(), "model")).toEqual(["qwen2.5-1.5b", "qwen3-1.7b", "llama-3.2-3b"]);
  });

  it("needs 24 GB for Llama LoRA and falls back to QLoRA on 16 GB", () => {
    const llama = choose(horizontal(), "model", "llama-3.2-3b");
    expect(available(llama, "sharing")).toEqual(["lora", "qlora"]);
    const small = choose(llama, "compute", "gpu-16");
    expect(small.model).toBe("llama-3.2-3b");
    expect(available(small, "sharing")).toEqual(["qlora"]);
    expect(small.sharing).toBe("qlora");
  });

  it("locks XGBoost to Bagging and disables secure aggregation and differential privacy", () => {
    const xgb = pick(horizontal(), [["dataType", "table"], ["model", "xgboost"]]);
    expect(mode(xgb, "aggregation")).toBe("locked");
    expect(xgb.aggregation).toBe("xgb-bagging");
    expect(available(xgb, "secagg")).toEqual(["off"]);
    expect(available(xgb, "dp")).toEqual(["off"]);
    expect(itemState("localEpochs", xgb).title).toBe("每轮本地新增树");
  });

  it("offers secure aggregation and 50% sampling only with three or more parties", () => {
    const two = choose(horizontal(), "partyScale", "2");
    expect(available(two, "secagg")).toEqual(["off"]);
    expect(available(two, "sampling")).toEqual(["all"]);
    const group = choose(horizontal(), "partyScale", "3-5");
    expect(available(group, "secagg")).toEqual(["off", "secagg-plus"]);
  });

  it("resets an invalid downstream choice to its recommended value", () => {
    const secagg = pick(horizontal(), [["secagg", "secagg-plus"], ["sampling", "half"]]);
    const two = choose(secagg, "partyScale", "2");
    expect(two.secagg).toBe("off");
    expect(two.sampling).toBe("all");
  });

  it("needs a compute-optimized node for SecureBoost", () => {
    const vertical = applyScenario("vertical-training");
    expect(vertical.model).toBe("secureboost");
    const general = choose(vertical, "compute", "cpu-general");
    expect(available(general, "model")).toEqual(["ss-lr"]);
    expect(general.model).toBe("ss-lr");
    expect(general.crypto).toBe("secret-sharing");
    expect(mode(general, "crypto")).toBe("locked");
  });

  it("offers the SecretFlow PSI protocols and homomorphic schemes for vertical training", () => {
    const vertical = applyScenario("vertical-training");
    expect(shown(vertical, "alignment")).toEqual(["ecdh-psi", "rr22-psi"]);
    expect(shown(vertical, "crypto")).toEqual(["ou", "paillier"]);
    expect([vertical.partyScale, vertical.network, vertical.rounds]).toEqual(["2", "leased", "100"]);
    expect(itemState("rounds", vertical).title).toBe("树数量");
  });
});

describe("items per scenario", () => {
  it("hides node resources for upload scenarios and runs them hosted", () => {
    const stats = applyScenario("federated-analytics");
    expect(mode(stats, "compute")).toBe("hidden");
    expect(mode(stats, "network")).toBe("hidden");
    expect(mode(stats, "deployment")).toBe("locked");
    expect(valueLabel("deployment", stats)).toBe("平台托管");
    expect(mode(stats, "rounds")).toBe("locked");
  });

  it("lets analytics choose the statistics, privacy noise and the minimum group size", () => {
    const stats = applyScenario("federated-analytics");
    expect(shown(stats, "model")).toEqual(["stats-basic", "stats-distribution"]);
    expect(available(stats, "dp")).toEqual(["off", "8", "3", "1"]);
    expect(stats.outputProtection).toBe("10");
  });

  it("fixes almost everything for Agent memory federation", () => {
    const memory = applyScenario("agent-memory");
    const choices = ITEMS.filter((item) => item.id !== "scenario" && mode(memory, item.id) === "choice").map((item) => item.id);
    expect(choices).toEqual(["partyScale", "deliveryScope"]);
    expect(valueLabel("aggregation", memory)).toBe("去重与冲突仲裁");
    expect(valueLabel("outputProtection", memory)).toBe("敏感信息脱敏");
  });

  it("derives the deliverable from the model", () => {
    expect(valueLabel("deliverable", horizontal())).toBe("LoRA Adapter");
    expect(valueLabel("deliverable", choose(horizontal(), "dataType", "image"))).toBe("全局模型权重");
    expect(valueLabel("deliverable", applyScenario("vertical-training"))).toBe("分片联合模型");
  });
});
