/**
 * 前端模拟器：按执行模式生成每个阶段的内容。
 *
 * 每个场景走自己的执行模式，不再借用其他场景的执行器。所有输出都是确定性的演示数据，
 * 并同时给出"真实大概要多久"，界面必须把它显示出来，避免把几秒的演示误认为真实耗时。
 */
import { DEMO_METRICS, type DemoMetric, type Participant } from "./demo";
import type { FrontendRunPlan } from "./plan";
import type {
  CheckStatus,
  EvaluationReport,
  ExecutionPreset,
  MetricResult,
  PreflightReport,
  PublishedArtifact,
  StageId,
  StageResult,
  Visibility,
} from "./run";

export type StageWork = StageResult & { demoMs: number };

const DEMO_MS: Record<Exclude<StageId, "publish">, number> = {
  preflight: 1400,
  provision: 1200,
  execute: 2600,
  evaluate: 1600,
};

function paramValue(plan: FrontendRunPlan, id: string): string | undefined {
  return plan.params.find((param) => param.id === id)?.valueLabel;
}

function rounds(plan: FrontendRunPlan, preset: ExecutionPreset): number {
  const configured = Number(plan.params.find((param) => param.id === "rounds")?.value ?? 10);
  return preset === "quick" ? Math.min(3, configured) : configured;
}

function executeWork(plan: FrontendRunPlan, participants: Participant[], preset: ExecutionPreset): StageResult {
  const count = participants.length;
  const strategy = plan.strategy.label;
  const protection = plan.protection.mechanisms.join(" + ");
  switch (plan.pattern) {
    case "iterative": {
      const total = rounds(plan, preset);
      const shown = Math.min(total, 3);
      const logs = Array.from({ length: shown }, (_, index) => (
        `第 ${index + 1}/${total} 轮：${count}/${count} 方上报${plan.exchanged}，按 ${strategy} 聚合`
      ));
      if (total > shown) logs.push(`…… 第 ${total}/${total} 轮完成，全局结果收敛`);
      if (plan.robust) logs.push("鲁棒聚合：本次运行未发现异常更新");
      return {
        detail: `${total} 轮 ${strategy} 完成，${count} 个参与方全部在线`,
        realCost: `约 ${Math.round(total * 1.5)}–${total * 4} 分钟，取决于本地训练量`,
        logs: [`协调方在沙箱内启动，保护机制：${protection}`, ...logs],
      };
    }
    case "single-round":
      return {
        detail: `${count} 方本地计算完成，已聚合 ${strategy}`,
        realCost: "约 1–5 分钟",
        logs: [
          `下发分析任务到 ${count} 个节点`,
          ...participants.map((participant) => `${participant.name}：本地计算完成，上报${plan.exchanged}`),
          `聚合服务按 ${protection} 汇总结果`,
        ],
      };
    case "vertical-protocol": {
      const guest = participants.find((participant) => participant.role.startsWith("Guest")) ?? participants[0];
      return {
        detail: `PSI 对齐后完成 ${strategy}`,
        realCost: "约 20–90 分钟，其中同态加密计算占大头",
        logs: [
          `${paramValue(plan, "psi") ?? "PSI"}：${count} 方求交，共同样本 18,420 个`,
          `${guest.name} 作为标签方生成加密梯度`,
          `迭代 ${paramValue(plan, "iterations") ?? "若干"} 次：交换${plan.exchanged}`,
          "模型按参与方分片保存，任何一方都拿不到完整模型",
        ],
      };
    }
    case "artifact-processing":
      return {
        detail: `${count} 个产物按 ${strategy} 合并完成`,
        realCost: plan.protection.id === "encrypted" ? "约 5–15 分钟，含密钥预处理" : "约 1–3 分钟",
        logs: [
          `校验 ${count} 个产物的摘要与 manifest`,
          `在隔离沙箱内按 ${strategy} 合并`,
          `写出候选产物：${plan.output}`,
        ],
      };
    case "query-time":
      return {
        detail: `评测查询已通过 ${count} 个检索节点完成融合`,
        realCost: "单次查询约 1–3 秒；200 条评测查询约 5 分钟",
        logs: [
          "下发 200 条评测查询",
          `各站本地检索 ${paramValue(plan, "top-k") ?? "Top-k"}，返回${plan.exchanged}`,
          `平台按 ${strategy} 融合并生成回答`,
        ],
      };
    case "evaluation-only":
      return {
        detail: `${count} 个评测节点完成 ${strategy}`,
        realCost: "约 5–30 分钟",
        logs: [
          `下发评测任务到 ${count} 个节点`,
          ...participants.map((participant) => `${participant.name}：评测完成，上报${plan.exchanged}`),
          "汇总指标并生成报告草稿",
        ],
      };
  }
}

export function preflightReport(plan: FrontendRunPlan, participants: Participant[]): PreflightReport {
  const checks: PreflightReport["checks"] = [];
  const add = (label: string, detail: string, status: CheckStatus = "pass") => checks.push({ label, detail, status });

  add("场景路径", `${plan.scenario.label} · ${plan.patternLabel}`);
  add(
    "参与方数量",
    `${participants.length} 个，最少需要 ${plan.minParticipants} 个`,
    participants.length >= plan.minParticipants ? "pass" : "fail",
  );
  add("输入契约", `${participants[0]?.provides ?? "—"} 等 ${participants.length} 项声明一致`);
  add("保护与计算类型", `${plan.protection.label} 可用于"${plan.computeKindLabel}"`);
  add("Runner 能力", `${plan.runner} 支持 ${plan.strategy.label}`);

  if (plan.protection.id === "hide-updates" && participants.length < 3) {
    add("SecAgg 参与方", `只有 ${participants.length} 方时，协调方可由聚合结果反推另一方更新`, "warn");
  }
  if (plan.pattern === "vertical-protocol" && !participants.some((participant) => participant.role.startsWith("Guest"))) {
    add("标签持有方", "纵向协议需要一个持有标签的 Guest", "fail");
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
        : "硬规则全部通过，可以创建沙箱。"
      : "存在不满足的硬规则，Agent 不能覆盖拒绝结果。请按提示修改参与方或配置后重新发起。",
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

export function evaluationReport(plan: FrontendRunPlan): EvaluationReport {
  const metrics: MetricResult[] = DEMO_METRICS[plan.scenario.id].map((metric) => ({
    name: metric.name,
    baselineLabel: metric.baselineLabel,
    baseline: formatValue(metric.baseline, metric.format),
    output: formatValue(metric.output, metric.format),
    ...gateOf(metric),
  }));
  return { metrics, passed: metrics.every((metric) => metric.passed) };
}

export function stageWork(
  stage: Exclude<StageId, "publish">,
  plan: FrontendRunPlan,
  participants: Participant[],
  preset: ExecutionPreset,
): StageWork {
  const demoMs = DEMO_MS[stage];
  switch (stage) {
    case "preflight": {
      const report = preflightReport(plan, participants);
      return {
        demoMs,
        detail: report.passed ? "硬规则通过，Agent 已生成说明" : "硬规则未通过",
        realCost: "约 1–3 分钟（manifest 解析 + 规则检查 + Agent 说明）",
        logs: report.checks.map((check) => `${check.label}：${check.detail}`),
        preflight: report,
      };
    }
    case "provision":
      return {
        demoMs,
        detail: `${plan.runner} 沙箱已就绪`,
        realCost: "约 30 秒–3 分钟（拉取镜像、挂载只读输入）",
        logs: [
          `冻结 FrontendRunPlan（${plan.schemaVersion}）`,
          `协调方：${plan.locations.coordinator}`,
          `参与方侧：${plan.locations.participantWorker}`,
          "网络策略：默认拒绝，只放行参与方与协调方之间的通道",
          "输入只读挂载，输出只写到本次 Run 的目录",
        ],
      };
    case "execute":
      return { demoMs, ...executeWork(plan, participants, preset) };
    case "evaluate": {
      const report = evaluationReport(plan);
      return {
        demoMs,
        detail: report.passed ? "全部指标通过发布闸门" : "存在未通过闸门的指标",
        realCost: "约 5–20 分钟（独立评测沙箱）",
        logs: [`评测方案：${plan.evaluation}`, ...report.metrics.map((metric) => `${metric.name}：${metric.baseline} → ${metric.output}`)],
        evaluation: report,
      };
    }
  }
}

export function artifactFor(plan: FrontendRunPlan, participants: Participant[], runId: string, visibility: Visibility): PublishedArtifact {
  return {
    name: `${plan.scenario.id}-${runId.replace(/^run-/, "").slice(-6)}`,
    type: plan.output,
    lineage: participants.map((participant) => participant.name),
    visibility,
  };
}
