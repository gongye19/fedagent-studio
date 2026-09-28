import { useState } from "react";
import { SELF_ORG, deliveryRecipients, participantOrgs, type Project } from "../domain/project";
import { canPublish } from "../domain/run";
import type { Action } from "../state/store";
import { Facts, StageMessage } from "./common";

/** 交付：评测通过后由发起方确认；交付范围在配置时已选定，"指定参与方"时在这里勾选。 */
export default function DeliveryStep({ project, dispatch }: { project: Project; dispatch: (action: Action) => void }) {
  const { run, plan } = project;
  const names = run?.participants.map((participant) => participant.name) ?? [];
  const orgs = participantOrgs(project);
  const [selected, setSelected] = useState<string[]>(orgs);
  const initiator = project.role === "initiator";

  if (!run) return <div className="step-pad"><StageMessage text="评测通过后，在这里确认交付。" /></div>;
  if (run.error) return <div className="step-pad"><StageMessage text={`不能交付：${run.error}`} tone="failed" /></div>;

  if (run.artifact) {
    const received = run.artifact.recipients.includes(SELF_ORG);
    return (
      <div className="execution-workspace">
        <StageMessage
          text={initiator || received
            ? `已交付给 ${run.artifact.recipients.join("、")}（前端模拟，没有生成真实文件）`
            : `交付范围为${plan.deliveryScope.label}，本机构不会收到交付物。`}
        />
        <Facts
          items={[
            ["交付物", `${run.artifact.type}（${run.artifact.name}）`],
            ["交付对象", run.artifact.recipients.join("、")],
            ["谱系", run.artifact.lineage.join("、")],
          ]}
        />
        <details className="json-view">
          <summary>查看冻结的 FrontendRunPlan</summary>
          <pre>{JSON.stringify(plan, null, 2)}</pre>
        </details>
      </div>
    );
  }

  if (!canPublish(run)) {
    return <div className="step-pad"><StageMessage text="交付物会在评测通过交付闸门后开放交付。" running={!run.evaluation} /></div>;
  }

  if (!initiator) {
    return <div className="step-pad"><StageMessage text={`评测已通过，等待 ${project.initiatorOrg} 确认交付（交付范围：${plan.deliveryScope.label}）。`} running /></div>;
  }

  const recipients = deliveryRecipients(project, selected);
  return (
    <div className="execution-workspace">
      <StageMessage text="评测已通过交付闸门。确认后交付，这一步需要你手动确认。" />
      <Facts
        items={[
          ["交付物", plan.deliverable],
          ["交付范围", plan.deliveryScope.label],
          ["谱系", names.join("、")],
        ]}
      />
      {plan.deliveryScope.id === "selected" ? (
        <fieldset className="recipient-list">
          <legend>选择交付对象（发起方始终包含）</legend>
          {orgs.map((name) => (
            <label key={name} className={`choice-row${selected.includes(name) ? " choice-row--checked" : ""}`}>
              <input
                type="checkbox"
                checked={selected.includes(name) || name === project.initiatorOrg}
                disabled={name === project.initiatorOrg}
                onChange={() => setSelected((current) => (current.includes(name) ? current.filter((item) => item !== name) : [...current, name]))}
              />
              <span className="choice-copy"><strong>{name}</strong></span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <p className="section-note">将交付给：{recipients.join("、")}</p>
      <button type="button" className="button button--primary publish-button" onClick={() => dispatch({ type: "deliver", projectId: project.id, recipients })}>
        确认交付（模拟）
      </button>
    </div>
  );
}
