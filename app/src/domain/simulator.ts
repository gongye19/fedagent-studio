/**
 * 前端模拟器：按执行模式生成每个阶段的内容。
 *
 * 每个场景走自己的执行模式，不借用其他场景的执行器。所有输出都是确定性的演示数据，
 * 并同时给出"真实大概要多久"，界面必须把它显示出来，避免把几秒的演示误认为真实耗时。
 */
import { DEMO_METRICS, type DemoMetric } from "./demo";
import type { FrontendRunPlan } from "./plan";
import type {
  CheckStatus,
  EvaluationReport,
  MetricResult,
  Participant,
  PreflightReport,
  PublishedArtifact,
  StageId,
  StageResult,
} from "./run";
import { meetsSpec } from "./taxonomy";

export type StageWork = StageResult & { demoMs: number };

const DEMO_MS: Record<Exclude<StageId, "publish">, number> = {
  preflight: 1400,
  provision: 1200,
  execute: 2600,
  evaluate: 1600,
};

function executeWork(plan: FrontendRunPlan, participants: Participant[]): StageResult {
  const count = participants.length;
  const protection = plan.security.mechanisms.join(" + ");
  switch (plan.pattern) {
    case "iterative": {
      const total = plan.rounds.value;
      const shown = Math.min(total, 3);
      const logs = Array.from({ length: shown }, (_, index) => (
        `第 ${index + 1}/${total} 轮：下发全局模型 → ${count} 个节点本地训练 → 回传${plan.exchanged} → 按 ${plan.aggregation} 聚合`
      ));
      if (total > shown) logs.push(`…… 第 ${total}/${total} 轮完成，全局模型收敛`);
      return {
        detail: `${total} 轮 ${plan.aggregation} 完成，${count} 个节点全部在线`,
        realCost: plan.estimate.duration,
        logs: [`SuperLink 启动 ServerApp，${count} 个 SuperNode 已连接；模型：${plan.model.label}${plan.sharing ? ` · ${plan.sharing}` : ""}`, `保护机制：${protection}`, ...logs],
      };
    }
    case "vertical-protocol": {
      const label = participants.find((participant) => participant.role === "标签方") ?? participants[0];
      return {
        detail: `${plan.requirements.alignment} 对齐样本后完成 ${plan.model.label}`,
        realCost: plan.estimate.duration,
        logs: [
          `${plan.requirements.alignment}：${count} 方求交，共同样本 18,420 个（名单不以明文交换）`,
          `${label.name} 作为标签方，按 ${plan.aggregation} 推进`,
          `${plan.rounds.title} ${plan.rounds.label}，交换${plan.exchanged}`,
          "模型按参与方分片保存，任何一方都拿不到完整模型；预测时也需要各方共同计算",
        ],
      };
    }
    case "aggregate-once":
      return {
        detail: `${count} 份汇总表已按 ${plan.model.label} 合并`,
        realCost: plan.estimate.duration,
        logs: [
          `校验 ${count} 份汇总表的表头和分组是否一致`,
          ...participants.map((participant) => `${participant.name}：读取${plan.exchanged}`),
          "由计数和求和重新计算整体比例、均值和方差（不直接平均各方的比例）",
          `按 ${protection} 处理：样本数低于阈值的分组不公布`,
        ],
      };
    case "merge-once":
      return {
        detail: `${count} 份记忆已按 ${plan.aggregation} 合并`,
        realCost: plan.estimate.duration,
        logs: [
          `扫描 ${count} 份记忆文件中的敏感信息并脱敏`,
          "按内容相似度去重，保留来源和时间",
          "Agent 审阅互相矛盾的记忆，只保留一致的条目",
          `写出候选交付物：${plan.deliverable}`,
        ],
      };
  }
}

export function preflightReport(plan: FrontendRunPlan, participants: Participant[]): PreflightReport {
  const checks: PreflightReport["checks"] = [];
  const add = (label: string, detail: string, status: CheckStatus = "pass") => checks.push({ label, detail, status });
  const nodes = plan.scenario.inputKind === "nodes";

  add("场景与框架", `${plan.scenario.label} · ${plan.runner}`);
  add(
    "参与方数量",
    `${participants.length} 方已确认，最少需要 ${plan.requirements.minParties} 方`,
    participants.length >= plan.requirements.minParties ? "pass" : "fail",
  );
  if (nodes && plan.requirements.compute) {
    const below = participants.filter((participant) => !meetsSpec(participant.spec, plan.requirements.compute?.id));
    add(
      "节点算力",
      below.length
        ? `${below.map((participant) => participant.name).join("、")} 的节点低于 ${plan.requirements.compute.label}`
        : `${participants.length} 个节点均满足 ${plan.requirements.compute.label}`,
      below.length ? "fail" : "pass",
    );
  }
  add("数据要求", `各方数据类型均为${plan.requirements.dataType.label}`);
  add("样本对齐", plan.requirements.alignment);
  if (plan.pattern === "vertical-protocol") {
    const labels = participants.filter((participant) => participant.role === "标签方").length;
    add("标签方", labels === 1 ? "1 个标签方，其余为特征方" : `需要恰好 1 个标签方，当前 ${labels} 个`, labels === 1 ? "pass" : "fail");
  }
  if (plan.model.family === "llm") add("基座一致性", `各方使用同一基座 ${plan.model.label}（由平台分发）`);
  add("安全机制", plan.security.mechanisms.join("、"));
  if (plan.security.secagg && participants.length < 3) {
    add("安全聚合", `SecAgg+ 需要至少 3 方，当前 ${participants.length} 方`, "fail");
  }
  for (const warning of plan.warnings) add("提示", warning, "warn");

  const passed = checks.every((check) => check.status !== "fail");
  const warnings = checks.filter((check) => check.status === "warn").length;
  return {
    checks,
    passed,
    agentNote: passed
      ? warnings
        ? `硬规则全部通过。有 ${warnings} 条提示不阻断运行，建议在正式运行前确认。`
        : "硬规则全部通过，可以创建运行环境。"
      : "存在不满足的硬规则，Agent 不能覆盖拒绝结果。请按提示调整参与方或配置后重新发起。",
  };
}

const formatValue = (value: number, format: DemoMetric["format"]) => (
  format === "percent" ? `${(value * 100).toFixed(value < 0.1 && value > 0 ? 1 : 0)}%` : value.toFixed(2)
);

function gateOf(metric: DemoMetric): { gate: string; passed: boolean } {
  switch (metric.rule) {
    case "higher":
      return { gate: "不低于基线", passed: metric.output >= metric.baseline };
    case "lower":
      return { gate: `不高于 ${formatValue(metric.tolerance ?? 0, metric.format)}`, passed: metric.output <= (metric.tolerance ?? 0) };
    case "max-drop":
      return {
        gate: `下降不超过 ${formatValue(metric.tolerance ?? 0, metric.format)}`,
        passed: metric.baseline - metric.output <= (metric.tolerance ?? 0) + 1e-9,
      };
  }
}

/** 基线的含义随评测方式变化。 */
function baselineLabel(plan: FrontendRunPlan, metric: DemoMetric): string {
  if (metric.rule === "lower") return "允许上限";
  switch (plan.evaluation.id) {
    case "local":
      return "单方模型（各方本地验证集）";
    case "holdout":
      return "单方模型（平台测试集）";
    case "baseline":
      return "最好的单方模型";
    case "label-party":
    case "single-party":
      return "标签方单方模型";
    case "replay":
      return "各方原有记忆";
    default:
      return plan.model.family === "llm" ? "基座模型" : "基线";
  }
}

export function evaluationReport(plan: FrontendRunPlan): EvaluationReport {
  const metrics: MetricResult[] = (DEMO_METRICS[plan.metricsKey] ?? []).map((metric) => ({
    name: metric.name,
    baselineLabel: plan.model.family === "llm" && metric.rule !== "lower" ? "基座模型" : baselineLabel(plan, metric),
    baseline: formatValue(metric.baseline, metric.format),
    output: formatValue(metric.output, metric.format),
    ...gateOf(metric),
  }));
  return { metrics, passed: metrics.every((metric) => metric.passed) };
}

export function stageWork(stage: Exclude<StageId, "publish">, plan: FrontendRunPlan, participants: Participant[]): StageWork {
  const demoMs = DEMO_MS[stage];
  switch (stage) {
    case "preflight": {
      const report = preflightReport(plan, participants);
      return {
        demoMs,
        detail: report.passed ? "硬规则通过，Agent 已生成说明" : "硬规则未通过",
        realCost: "约 1–3 分钟（配置与节点清单解析 + 规则检查 + Agent 说明）",
        logs: report.checks.map((check) => `${check.label}：${check.detail}`),
        preflight: report,
      };
    }
    case "provision":
      return {
        demoMs,
        detail: `${plan.runner} 运行环境已就绪`,
        realCost: plan.scenario.inputKind === "nodes" ? "约 1–5 分钟（下发镜像、挂载只读数据、建立节点通道）" : "约 30 秒–2 分钟（创建隔离沙箱、挂载上传文件）",
        logs: [
          `冻结 FrontendRunPlan（${plan.schemaVersion}）`,
          `接入方式：${plan.scenario.inputKindLabel}`,
          `协调方：${plan.locations.coordinator}`,
          `参与方侧：${plan.locations.participantWorker}`,
          "网络策略：默认拒绝，只放行参与方与协调方之间的通道",
          "数据只读挂载，输出只写到本次运行的目录",
        ],
      };
    case "execute":
      return { demoMs, ...executeWork(plan, participants) };
    case "evaluate": {
      const report = evaluationReport(plan);
      return {
        demoMs,
        detail: report.passed ? "全部指标通过交付闸门" : "存在未通过闸门的指标",
        realCost: "约 5–20 分钟（独立评测环境）",
        logs: [`评测方式：${plan.evaluation.label}`, ...report.metrics.map((metric) => `${metric.name}：${metric.baseline} → ${metric.output}`)],
        evaluation: report,
      };
    }
  }
}

export function artifactFor(plan: FrontendRunPlan, participants: Participant[], runId: string, recipients: string[]): PublishedArtifact {
  return {
    name: `${plan.scenario.id}-${runId.replace(/\D/g, "").slice(-6)}`,
    type: plan.deliverable,
    lineage: participants.map((participant) => participant.name),
    recipients,
  };
}
