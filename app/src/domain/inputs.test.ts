import { describe, expect, it } from "vitest";
import { defaultDatasetIds, matchedDatasets } from "./demo";
import { SAMPLE_BYTES, checkUpload, dataContract } from "./inputs";
import { applyTemplate, choose } from "./selection";
import { SCENARIOS } from "./taxonomy";

const jsonl = (rows: object[]) => rows.map((row) => JSON.stringify(row)).join("\n");
const file = (name: string, sample: string) => ({ name, size: sample.length, sample });

describe("data contracts and upload checks", () => {
  it("gives every scenario a contract and enough matched federated data for its default path", () => {
    for (const scenario of SCENARIOS) {
      const selection = applyTemplate(scenario.id);
      expect(dataContract(scenario.id, selection.contribution), scenario.id).toBeDefined();
      expect(defaultDatasetIds(selection).length, scenario.id).toBeGreaterThanOrEqual(scenario.minParticipants);
    }
  });

  it("matches federated data to the chosen sub-items", () => {
    const training = applyTemplate("model-training");
    expect(matchedDatasets(training).every((entry) => entry.provides === "影像分类数据")).toBe(true);
    const tree = choose(training, "modelClass", "tree");
    expect(matchedDatasets(tree).every((entry) => entry.provides === "表格数据")).toBe(true);
    expect(matchedDatasets({ scenario: null })).toEqual([]);
  });

  it("passes a JSONL file with the required fields and enough records", () => {
    const contract = dataContract("peft-finetune", "local-data");
    const rows = Array.from({ length: 50 }, () => ({ messages: [{ role: "user", content: "hi" }] }));
    const result = checkUpload(contract, file("chat.jsonl", jsonl(rows)));
    expect(result.passed).toBe(true);
    expect(result.records).toBe(50);
  });

  it("explains a wrong format", () => {
    const result = checkUpload(dataContract("peft-finetune", "local-data"), file("chat.csv", "a,b\n1,2"));
    expect(result.passed).toBe(false);
    expect(result.items.find((item) => item.label === "文件格式")?.detail).toContain(".jsonl");
    expect(result.note).toContain("不符合要求");
  });

  it("explains missing fields and too few records", () => {
    const contract = dataContract("peft-finetune", "local-data");
    const result = checkUpload(contract, file("chat.jsonl", jsonl([{ question: "?" }, { question: "?" }])));
    expect(result.passed).toBe(false);
    expect(result.items.find((item) => item.label === "必需字段")?.ok).toBe(false);
    expect(result.items.find((item) => item.label === "记录条数")?.detail).toContain("至少需要 50 条");
  });

  it("reports the line of invalid JSONL", () => {
    const result = checkUpload(dataContract("peft-finetune", "local-data"), file("chat.jsonl", `{"messages":[]}\nnot json`));
    expect(result.items.find((item) => item.label === "数据结构")?.detail).toContain("第 2 行");
  });

  it("checks CSV headers for the alignment key and numeric columns", () => {
    const rows = Array.from({ length: 120 }, (_, index) => `${index},${index * 2}`).join("\n");
    expect(checkUpload(dataContract("vertical-modeling", "local-data"), file("features.csv", `user_id,amount\n${rows}`)).passed).toBe(true);
    expect(checkUpload(dataContract("vertical-modeling", "local-data"), file("features.csv", `name,amount\n${rows}`)).passed).toBe(false);

    const analytics = dataContract("federated-analytics", "local-data");
    const numeric = Array.from({ length: 25 }, (_, index) => `a${index},${index}`).join("\n");
    expect(checkUpload(analytics, file("stats.csv", `name,age\n${numeric}`)).passed).toBe(true);
    const text = Array.from({ length: 25 }, (_, index) => `a${index},b${index}`).join("\n");
    expect(checkUpload(analytics, file("stats.csv", `name,city\n${text}`)).passed).toBe(false);
  });

  it("only checks format and size for binary weights", () => {
    const contract = dataContract("model-merge", "trained-artifact");
    expect(checkUpload(contract, { name: "adapter.safetensors", size: 4096 }).passed).toBe(true);
    expect(checkUpload(contract, { name: "adapter.safetensors", size: 0 }).passed).toBe(false);
  });

  it("samples large files instead of rejecting them", () => {
    const contract = dataContract("peft-finetune", "local-data");
    const sample = jsonl(Array.from({ length: 80 }, () => ({ prompt: "p", completion: "c" })));
    const result = checkUpload(contract, { name: "big.jsonl", size: SAMPLE_BYTES * 4, sample: `${sample}\n{"prompt":"trunc` });
    expect(result.passed).toBe(true);
    expect(result.items.find((item) => item.label === "记录条数")?.detail).toContain("抽样");
  });
});
