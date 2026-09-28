/**
 * 数据要求与上传检查。
 *
 * 每种数据类型声明格式、必需字段和最少条数。节点类场景的数据留在节点本地，这里只给出要求；
 * 文件类场景的上传文件在浏览器本地抽样检查（只读前 256KB，不上传、不保存），
 * 结果由 Agent 转成通过 / 不通过的说明和修改建议。
 */
import type { DataTypeId, DeploymentId } from "./taxonomy";

type TextFormat = "jsonl" | "json" | "csv";

export type DataContract = {
  title: string;
  requirements: string[];
  /** 允许上传的扩展名；节点类数据为空。 */
  accept: string[];
  /** 文本格式的结构要求：满足任意一组字段即可。 */
  text?: { formats: TextFormat[]; fieldsAnyOf: string[][]; fieldHint: string };
  minRecords?: number;
};

export const SAMPLE_BYTES = 256 * 1024;

const CONTRACTS: Record<DataTypeId, DataContract> = {
  image: {
    title: "本地图像数据",
    requirements: ["各方图像尺寸、类别定义一致", "每张图像带类别标签", "数据留在节点本地，只在本地训练时读取"],
    accept: [],
  },
  table: {
    title: "本地表格数据",
    requirements: ["CSV 或 Parquet，各方列名和列顺序一致", "包含 label 列", "数据留在节点本地，只在本地训练时读取"],
    accept: [],
  },
  instruction: {
    title: "本地指令数据",
    requirements: ["JSONL，每行一条 JSON", "每条包含 messages，或 instruction + output，或 prompt + completion", "基座模型由平台统一分发，各方一致"],
    accept: [],
  },
  "vertical-table": {
    title: "本地特征表",
    requirements: ["CSV，包含对齐主键列 id 或 user_id", "标签方另含 label 列", "主键只在隐私求交时使用，不会以明文发给其他方"],
    accept: [],
  },
  "summary-table": {
    title: "统计汇总表",
    requirements: [
      "CSV，第一行为表头，每行一个分组",
      "分组列（如 地区、年龄段）+ count 列",
      "算均值 / 方差时再加 sum、sum_sq 列；分布用 bin + count",
      "只上传汇总后的数字，不要上传个人明细",
    ],
    accept: [".csv"],
    text: { formats: ["csv"], fieldsAnyOf: [["count"]], fieldHint: "表头需要包含 count 列" },
    minRecords: 1,
  },
  "memory-jsonl": {
    title: "Agent 记忆文件",
    requirements: [
      "JSONL，每行一条记忆",
      "每条包含 content，建议带 type、source、created_at",
      "上传后平台会做敏感信息扫描，请不要包含账号、密钥等",
      "至少 5 条",
    ],
    accept: [".jsonl"],
    text: { formats: ["jsonl"], fieldsAnyOf: [["content"]], fieldHint: "每条需要包含 content" },
    minRecords: 5,
  },
};

export function dataContract(dataType: DataTypeId): DataContract {
  return CONTRACTS[dataType];
}

/**
 * 节点交付方式。各参与方只安装平台的节点程序（一个镜像），里面同时带 Flower 和隐语的运行时，
 * 平台按项目决定启动哪一个。公有云由平台在授权的云账号中创建实例，私有机房用一条命令启动。
 */
export function nodeDelivery(deployment: DeploymentId | string | null): { method: string; command?: string } {
  if (deployment === "on-prem") {
    return {
      method: "在机房服务器上运行节点程序，节点主动连接平台，无需开放入站端口",
      command: "docker run -d --name fs-node --gpus all -v /data:/data studio.example.com/node-agent:latest --join <项目令牌>",
    };
  }
  if (deployment === "hosted") return { method: "由平台隔离沙箱执行，无需部署节点" };
  return { method: "平台在你授权的云账号中按所选规格创建实例，并自动安装节点程序" };
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
