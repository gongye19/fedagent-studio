import { describe, expect, it } from "vitest";
import { SAMPLE_BYTES, checkUpload, dataContract, nodeDelivery } from "./inputs";
import { DATA_TYPES } from "./taxonomy";

const jsonl = (rows: object[]) => rows.map((row) => JSON.stringify(row)).join("\n");
const file = (name: string, sample: string) => ({ name, size: sample.length, sample });

const memory = dataContract("memory-jsonl");
const analytics = dataContract("summary-table");

describe("data requirements and upload checks", () => {
  it("gives every data type requirements, and only upload types accept files", () => {
    for (const type of DATA_TYPES) expect(dataContract(type.id).requirements.length, type.id).toBeGreaterThan(0);
    expect(dataContract("instruction").accept).toEqual([]);
    expect(dataContract("vertical-table").accept).toEqual([]);
    expect(analytics.accept).toEqual([".csv"]);
    expect(memory.accept).toEqual([".jsonl"]);
  });

  it("delivers nodes by cloud instance or by an install command on premises", () => {
    expect(nodeDelivery("aliyun").command).toBeUndefined();
    expect(nodeDelivery("on-prem").command).toContain("docker run");
    expect(nodeDelivery("hosted").method).toContain("无需部署节点");
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
