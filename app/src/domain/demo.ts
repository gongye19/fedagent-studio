/**
 * 前端演示数据：示例参与方和每类任务的评测指标。
 *
 * 这些都是虚构的样例，只为让组队和运行的每一步有可看的内容，界面上标为"示例"。
 * 接入后端后由真实的机构、节点上报和评测结果替代，不应被当作平台能力的证明。
 */
import type { DataTypeId, DeploymentId } from "./taxonomy";

/** 按数据类型准备的示例机构，以及它们节点上报的数据摘要。 */
export const EXAMPLE_PARTNERS: Record<DataTypeId, { orgs: readonly string[]; provides: string; details: readonly string[] }> = {
  image: {
    orgs: ["华东第一医院", "滨江人民医院", "南湖医学院附属医院", "西岭妇幼保健院", "江城肿瘤医院", "北山中心医院", "临海骨科医院", "东湖眼科医院", "青山康复医院"],
    provides: "影像分类数据",
    details: ["980 张 · 已标注", "1,560 张 · 已标注", "730 张 · 已标注", "1,120 张 · 已标注", "860 张 · 已标注", "1,340 张 · 已标注"],
  },
  table: {
    orgs: ["城南银行", "江北农商银行", "海岳保险", "恒信消费金融", "东港证券", "云岭信托", "南山财险", "北湖村镇银行", "西江信用社"],
    provides: "结构化表格",
    details: ["44,000 行 · 18 列", "39,000 行 · 18 列", "27,800 行 · 18 列", "51,200 行 · 18 列", "33,600 行 · 18 列", "46,900 行 · 18 列"],
  },
  instruction: {
    orgs: ["衡平律师事务所", "启明证券研究所", "远见财经传媒", "知行大学", "明德咨询", "远山法律服务中心", "博文出版社", "青蓝教育", "海川研究院"],
    provides: "指令数据 JSONL",
    details: ["2,450 条 · chat 模板", "4,100 条 · chat 模板", "1,800 条 · chat 模板", "3,600 条 · chat 模板", "2,900 条 · chat 模板", "3,300 条 · chat 模板"],
  },
  "vertical-table": {
    orgs: ["云贸电商", "联信通信", "速达物流", "安居地产", "畅行出行", "乐享视频", "惠民超市", "智联招聘平台", "悦动健身"],
    provides: "特征表 + 对齐主键",
    details: ["28 个特征 · 81,000 用户", "9 个特征 · 64,000 用户", "14 个特征 · 57,000 用户", "11 个特征 · 49,000 用户", "16 个特征 · 70,000 用户", "8 个特征 · 45,000 用户"],
  },
  "summary-table": {
    orgs: ["云南省统计局", "安徽省统计局", "浙江省统计局", "四川省统计局", "甘肃省统计局", "江西省统计局", "贵州省统计局", "福建省统计局", "湖南省统计局"],
    provides: "分组汇总表",
    details: ["地区 × 年龄段 · 126 组", "地区 × 年龄段 · 112 组", "地区 × 年龄段 · 98 组", "地区 × 年龄段 · 140 组", "地区 × 年龄段 · 86 组", "地区 × 年龄段 · 104 组"],
  },
  "memory-jsonl": {
    orgs: ["星图研究院", "北辰运维中心", "海螺客服中心", "青禾数据团队", "远帆产品部", "长河法务部", "云帆市场部", "晨光财务中心", "白鹭人事部"],
    provides: "Agent 记忆 JSONL",
    details: ["214 条 · 文献检索与总结", "167 条 · 故障排查", "305 条 · 工单分类与回复", "188 条 · 数据清洗", "142 条 · 需求整理", "96 条 · 合同审阅"],
  },
};

/** 示例参与方节点所在的环境，轮流取值。 */
export const EXAMPLE_LOCATIONS: readonly DeploymentId[] = ["aliyun", "on-prem", "tencent", "huawei", "aws", "on-prem"];

export type MetricRule = "higher" | "lower" | "max-drop";

export type DemoMetric = {
  name: string;
  baseline: number;
  output: number;
  rule: MetricRule;
  /** max-drop 允许的最大下降；lower 允许的上限。 */
  tolerance?: number;
  format: "percent" | "decimal";
};

/** 评测闸门的演示指标，键为 FrontendRunPlan.metricsKey。 */
export const DEMO_METRICS: Record<string, DemoMetric[]> = {
  "horizontal:image": [
    { name: "Accuracy", baseline: 0.81, output: 0.87, rule: "higher", format: "percent" },
    { name: "Macro-F1", baseline: 0.77, output: 0.84, rule: "higher", format: "percent" },
  ],
  "horizontal:table": [
    { name: "AUC", baseline: 0.78, output: 0.84, rule: "higher", format: "decimal" },
    { name: "Accuracy", baseline: 0.82, output: 0.86, rule: "higher", format: "percent" },
  ],
  "horizontal:llm": [
    { name: "领域任务得分", baseline: 0.62, output: 0.71, rule: "higher", format: "percent" },
    { name: "通用能力（回归检查）", baseline: 0.74, output: 0.73, rule: "max-drop", tolerance: 0.02, format: "percent" },
  ],
  "vertical-training": [
    { name: "AUC", baseline: 0.71, output: 0.79, rule: "higher", format: "decimal" },
    { name: "KS", baseline: 0.32, output: 0.41, rule: "higher", format: "decimal" },
  ],
  "federated-analytics": [
    { name: "汇总一致性误差", baseline: 0.01, output: 0.002, rule: "lower", tolerance: 0.01, format: "percent" },
    { name: "低于阈值仍公布的分组", baseline: 0, output: 0, rule: "lower", tolerance: 0, format: "decimal" },
  ],
  "agent-memory": [
    { name: "沙箱回放成功率", baseline: 0.68, output: 0.77, rule: "higher", format: "percent" },
    { name: "残留敏感信息", baseline: 0, output: 0, rule: "lower", tolerance: 0, format: "decimal" },
  ],
};
