import { useState } from "react";
import { canPublish, VISIBILITY_LABEL, type Run, type Visibility } from "../domain/run";
import type { Action } from "../state/store";
import { Facts, StageMessage } from "./common";

export default function PublishStep({ run, dispatch }: { run: Run | null; dispatch: (action: Action) => void }) {
  const [visibility, setVisibility] = useState<Visibility>("participants");

  if (!run) return <div className="step-pad"><StageMessage text="评测通过后，在这里选择发布范围并确认发布。" /></div>;
  if (run.error) return <div className="step-pad"><StageMessage text={`不能发布：${run.error}`} tone="failed" /></div>;

  if (run.artifact) {
    return (
      <div className="execution-workspace">
        <StageMessage text={`已发布给${VISIBILITY_LABEL[run.artifact.visibility]}（前端模拟，没有生成真实文件）`} />
        <Facts
          items={[
            ["产物", run.artifact.name],
            ["类型", run.artifact.type],
            ["谱系", run.artifact.lineage.join("、")],
            ["访问范围", VISIBILITY_LABEL[run.artifact.visibility]],
          ]}
        />
        <details className="json-view">
          <summary>查看冻结的 FrontendRunPlan</summary>
          <pre>{JSON.stringify(run.plan, null, 2)}</pre>
        </details>
      </div>
    );
  }

  if (!canPublish(run)) {
    return <div className="step-pad"><StageMessage text="产物会在评测通过发布闸门后开放发布。" running={!run.evaluation} /></div>;
  }

  return (
    <div className="execution-workspace">
      <StageMessage text="评测已通过发布闸门。确认访问范围后发布，这一步需要你手动确认。" />
      <Facts
        items={[
          ["产物类型", run.plan.output],
          ["谱系", run.participants.map((participant) => participant.name).join("、")],
          ["运行计划", `${run.plan.scenario.label} · ${run.plan.strategy.label} · ${run.plan.security.enhancements.map((item) => item.label).join("、") || "内置保护"}`],
        ]}
      />
      <div className="segmented" role="radiogroup" aria-label="发布范围">
        {(Object.keys(VISIBILITY_LABEL) as Visibility[]).map((option) => (
          <button type="button" role="radio" aria-checked={visibility === option} key={option} onClick={() => setVisibility(option)}>
            {VISIBILITY_LABEL[option]}
          </button>
        ))}
      </div>
      <button type="button" className="button button--primary publish-button" onClick={() => dispatch({ type: "publish", visibility })}>
        发布（模拟）
      </button>
    </div>
  );
}
