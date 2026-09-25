import { describe, expect, it } from "vitest";
import { defaultDatasetIds, matchedDatasets } from "./demo";
import { NODE_SETUP, SAMPLE_BYTES, checkUpload, dataContract } from "./inputs";
import { applyTemplate, choose } from "./selection";
import { SCENARIOS, STRATEGIES } from "./taxonomy";

const jsonl = (rows: object[]) => rows.map((row) => JSON.stringify(row)).join("\n");
const file = (name: string, sample: string) => ({ name, size: sample.length, sample });

const memory = dataContract({ scenario: "agent-memory" });
const analytics = dataContract({ scenario: "federated-analytics" });

describe("data contracts, nodes and upload checks", () => {
  it("gives every scenario a contract and enough existing participants for its default path", () => {
    for (const scenario of SCENARIOS) {
      const selection = applyTemplate(scenario.id);
      expect(dataContract({ ...selection, scenario: scenario.id }), scenario.id).toBeDefined();
      expect(defaultDatasetIds(selection).length, scenario.id).toBeGreaterThanOrEqual(scenario.minParticipants);
    }
  });

  it("only accepts uploads for file scenarios and gives node scenarios a start command", () => {
    expect(dataContract({ scenario: "horizontal-training", modelClass: "neural", sharing: "full" }).accept).toEqual([]);
    expect(dataContract({ scenario: "vertical-training" }).accept).toEqual([]);
    expect(analytics.accept).toEqual([".csv"]);
    expect(memory.accept).toEqual([".jsonl"]);
    for (const strategy of STRATEGIES.filter((item) => item.scenario === "horizontal-training" || item.scenario === "vertical-training")) {
      expect(NODE_SETUP[strategy.runner]?.command, strategy.id).toBeTruthy();
    }
  });

  it("matches existing nodes to the chosen sub-items", () => {
    const training = applyTemplate("horizontal-training");
    expect(matchedDatasets(training).every((entry) => entry.provides === "影像分类数据")).toBe(true);
    expect(matchedDatasets(choose(training, "sharing", "peft")).every((entry) => entry.provides === "指令数据 JSONL")).toBe(true);
    expect(matchedDatasets(choose(training, "modelClass", "tree")).every((entry) => entry.provides === "理赔表")).toBe(true);
    expect(dataContract({ scenario: "horizontal-training", modelClass: "neural", sharing: "peft" }).title).toBe("本地指令数据");
    expect(matchedDatasets({ scenario: null })).toEqual([]);
  });

  it("passes a memory file with the required fields and enough records", () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({ type: "experience", content: `经验 ${index}` }));
    const result = checkUpload(memory, file("memory.jsonl", jsonl(rows)));
    expect(result.passed).toBe(true);
    expect(result.records).toBe(6);
  });

  it("explains a wrong format", () => {
    const result = checkUpload(memory, file("memory.csv", "a,b\n1,2"));
    expect(result.passed).toBe(false);
    expect(result.items.find((item) => item.label === "文件格式")?.detail).toContain(".jsonl");
    expect(result.note).toContain("不符合要求");
  });

  it("explains missing fields and too few records", () => {
    const result = checkUpload(memory, file("memory.jsonl", jsonl([{ text: "?" }, { text: "?" }])));
    expect(result.passed).toBe(false);
    expect(result.items.find((item) => item.label === "必需字段")?.ok).toBe(false);
    expect(result.items.find((item) => item.label === "记录条数")?.detail).toContain("至少需要 5 条");
  });

  it("reports the line of invalid JSONL", () => {
    const result = checkUpload(memory, file("memory.jsonl", `{"content":"a"}\nnot json`));
    expect(result.items.find((item) => item.label === "数据结构")?.detail).toContain("第 2 行");
  });

  it("requires a count column in a statistics summary", () => {
    expect(checkUpload(analytics, file("yunnan.csv", "region,age_group,count\n昆明,60+,1200\n大理,60+,800")).passed).toBe(true);
    expect(checkUpload(analytics, file("yunnan.csv", "region,ratio\n昆明,0.21")).passed).toBe(false);
  });

  it("samples large files instead of rejecting them", () => {
    const sample = jsonl(Array.from({ length: 80 }, () => ({ content: "c" })));
    const result = checkUpload(memory, { name: "big.jsonl", size: SAMPLE_BYTES * 4, sample: `${sample}\n{"content":"trunc` });
    expect(result.passed).toBe(true);
    expect(result.items.find((item) => item.label === "记录条数")?.detail).toContain("抽样");
  });
});
