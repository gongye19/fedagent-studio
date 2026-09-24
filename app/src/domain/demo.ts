/**
 * 前端演示数据：已登记的联邦数据目录和每个场景的评测指标。
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
  source: "catalog" | "upload";
};

/** 登记在平台上的联邦数据：只登记契约和摘要，数据本身留在参与方本地。 */
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
  ...entries("model-training", "mt-image", { modelClass: "neural" }, [
    { name: "医院 A 影像数据", role: "参与方", provides: "影像分类数据", detail: "1,240 样本 · 已登记 schema" },
    { name: "医院 B 影像数据", role: "参与方", provides: "影像分类数据", detail: "980 样本 · 已登记 schema" },
    { name: "医院 C 影像数据", role: "参与方", provides: "影像分类数据", detail: "1,560 样本 · 已登记 schema" },
    { name: "医院 D 影像数据", role: "参与方", provides: "影像分类数据", detail: "730 样本 · 已登记 schema" },
  ]),
  ...entries("model-training", "mt-tabular-tree", { modelClass: "tree" }, [
    { name: "保险 A 理赔表", role: "参与方", provides: "表格数据", detail: "42,000 行 · 36 列" },
    { name: "保险 B 理赔表", role: "参与方", provides: "表格数据", detail: "31,500 行 · 36 列" },
    { name: "保险 C 理赔表", role: "参与方", provides: "表格数据", detail: "27,800 行 · 36 列" },
  ]),
  ...entries("model-training", "mt-tabular-linear", { modelClass: "linear" }, [
    { name: "银行 A 信用表", role: "参与方", provides: "表格数据", detail: "58,000 行 · 18 列" },
    { name: "银行 B 信用表", role: "参与方", provides: "表格数据", detail: "44,000 行 · 18 列" },
    { name: "银行 C 信用表", role: "参与方", provides: "表格数据", detail: "39,000 行 · 18 列" },
  ]),
  ...entries("peft-finetune", "peft-silo", undefined, [
    { name: "律所 A 问答数据", role: "参与方", provides: "指令数据 JSONL", detail: "3,200 条 · chat 模板" },
    { name: "券商 B 研报数据", role: "参与方", provides: "指令数据 JSONL", detail: "2,450 条 · chat 模板" },
    { name: "媒体 C 摘要数据", role: "参与方", provides: "指令数据 JSONL", detail: "4,100 条 · chat 模板" },
    { name: "高校 D 教学数据", role: "参与方", provides: "指令数据 JSONL", detail: "1,800 条 · chat 模板" },
  ]),
  ...entries("vertical-modeling", "vfl", undefined, [
    { name: "银行 A 交易特征", role: "Guest · 持有标签", provides: "特征表 + PSI key", detail: "12 个特征 · 52,000 用户" },
    { name: "电商 B 消费特征", role: "Host", provides: "特征表 + PSI key", detail: "28 个特征 · 81,000 用户" },
    { name: "运营商 C 通信特征", role: "Host", provides: "特征表 + PSI key", detail: "9 个特征 · 64,000 用户" },
  ]),
  ...entries("federated-evaluation", "eval-local", undefined, [
    { name: "站点 A 测试集", role: "评测节点", provides: "本地测试集", detail: "2,000 条 · 已脱敏" },
    { name: "站点 B 测试集", role: "评测节点", provides: "本地测试集", detail: "1,600 条 · 已脱敏" },
    { name: "站点 C 测试集", role: "评测节点", provides: "本地测试集", detail: "2,400 条 · 已脱敏" },
  ]),
  ...entries("federated-analytics", "fa-horizontal", undefined, [
    { name: "医院 A 住院数据", role: "参与方", provides: "统计分析表", detail: "年龄、住院天数、费用 · 18,000 行" },
    { name: "医院 B 住院数据", role: "参与方", provides: "统计分析表", detail: "年龄、住院天数、费用 · 12,500 行" },
    { name: "医院 C 住院数据", role: "参与方", provides: "统计分析表", detail: "年龄、住院天数、费用 · 21,000 行" },
  ]),
  ...entries("fedrag", "rag", undefined, [
    { name: "医院知识库", role: "检索节点", provides: "检索 Endpoint + 索引", detail: "FAISS · 42,000 片段" },
    { name: "药企文献库", role: "检索节点", provides: "检索 Endpoint + 索引", detail: "Qdrant · 18,000 片段" },
    { name: "高校论文库", role: "检索节点", provides: "检索 Endpoint + 索引", detail: "FAISS · 65,000 片段" },
  ]),
  ...entries("agent-skill", "agent-skill", { contribution: "traces-skills" }, [
    { name: "研究组 Skill 包", role: "产物", provides: "经验卡 · 214 条", detail: "文献检索与总结" },
    { name: "运维组 Skill 包", role: "产物", provides: "经验卡 · 167 条", detail: "故障排查" },
    { name: "客服组 Skill 包", role: "产物", provides: "经验卡 · 305 条", detail: "工单分类与回复" },
  ]),
  ...entries("agent-skill", "agent-adapter", { contribution: "trained-artifact" }, [
    { name: "research-agent-lora", role: "产物", provides: "Agent Adapter", detail: "rank 16 · 文献检索任务" },
    { name: "ops-agent-lora", role: "产物", provides: "Agent Adapter", detail: "rank 16 · 运维任务" },
    { name: "support-agent-lora", role: "产物", provides: "Agent Adapter", detail: "rank 16 · 客服任务" },
  ]),
];

type SelectionLike = { scenario: ScenarioId | null } & Partial<Record<LayerId, string | null>>;

/** 按已选场景和子项匹配已登记的联邦数据。 */
export function matchedDatasets(selection: SelectionLike): CatalogEntry[] {
  if (!selection.scenario) return [];
  return DATA_CATALOG.filter((entry) => (
    entry.scenario === selection.scenario
    && Object.entries(entry.when ?? {}).every(([layer, value]) => selection[layer as LayerId] === value)
  ));
}

/** 默认勾选的数据：纵向默认一个 Guest + 一个 Host，其余默认前 3 个。 */
export function defaultDatasetIds(selection: SelectionLike): string[] {
  const matched = matchedDatasets(selection);
  return matched.slice(0, selection.scenario === "vertical-modeling" ? 2 : 3).map((entry) => entry.id);
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

/** 评测闸门的演示指标。baseline 的含义随场景不同，由 baselineLabel 说明。 */
export const DEMO_METRICS: Record<ScenarioId, DemoMetric[]> = {
  "model-training": [
    { name: "Accuracy", baselineLabel: "最好的单方模型", baseline: 0.81, output: 0.87, rule: "higher", format: "percent" },
    { name: "Macro-F1", baselineLabel: "最好的单方模型", baseline: 0.77, output: 0.84, rule: "higher", format: "percent" },
  ],
  "peft-finetune": [
    { name: "领域任务得分", baselineLabel: "基础模型", baseline: 0.62, output: 0.71, rule: "higher", format: "percent" },
    { name: "通用能力（回归检查）", baselineLabel: "基础模型", baseline: 0.74, output: 0.73, rule: "max-drop", tolerance: 0.02, format: "percent" },
  ],
  "vertical-modeling": [
    { name: "AUC", baselineLabel: "Guest 单方模型", baseline: 0.71, output: 0.79, rule: "higher", format: "decimal" },
    { name: "KS", baselineLabel: "Guest 单方模型", baseline: 0.32, output: 0.41, rule: "higher", format: "decimal" },
  ],
  "federated-evaluation": [
    { name: "加权准确率", baselineLabel: "上一版本模型", baseline: 0.81, output: 0.83, rule: "max-drop", tolerance: 0.01, format: "percent" },
    { name: "站点间差异", baselineLabel: "上一版本模型", baseline: 0.05, output: 0.03, rule: "lower", tolerance: 0.08, format: "percent" },
  ],
  "federated-analytics": [
    { name: "与明文基准的误差", baselineLabel: "允许上限", baseline: 0.01, output: 0.004, rule: "lower", tolerance: 0.01, format: "percent" },
    { name: "低于最小分组的单元格", baselineLabel: "允许上限", baseline: 0, output: 0, rule: "lower", tolerance: 0, format: "decimal" },
  ],
  fedrag: [
    { name: "Recall@8", baselineLabel: "单站检索", baseline: 0.58, output: 0.74, rule: "higher", format: "percent" },
    { name: "答案正确率", baselineLabel: "单站检索", baseline: 0.61, output: 0.72, rule: "higher", format: "percent" },
  ],
  "agent-skill": [
    { name: "沙箱回放成功率", baselineLabel: "各组原 Skill 包", baseline: 0.68, output: 0.77, rule: "higher", format: "percent" },
    { name: "有害条目", baselineLabel: "允许上限", baseline: 0, output: 0, rule: "lower", tolerance: 0, format: "decimal" },
  ],
};
