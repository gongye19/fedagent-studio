import { useLayoutEffect, useRef } from "react";
import type { ConsultationComparisonArm } from "../../api/consultationComparison";
import { Tag } from "../common";
import { ConsultationMessage } from "./ConsultationMessage";

const requestedAction = { exam: "查体", test: "申请检验" };

function EvaluationSummary({ arm, reference }: { arm: ConsultationComparisonArm; reference: string }) {
  const questions = arm.steps.filter((step) => step.action === "ask").length;
  const checks = arm.steps.filter((step) => step.action === "exam" || step.action === "test").length;
  const [label, tone] = arm.matched === true ? ["答对", "success"] as const
    : arm.matched === false ? ["答错", "danger"] as const
      : [arm.diagnosis ? "暂未判定" : "未提交诊断", "warning"] as const;
  return <section className="comparison-verdict" aria-label="评测结果">
    <div className="comparison-verdict-head"><strong>评测结果</strong><Tag tone={tone}>{label}</Tag></div>
    <p className="comparison-reference">参考诊断 <strong>{reference}</strong></p>
    <dl className="comparison-metrics" aria-label="问诊统计">
      <div><dt>追问轮数</dt><dd>{questions}</dd></div>
      <div><dt>查体及检验</dt><dd>{checks} 项</dd></div>
      <div><dt>问诊步骤</dt><dd>{arm.steps.length}</dd></div>
    </dl>
  </section>;
}

export function ComparisonConversation({ arm, opening, reference }: {
  arm: ConsultationComparisonArm; opening: string; reference?: string | null;
}) {
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(arm.status === "running" || arm.status === "waiting");

  useLayoutEffect(() => {
    const history = log.current;
    if (history && follow.current) history.scrollTop = history.scrollHeight;
  }, [arm.steps.length, arm.diagnosis, reference]);

  return <div ref={log} className="consultation-history comparison-history" role="log" aria-label="问诊对话"
    tabIndex={0} onScroll={({ currentTarget: view }) => {
      follow.current = view.scrollHeight - view.scrollTop - view.clientHeight < 64;
    }}>
    <div className="consultation-thread comparison-thread">
      <ConsultationMessage role="user" speaker="患者 · 主诉" content={opening} />
      {arm.steps.map((step, index) => <div className="comparison-exchange" key={index}>
        <ConsultationMessage role="assistant" speaker="问诊医生"
          content={step.action === "exam" || step.action === "test" ? `${requestedAction[step.action]} · ${step.text}` : step.text} />
        {step.result && <ConsultationMessage role="user" content={step.result}
          speaker={step.action === "ask" ? "患者" : step.action === "exam" ? "查体结果" : "检验结果"} />}
      </div>)}
      {arm.diagnosis && <ConsultationMessage role="assistant" speaker="问诊医生 · 最终诊断" content={arm.diagnosis} />}
      {reference && <EvaluationSummary arm={arm} reference={reference} />}
      {arm.status === "running" && <div className="consultation-waiting">
        <span className="consultation-dots" aria-hidden="true"><i /><i /><i /></span>医生正在判断下一步…
      </div>}
      {arm.steps.length === 0 && arm.status === "waiting" && <p className="muted comparison-model">等待医生接诊</p>}
    </div>
  </div>;
}
