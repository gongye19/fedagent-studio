/**
 * 前端演示数据：平台上已有的参与方（已连接的节点 / 已提交的文件）和每个场景的评测指标。
 *
 * 这些都是虚构的样例，只为让时间轴每一步有可看的内容。接入后端后由真实的
 * 数据登记记录、manifest 和评测结果替代，不应被当作平台能力的证明。
 */
import type { LayerId } from "./selection";
import type { ScenarioId } from "./taxonomy";

export type Participant = {
  id: string;
  name: string;
  role: string;
  provides: string;
  detail: string;
  /** catalog：平台上已有的参与方；upload：我方上传的文件；node：我方连接的节点。 */
  source: "catalog" | "upload" | "node";
};

/**
 * 平台上已有的参与方：
 * - 节点类场景：已连接平台的参与方节点，数据留在节点本地，平台只看到节点上报的摘要；
 * - 文件类场景：其他参与方已提交的文件。
 */
export type CatalogEntry = Participant & {
  scenario: ScenarioId;
  /** 只在这些子项取值下匹配；缺省表示场景内都匹配。 */
  when?: Partial<Record<LayerId, string>>;
};

type Seed = Omit<CatalogEntry, "id" | "source" | "scenario" | "when">;

function entries(scenario: ScenarioId, key: string, when: CatalogEntry["when"], list: Seed[]): CatalogEntry[] {
  return list.map((item, index) => ({ ...item, id: `${key}-${index + 1}`, source: "catalog", scenario, when }));
}

export const DATA_CATALOG: CatalogEntry[] = [
  ...entries("horizontal-training", "hfl-image", { modelClass: "neural", sharing: "full" }, [
    { name: "医院 A 影像节点", role: "参与方节点", provides: "影像分类数据", detail: "1,240 样本 · 在线" },
    { name: "医院 B 影像节点", role: "参与方节点", provides: "影像分类数据", detail: "980 样本 · 在线" },
    { name: "医院 C 影像节点", role: "参与方节点", provides: "影像分类数据", detail: "1,560 样本 · 在线" },
    { name: "医院 D 影像节点", role: "参与方节点", provides: "影像分类数据", detail: "730 样本 · 在线" },
  ]),
  ...entries("horizontal-training", "hfl-lora", { modelClass: "neural", sharing: "peft" }, [
    { name: "律所 A 节点", role: "参与方节点", provides: "指令数据 JSONL", detail: "3,200 条 · 在线" },
    { name: "券商 B 节点", role: "参与方节点", provides: "指令数据 JSONL", detail: "2,450 条 · 在线" },
    { name: "媒体 C 节点", role: "参与方节点", provides: "指令数据 JSONL", detail: "4,100 条 · 在线" },
    { name: "高校 D 节点", role: "参与方节点", provides: "指令数据 JSONL", detail: "1,800 条 · 在线" },
  ]),
  ...entries("horizontal-training", "hfl-tree", { modelClass: "tree" }, [
    { name: "保险 A 节点", role: "参与方节点", provides: "理赔表", detail: "42,000 行 · 36 列 · 在线" },
    { name: "保险 B 节点", role: "参与方节点", provides: "理赔表", detail: "31,500 行 · 36 列 · 在线" },
    { name: "保险 C 节点", role: "参与方节点", provides: "理赔表", detail: "27,800 行 · 36 列 · 在线" },
  ]),
  ...entries("horizontal-training", "hfl-linear", { modelClass: "linear" }, [
    { name: "银行 A 节点", role: "参与方节点", provides: "信用表", detail: "58,000 行 · 18 列 · 在线" },
    { name: "银行 B 节点", role: "参与方节点", provides: "信用表", detail: "44,000 行 · 18 列 · 在线" },
    { name: "银行 C 节点", role: "参与方节点", provides: "信用表", detail: "39,000 行 · 18 列 · 在线" },
  ]),
  ...entries("vertical-training", "vfl", undefined, [
    { name: "银行 A 节点", role: "标签方", provides: "交易特征 + 标签", detail: "12 个特征 · 52,000 用户 · 在线" },
    { name: "电商 B 节点", role: "特征方", provides: "消费特征", detail: "28 个特征 · 81,000 用户 · 在线" },
    { name: "运营商 C 节点", role: "特征方", provides: "通信特征", detail: "9 个特征 · 64,000 用户 · 在线" },
  ]),
  ...entries("federated-analytics", "fa", undefined, [
    { name: "云南省统计汇总表", role: "已提交", provides: "分组统计表", detail: "地区 × 年龄段 · 新增人口、60 岁以上人口" },
    { name: "安徽省统计汇总表", role: "已提交", provides: "分组统计表", detail: "地区 × 年龄段 · 新增人口、60 岁以上人口" },
    { name: "浙江省统计汇总表", role: "已提交", provides: "分组统计表", detail: "地区 × 年龄段 · 新增人口、60 岁以上人口" },
    { name: "四川省统计汇总表", role: "已提交", provides: "分组统计表", detail: "地区 × 年龄段 · 新增人口、60 岁以上人口" },
  ]),
  ...entries("agent-memory", "mem", undefined, [
    { name: "研究组 Agent 记忆", role: "已提交", provides: "记忆文件 JSONL", detail: "214 条 · 文献检索与总结" },
    { name: "运维组 Agent 记忆", role: "已提交", provides: "记忆文件 JSONL", detail: "167 条 · 故障排查" },
    { name: "客服组 Agent 记忆", role: "已提交", provides: "记忆文件 JSONL", detail: "305 条 · 工单分类与回复" },
  ]),
];

type SelectionLike = { scenario: ScenarioId | null } & Partial<Record<LayerId, string | null>>;

/** 按已选场景和子项匹配平台上已有的参与方。 */
export function matchedDatasets(selection: SelectionLike): CatalogEntry[] {
  if (!selection.scenario) return [];
  return DATA_CATALOG.filter((entry) => (
    entry.scenario === selection.scenario
    && Object.entries(entry.when ?? {}).every(([layer, value]) => selection[layer as LayerId] === value)
  ));
}

/** 默认勾选：纵向默认一个标签方 + 一个特征方，其余默认前 3 个。 */
export function defaultDatasetIds(selection: SelectionLike): string[] {
  const matched = matchedDatasets(selection);
  return matched.slice(0, selection.scenario === "vertical-training" ? 2 : 3).map((entry) => entry.id);
}

export type MetricRule = "higher" | "lower" | "max-drop";

export type DemoMetric = {
  name: string;
  baselineLabel: string;
  baseline: number;
  output: number;
  rule: MetricRule;
  /** max-drop 允许的最大下降；lower 允许的上限。 */
  tolerance?: number;
  format: "percent" | "decimal";
};

/** 评测闸门的演示指标，键为 FrontendRunPlan.metricsKey。baseline 的含义随场景不同，由 baselineLabel 说明。 */
export const DEMO_METRICS: Record<string, DemoMetric[]> = {
  "horizontal-training": [
    { name: "Accuracy", baselineLabel: "最好的单方模型", baseline: 0.81, output: 0.87, rule: "higher", format: "percent" },
    { name: "Macro-F1", baselineLabel: "最好的单方模型", baseline: 0.77, output: 0.84, rule: "higher", format: "percent" },
  ],
  "horizontal-training:peft": [
    { name: "领域任务得分", baselineLabel: "基础模型", baseline: 0.62, output: 0.71, rule: "higher", format: "percent" },
    { name: "通用能力（回归检查）", baselineLabel: "基础模型", baseline: 0.74, output: 0.73, rule: "max-drop", tolerance: 0.02, format: "percent" },
  ],
  "vertical-training": [
    { name: "AUC", baselineLabel: "标签方单方模型", baseline: 0.71, output: 0.79, rule: "higher", format: "decimal" },
    { name: "KS", baselineLabel: "标签方单方模型", baseline: 0.32, output: 0.41, rule: "higher", format: "decimal" },
  ],
  "federated-analytics": [
    { name: "与明细直算的误差", baselineLabel: "允许上限", baseline: 0.01, output: 0.004, rule: "lower", tolerance: 0.01, format: "percent" },
    { name: "低于最小分组的单元格", baselineLabel: "允许上限", baseline: 0, output: 0, rule: "lower", tolerance: 0, format: "decimal" },
  ],
  "agent-memory": [
    { name: "沙箱回放成功率", baselineLabel: "各组原记忆", baseline: 0.68, output: 0.77, rule: "higher", format: "percent" },
    { name: "残留敏感信息", baselineLabel: "允许上限", baseline: 0, output: 0, rule: "lower", tolerance: 0, format: "decimal" },
  ],
};
