/**
 * 数据契约与上传检查。
 *
 * 每个场景（及各方投入）声明需要什么样的数据：格式、必需字段、最少条数。
 * 用户上传的文件在浏览器本地抽样检查（只读前 256KB，不上传、不保存），
 * 结果由 Agent 转成通过 / 不通过的说明和修改建议。
 */
import type { ScenarioId } from "./taxonomy";

type TextFormat = "jsonl" | "json" | "csv";

export type DataContract = {
  title: string;
  requirements: string[];
  /** 允许的扩展名。 */
  accept: string[];
  /** 文本格式的结构要求：满足任意一组字段即可。 */
  text?: { formats: TextFormat[]; fieldsAnyOf: string[][]; fieldHint: string };
  minRecords?: number;
};

export const SAMPLE_BYTES = 256 * 1024;

const CONTRACTS: Record<string, DataContract> = {
  "model-training": {
    title: "训练数据表",
    requirements: ["CSV 或 Parquet，第一行为表头", "必须包含 label 列", "至少 100 条样本"],
    accept: [".csv", ".parquet"],
    text: { formats: ["csv"], fieldsAnyOf: [["label"]], fieldHint: "表头需要包含 label 列" },
    minRecords: 100,
  },
  "peft-finetune": {
    title: "指令微调数据",
    requirements: ["JSONL，每行一条 JSON", "每条包含 messages，或 instruction + output，或 prompt + completion", "至少 50 条"],
    accept: [".jsonl"],
    text: {
      formats: ["jsonl"],
      fieldsAnyOf: [["messages"], ["instruction", "output"], ["prompt", "completion"]],
      fieldHint: "每条需要包含 messages，或 instruction + output，或 prompt + completion",
    },
    minRecords: 50,
  },
  "model-merge": {
    title: "已训练的模型或 Adapter",
    requirements: ["safetensors 或 bin 权重文件", "与所选场景使用同一基座", "张量结构在后端解析（前端只检查格式和大小）"],
    accept: [".safetensors", ".bin"],
  },
  "vertical-modeling": {
    title: "纵向特征表",
    requirements: ["CSV，第一行为表头", "必须包含对齐主键列 id 或 user_id", "至少 100 条样本"],
    accept: [".csv"],
    text: { formats: ["csv"], fieldsAnyOf: [["id"], ["user_id"]], fieldHint: "表头需要包含 id 或 user_id 作为对齐主键" },
    minRecords: 100,
  },
  "federated-evaluation:local-test-data": {
    title: "本地测试集",
    requirements: ["JSONL 或 CSV", "每条包含 label 或 answer", "至少 50 条"],
    accept: [".jsonl", ".csv"],
    text: { formats: ["jsonl", "csv"], fieldsAnyOf: [["label"], ["answer"]], fieldHint: "每条需要包含 label 或 answer" },
    minRecords: 50,
  },
  "federated-evaluation:model-endpoint": {
    title: "模型服务说明",
    requirements: ["JSON，描述模型服务", "包含 endpoint 或 url 字段"],
    accept: [".json"],
    text: { formats: ["json"], fieldsAnyOf: [["endpoint"], ["url"]], fieldHint: "需要包含 endpoint 或 url 字段" },
  },
  "federated-analytics": {
    title: "统计分析数据表",
    requirements: ["CSV，第一行为表头", "至少包含一列数值字段", "至少 20 条记录"],
    accept: [".csv"],
    text: { formats: ["csv"], fieldsAnyOf: [], fieldHint: "至少需要一列数值字段" },
    minRecords: 20,
  },
  fedrag: {
    title: "知识库或索引说明",
    requirements: ["JSONL 语料（每条包含 text）或 JSON 索引说明（包含 endpoint 或 index）"],
    accept: [".jsonl", ".json"],
    text: { formats: ["jsonl", "json"], fieldsAnyOf: [["text"], ["endpoint"], ["index"]], fieldHint: "语料每条需要包含 text；索引说明需要包含 endpoint 或 index" },
  },
  "agent-skill:traces-skills": {
    title: "轨迹或 Skill 包",
    requirements: ["JSON / JSONL", "每条包含 skill、steps 或 trajectory", "至少 5 条"],
    accept: [".json", ".jsonl"],
    text: { formats: ["json", "jsonl"], fieldsAnyOf: [["skill"], ["steps"], ["trajectory"]], fieldHint: "每条需要包含 skill、steps 或 trajectory" },
    minRecords: 5,
  },
  "agent-skill:trained-artifact": {
    title: "Agent Adapter",
    requirements: ["safetensors 权重文件", "张量结构在后端解析（前端只检查格式和大小）"],
    accept: [".safetensors"],
  },
};

export function dataContract(scenario: ScenarioId, contribution: string | null): DataContract {
  return CONTRACTS[`${scenario}:${contribution}`] ?? CONTRACTS[scenario];
}

export type UploadCheckItem = { label: string; ok: boolean; detail: string };

export type UploadCheck = {
  passed: boolean;
  records: number | null;
  items: UploadCheckItem[];
  /** Agent 给出的说明。 */
  note: string;
};

export type UploadFile = { name: string; size: number; sample?: string };

const extensionOf = (name: string) => {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
};

export const isTextFile = (name: string) => [".jsonl", ".json", ".csv"].includes(extensionOf(name));

type Parsed = { records: number; fields: string[][]; numericColumn?: boolean; error?: string };

function parseSample(format: TextFormat, sample: string, truncated: boolean): Parsed {
  if (format === "csv") {
    const lines = sample.split(/\r?\n/).filter((line) => line.trim());
    if (truncated && lines.length > 1) lines.pop();
    if (!lines.length) return { records: 0, fields: [], error: "文件为空" };
    const header = lines[0].split(",").map((cell) => cell.trim().replace(/^"|"$/g, "").toLowerCase());
    const rows = lines.slice(1).map((line) => line.split(","));
    const numericColumn = header.some((_, column) => rows.length > 0 && rows.every((row) => row[column] !== undefined && row[column].trim() !== "" && !Number.isNaN(Number(row[column]))));
    return { records: rows.length, fields: [header], numericColumn };
  }
  if (format === "jsonl") {
    const lines = sample.split(/\r?\n/).filter((line) => line.trim());
    if (truncated && lines.length > 1) lines.pop();
    const fields: string[][] = [];
    for (const [index, line] of lines.entries()) {
      try {
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== "object" || Array.isArray(value)) return { records: index, fields, error: `第 ${index + 1} 行不是 JSON 对象` };
        fields.push(Object.keys(value));
      } catch {
        return { records: index, fields, error: `第 ${index + 1} 行不是合法 JSON` };
      }
    }
    return { records: lines.length, fields };
  }
  if (truncated) return { records: 0, fields: [], error: "JSON 文件超过 256KB，前端无法完整解析" };
  try {
    const value: unknown = JSON.parse(sample);
    const list = Array.isArray(value) ? value : [value];
    if (list.some((item) => !item || typeof item !== "object" || Array.isArray(item))) return { records: 0, fields: [], error: "JSON 内容需要是对象或对象数组" };
    return { records: list.length, fields: list.map((item) => Object.keys(item as object)) };
  } catch {
    return { records: 0, fields: [], error: "不是合法 JSON" };
  }
}

/** 检查一个上传文件是否符合数据契约。纯函数，确定性。 */
export function checkUpload(contract: DataContract, file: UploadFile): UploadCheck {
  const items: UploadCheckItem[] = [];
  const extension = extensionOf(file.name);
  const formatOk = contract.accept.includes(extension);
  items.push({ label: "文件格式", ok: formatOk, detail: formatOk ? extension : `需要 ${contract.accept.join(" / ")}，收到 ${extension || "无扩展名"}` });
  items.push({ label: "文件大小", ok: file.size > 0, detail: file.size > 0 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : "文件为空" });

  let records: number | null = null;
  const format = extension.slice(1) as TextFormat;
  if (formatOk && contract.text && contract.text.formats.includes(format) && file.sample !== undefined) {
    const parsed = parseSample(format, file.sample, file.size > SAMPLE_BYTES);
    records = parsed.records;
    if (parsed.error) {
      items.push({ label: "数据结构", ok: false, detail: parsed.error });
    } else {
      const groups = contract.text.fieldsAnyOf;
      const fieldsOk = groups.length
        ? parsed.fields.length > 0 && parsed.fields.every((keys) => groups.some((group) => group.every((field) => keys.map((key) => key.toLowerCase()).includes(field))))
        : Boolean(parsed.numericColumn);
      items.push({ label: "必需字段", ok: fieldsOk, detail: fieldsOk ? "已包含所需字段" : contract.text.fieldHint });
    }
    if (contract.minRecords !== undefined && !parsed.error) {
      const enough = parsed.records >= contract.minRecords;
      const sampled = file.size > SAMPLE_BYTES ? "（按前 256KB 抽样）" : "";
      items.push({ label: "记录条数", ok: enough, detail: `${parsed.records} 条${sampled}，至少需要 ${contract.minRecords} 条` });
    }
  } else if (formatOk && !contract.text) {
    items.push({ label: "权重结构", ok: true, detail: "二进制权重，张量结构需在后端解析（前端模拟）" });
  }

  const failed = items.filter((item) => !item.ok);
  return {
    passed: failed.length === 0,
    records,
    items,
    note: failed.length
      ? `不符合要求：${failed.map((item) => `${item.label}（${item.detail}）`).join("；")}。请修改后重新上传。`
      : "数据符合要求，可以参与本次运行。",
  };
}
