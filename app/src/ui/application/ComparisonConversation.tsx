import { useLayoutEffect, useRef } from "react";
import type { ConsultationComparisonArm } from "../../api/consultationComparison";
import { ConsultationMessage } from "./ConsultationMessage";

const requestedAction = { exam: "查体", test: "申请检验" };

export function ComparisonConversation({ arm, opening }: { arm: ConsultationComparisonArm; opening: string }) {
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(arm.status === "running" || arm.status === "waiting");

  useLayoutEffect(() => {
    const history = log.current;
    if (history && follow.current) history.scrollTop = history.scrollHeight;
  }, [arm.steps.length, arm.diagnosis]);

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
      {arm.status === "running" && <div className="consultation-waiting">
        <span className="consultation-dots" aria-hidden="true"><i /><i /><i /></span>医生正在判断下一步…
      </div>}
      {arm.steps.length === 0 && arm.status === "waiting" && <p className="muted comparison-model">等待医生接诊</p>}
    </div>
  </div>;
}
