import type { ReactNode } from "react";
import { stageOf, type Run, type StageId } from "../domain/run";
import { Facts, LogList, StageMessage } from "./common";
import { Icon, type IconName } from "./icons";

type RunStage = Exclude<StageId, "publish">;

const IDLE_TEXT: Record<RunStage, string> = {
  preflight: "参与方确认后由发起方开始运行。规则引擎先检查硬规则，Agent 只负责解释结果和给出修复建议，不能覆盖拒绝。",
  provision: "准入通过后，平台冻结运行计划，按执行模式创建协调方和各参与方的运行环境。",
  execute: "运行环境就绪后，按所选算法和执行模式运行。",
  evaluate: "执行完成后，在独立评测环境中对比基线，未通过闸门的结果不能交付。",
};

const CHECK_ICON: Record<"pass" | "warn" | "fail", IconName> = { pass: "check", warn: "alert", fail: "x" };

export default function StageStep({ stageId, run }: { stageId: RunStage; run: Run | null }) {
  if (!run) return <div className="step-pad"><StageMessage text={IDLE_TEXT[stageId]} /></div>;

  const stage = stageOf(run, stageId);
  if (stage.status === "pending") {
    return <div className="step-pad"><StageMessage text={run.error ? `前序阶段失败：${run.error}` : IDLE_TEXT[stageId]} tone={run.error ? "failed" : undefined} /></div>;
  }
  if (stage.status === "running") {
    return <div className="step-pad"><StageMessage text={`${runningText(stageId, run)}（前端模拟，演示时长已压缩）`} running /></div>;
  }

  return (
    <div className="execution-workspace">
      <StageMessage text={stage.status === "failed" ? run.error ?? "阶段失败" : stage.detail} tone={stage.status === "failed" ? "failed" : undefined} />
      {body(stageId, run)}
      <Facts items={[["真实耗时预估", stage.realCost]]} />
      {stageId !== "preflight" && stageId !== "evaluate" ? <LogList logs={stage.logs} label="阶段日志" /> : null}
    </div>
  );
}

function runningText(stageId: RunStage, run: Run): string {
  switch (stageId) {
    case "preflight":
      return `正在检查 ${run.participants.length} 个参与方的输入契约`;
    case "provision":
      return `正在创建 ${run.plan.runner} 运行环境`;
    case "execute":
      return `正在执行 ${run.plan.model.label} · ${run.plan.aggregation}（${run.plan.patternLabel}）`;
    case "evaluate":
      return `正在评测：${run.plan.evaluation.label}`;
  }
}

function body(stageId: RunStage, run: Run): ReactNode {
  const { plan } = run;
  switch (stageId) {
    case "preflight":
      return run.preflight ? (
        <>
          <ul className="check-list" aria-label="准入检查结果">
            {run.preflight.checks.map((check, index) => (
              <li className={`check--${check.status}`} key={`${check.label}-${index}`}>
                <span><Icon name={CHECK_ICON[check.status]} label={check.status === "pass" ? "通过" : check.status === "warn" ? "提示" : "未通过"} /></span>
                <strong>{check.label}</strong>
                <b>{check.detail}</b>
              </li>
            ))}
          </ul>
          <div className="agent-note">
            <span>Agent</span>
            <p>{run.preflight.agentNote}</p>
          </div>
        </>
      ) : null;
    case "provision":
      return (
        <Facts
          items={[
            ["执行框架", plan.runner],
            ["协调方", plan.locations.coordinator],
            ["参与方侧", plan.locations.participantWorker],
            ["网络", `${plan.requirements.network ?? "平台内部"} · 默认拒绝，只放行项目通道`],
          ]}
        />
      );
    case "execute":
      return (
        <Facts
          items={[
            ["模型", plan.sharing ? `${plan.model.label} · ${plan.sharing}` : plan.model.label],
            ["聚合", plan.aggregation],
            [plan.rounds.title, plan.rounds.label],
            ["交换对象", plan.exchanged],
            ["安全机制", plan.security.mechanisms.join(" · ")],
            ["参与方", run.participants.map((participant) => participant.name).join("、")],
          ]}
        />
      );
    case "evaluate":
      return run.evaluation ? (
        <div className="table-wrap">
          <table className="metrics-table">
            <thead>
              <tr><th>指标</th><th>基线</th><th>结果</th><th>交付闸门</th><th>状态</th></tr>
            </thead>
            <tbody>
              {run.evaluation.metrics.map((metric) => (
                <tr key={metric.name} className={metric.passed ? "" : "metric-down"}>
                  <td><strong>{metric.name}</strong><small>基线：{metric.baselineLabel}</small></td>
                  <td>{metric.baseline}</td>
                  <td>{metric.output}</td>
                  <td>{metric.gate}</td>
                  <td>{metric.passed ? "通过" : "未通过"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null;
  }
}
