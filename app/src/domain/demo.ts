/**
 * 前端演示数据：每个场景的示例参与方和评测指标。
 *
 * 这些都是虚构的样例，只为让时间轴每一步有可看的内容。接入后端后由真实的
 * 参与方接入记录、manifest 和评测结果替代，不应被当作平台能力的证明。
 */
import type { ScenarioId } from "./taxonomy";

export type Participant = {
  id: string;
  name: string;
  role: string;
  provides: string;
  detail: string;
  source: "demo" | "upload";
};

type ParticipantSeed = Omit<Participant, "id" | "source">;

const seeds = (scenario: string, list: ParticipantSeed[]): Participant[] => list.map((item, index) => ({
  ...item,
  id: `${scenario}-p${index + 1}`,
  source: "demo",
}));

/**
 * 每个场景的候选参与方。前 DEFAULT_PARTICIPANTS 个默认接入，其余可以手动添加。
 * 同一场景下各方投入不同时（如评估用本地测试集还是 Endpoint），用 "场景:投入" 区分。
 */
export const PARTICIPANT_POOL: Record<string, Participant[]> = {
  "model-training": seeds("model-training", [
    { name: "医院 A", role: "参与方", provides: "影像分类数据契约", detail: "1,240 样本 · schema 已声明" },
    { name: "医院 B", role: "参与方", provides: "影像分类数据契约", detail: "980 样本 · schema 已声明" },
    { name: "医院 C", role: "参与方", provides: "影像分类数据契约", detail: "1,560 样本 · schema 已声明" },
    { name: "医院 D", role: "参与方", provides: "影像分类数据契约", detail: "730 样本 · schema 已声明" },
  ]),
  "peft-finetune": seeds("peft-finetune", [
    { name: "律所 A", role: "参与方", provides: "指令数据 JSONL 契约", detail: "3,200 条 · chat 模板" },
    { name: "券商 B", role: "参与方", provides: "指令数据 JSONL 契约", detail: "2,450 条 · chat 模板" },
    { name: "媒体 C", role: "参与方", provides: "指令数据 JSONL 契约", detail: "4,100 条 · chat 模板" },
    { name: "高校 D", role: "参与方", provides: "指令数据 JSONL 契约", detail: "1,800 条 · chat 模板" },
  ]),
  "model-merge": seeds("model-merge", [
    { name: "news-summary-lora", role: "产物", provides: "LoRA Adapter", detail: "rank 16 · 新闻摘要 · 1,200 样本训练" },
    { name: "legal-qa-lora", role: "产物", provides: "LoRA Adapter", detail: "rank 16 · 法律问答 · 900 样本训练" },
    { name: "finance-report-lora", role: "产物", provides: "LoRA Adapter", detail: "rank 16 · 财报分析 · 1,500 样本训练" },
  ]),
  "vertical-modeling": seeds("vertical-modeling", [
    { name: "银行 A", role: "Guest · 持有标签", provides: "交易特征数据契约 + PSI key manifest", detail: "12 个特征 · 52,000 用户" },
    { name: "电商 B", role: "Host", provides: "消费特征数据契约 + PSI key manifest", detail: "28 个特征 · 81,000 用户" },
    { name: "运营商 C", role: "Host", provides: "通信特征数据契约 + PSI key manifest", detail: "9 个特征 · 64,000 用户" },
  ]),
  personalized: seeds("personalized", [
    { name: "门店 A", role: "参与方", provides: "本地模型包 + 数据契约", detail: "销量预测 · 18 个月数据" },
    { name: "门店 B", role: "参与方", provides: "本地模型包 + 数据契约", detail: "销量预测 · 24 个月数据" },
    { name: "门店 C", role: "参与方", provides: "本地模型包 + 数据契约", detail: "销量预测 · 12 个月数据" },
  ]),
  heterogeneous: seeds("heterogeneous", [
    { name: "机构 A", role: "参与方", provides: "模型契约 · ResNet-50", detail: "10 类输出 · 本地 8,000 样本" },
    { name: "机构 B", role: "参与方", provides: "模型契约 · ViT-S", detail: "10 类输出 · 本地 5,500 样本" },
    { name: "机构 C", role: "参与方", provides: "模型契约 · MobileNetV3", detail: "10 类输出 · 本地 3,200 样本" },
  ]),
  "federated-evaluation": seeds("federated-evaluation", [
    { name: "站点 A", role: "评测节点", provides: "本地测试集契约", detail: "2,000 条 · 已脱敏" },
    { name: "站点 B", role: "评测节点", provides: "本地测试集契约", detail: "1,600 条 · 已脱敏" },
    { name: "站点 C", role: "评测节点", provides: "本地测试集契约", detail: "2,400 条 · 已脱敏" },
  ]),
  "federated-evaluation:model-endpoint": seeds("federated-evaluation-endpoint", [
    { name: "机构 A 模型服务", role: "模型 Endpoint", provides: "OpenAI 兼容接口", detail: "限流 20 QPS · 已登记模型卡" },
    { name: "机构 B 模型服务", role: "模型 Endpoint", provides: "OpenAI 兼容接口", detail: "限流 10 QPS · 已登记模型卡" },
    { name: "机构 C 模型服务", role: "模型 Endpoint", provides: "OpenAI 兼容接口", detail: "限流 15 QPS · 已登记模型卡" },
  ]),
  "federated-analytics": seeds("federated-analytics", [
    { name: "医院 A", role: "参与方", provides: "分析 schema", detail: "年龄、住院天数、费用" },
    { name: "医院 B", role: "参与方", provides: "分析 schema", detail: "年龄、住院天数、费用" },
    { name: "医院 C", role: "参与方", provides: "分析 schema", detail: "年龄、住院天数、费用" },
  ]),
  fedrag: seeds("fedrag", [
    { name: "医院知识库", role: "检索节点", provides: "检索 Endpoint + 索引声明", detail: "FAISS · 42,000 片段" },
    { name: "药企文献库", role: "检索节点", provides: "检索 Endpoint + 索引声明", detail: "Qdrant · 18,000 片段" },
    { name: "高校论文库", role: "检索节点", provides: "检索 Endpoint + 索引声明", detail: "FAISS · 65,000 片段" },
  ]),
  "agent-skill": seeds("agent-skill", [
    { name: "研究组 Skill 包", role: "产物", provides: "经验卡 · 214 条", detail: "文献检索与总结" },
    { name: "运维组 Skill 包", role: "产物", provides: "经验卡 · 167 条", detail: "故障排查" },
    { name: "客服组 Skill 包", role: "产物", provides: "经验卡 · 305 条", detail: "工单分类与回复" },
  ]),
  "agent-skill:trained-artifact": seeds("agent-skill-adapter", [
    { name: "research-agent-lora", role: "产物", provides: "Agent Adapter", detail: "rank 16 · 文献检索任务" },
    { name: "ops-agent-lora", role: "产物", provides: "Agent Adapter", detail: "rank 16 · 运维任务" },
    { name: "support-agent-lora", role: "产物", provides: "Agent Adapter", detail: "rank 16 · 客服任务" },
  ]),
};

export function participantPool(scenario: ScenarioId | undefined, contribution: string | null): Participant[] {
  if (!scenario) return [];
  return PARTICIPANT_POOL[`${scenario}:${contribution}`] ?? PARTICIPANT_POOL[scenario];
}

export const DEFAULT_PARTICIPANTS = 3;

export function defaultParticipants(scenario: ScenarioId | undefined, contribution: string | null): Participant[] {
  // 纵向默认一个 Guest + 一个 Host，最贴近常见的两方建模。
  return participantPool(scenario, contribution).slice(0, scenario === "vertical-modeling" ? 2 : DEFAULT_PARTICIPANTS);
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
  "model-merge": [
    { name: "各领域平均得分", baselineLabel: "单个 Adapter 平均", baseline: 0.66, output: 0.7, rule: "higher", format: "percent" },
    { name: "最差领域得分", baselineLabel: "该领域原 Adapter", baseline: 0.64, output: 0.63, rule: "max-drop", tolerance: 0.03, format: "percent" },
  ],
  "vertical-modeling": [
    { name: "AUC", baselineLabel: "Guest 单方模型", baseline: 0.71, output: 0.79, rule: "higher", format: "decimal" },
    { name: "KS", baselineLabel: "Guest 单方模型", baseline: 0.32, output: 0.41, rule: "higher", format: "decimal" },
  ],
  personalized: [
    { name: "本地个性化准确率", baselineLabel: "全局 FedAvg 模型", baseline: 0.8, output: 0.88, rule: "higher", format: "percent" },
    { name: "全局泛化准确率", baselineLabel: "全局 FedAvg 模型", baseline: 0.8, output: 0.79, rule: "max-drop", tolerance: 0.02, format: "percent" },
  ],
  heterogeneous: [
    { name: "各站平均准确率", baselineLabel: "各站独立训练", baseline: 0.74, output: 0.79, rule: "higher", format: "percent" },
    { name: "最差站点准确率", baselineLabel: "各站独立训练", baseline: 0.66, output: 0.71, rule: "higher", format: "percent" },
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
