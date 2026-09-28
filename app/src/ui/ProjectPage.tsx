import { useState } from "react";
import { PROJECT_STATUS_LABEL, projectStatus, readiness, type Project } from "../domain/project";
import { stageOf } from "../domain/run";
import { hrefOf } from "../state/route";
import type { Action, State } from "../state/store";
import { StageMessage, StepActions, StepFrame } from "./common";
import ConfigSummary from "./ConfigSummary";
import DeliveryStep from "./DeliveryStep";
import { FLOW_STEPS, isRunStage, labelOf, nextFlowStep, previousFlowStep, type FlowStepId } from "./flow";
import { formatDate } from "./format";
import { Icon } from "./icons";
import ParticipantsStep from "./ParticipantsStep";
import { PROJECT_TONE, STAGE_TONE, STATUS_LABEL, currentStep, stepStates } from "./progress";
import StageStep from "./StageStep";

type Props = { project: Project; state: State; dispatch: (action: Action) => void };

/** 项目详情：左侧是当前步骤，右侧是七步时间轴和项目概况。 */
export default function ProjectPage({ project, state, dispatch }: Props) {
  // 未手动切换时跟随当前进度（运行中自动停在正在进行的阶段）；点击时间轴或上一步 / 下一步后停在所选步骤。
  const [chosen, setActive] = useState<FlowStepId | null>(null);
  const active = chosen ?? currentStep(project);
  const steps = stepStates(project);
  const status = projectStatus(project);
  const progress = readiness(project);
  const initiator = project.role === "initiator";
  const index = FLOW_STEPS.findIndex((step) => step.id === active);
  const next = nextFlowStep(active);

  function start() {
    dispatch({ type: "startRun", projectId: project.id, runId: `run-${Date.now()}`, createdAt: new Date().toISOString() });
    setActive(null);
  }

  function content() {
    const label = labelOf(active);
    const nextLabel = `下一步：${labelOf(next)}`;
    if (active === "configure") {
      return (
        <StepFrame title={label} status="已锁定" statusTone="complete">
          <div className="execution-workspace">
            <StageMessage text="配置在创建项目时已锁定，各参与方按这份配置确认方案。修改配置需要新建项目。" />
            <ConfigSummary plan={project.plan} perspective={initiator ? "initiator" : "participant"} />
          </div>
          <StepActions onNext={() => setActive("participants")} nextLabel={nextLabel} />
        </StepFrame>
      );
    }
    if (active === "participants") {
      const canStart = initiator && !project.run && progress.ready;
      return (
        <StepFrame title={label} status={steps.participants.label} statusTone={progress.ready || project.run ? "complete" : undefined}>
          <ParticipantsStep project={project} state={state} dispatch={dispatch} />
          <StepActions
            onBack={() => setActive("configure")}
            onNext={project.run ? () => setActive("preflight") : initiator ? start : undefined}
            nextLabel={project.run ? nextLabel : "开始运行"}
            nextDisabled={!project.run && !canStart}
          />
        </StepFrame>
      );
    }
    if (active === "publish") {
      const item = steps.publish;
      return (
        <StepFrame title={label} status={project.run?.error ? STATUS_LABEL.failed : item.label} statusTone={project.run?.error ? "failed" : STAGE_TONE[item.state]}>
          <DeliveryStep project={project} dispatch={dispatch} />
          <StepActions onBack={() => setActive("evaluate")} />
        </StepFrame>
      );
    }
    if (isRunStage(active)) {
      const value = project.run ? stageOf(project.run, active).status : "pending";
      return (
        <StepFrame title={label} status={STATUS_LABEL[value]} statusTone={STAGE_TONE[value]}>
          <StageStep stageId={active as Exclude<typeof active, "publish">} run={project.run} />
          <StepActions onBack={() => setActive(previousFlowStep(active) ?? "participants")} onNext={() => next && setActive(next)} nextLabel={nextLabel} />
        </StepFrame>
      );
    }
    return null;
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{project.name}</h1>
          <p className="page-meta">
            <span>{project.plan.scenario.label}</span>
            <span>{initiator ? "发起方：本机构" : `发起方：${project.initiatorOrg} · 本机构为参与方`}</span>
            <span>创建于 {formatDate(project.createdAt)}</span>
            <span className={`status${PROJECT_TONE[status] ? ` status--${PROJECT_TONE[status]}` : ""}`}>{PROJECT_STATUS_LABEL[status]}</span>
          </p>
        </div>
        <span className="draft-id" translate="no">{project.run?.id ?? project.id}</span>
      </header>

      <nav className="mobile-progress" aria-label="项目进度">
        <p>
          <strong>第 {index + 1} / {FLOW_STEPS.length} 步</strong>
          <span>{labelOf(active)} · {steps[active].label}</span>
        </p>
        <ol aria-hidden="true">
          {FLOW_STEPS.map((step) => (
            <li
              key={step.id}
              className={`mobile-progress-segment mobile-progress-segment--${steps[step.id].state}${step.id === active ? " mobile-progress-segment--current" : ""}`}
            />
          ))}
        </ol>
      </nav>

      <div className="run-workspace">
        {content()}
        <aside className="run-panel" aria-labelledby="timeline-title">
          <header className="panel-head">
            <h2 id="timeline-title">项目进度</h2>
            <span className={`status${PROJECT_TONE[status] ? ` status--${PROJECT_TONE[status]}` : ""}`}>{PROJECT_STATUS_LABEL[status]}</span>
          </header>
          <ol className="run-timeline" aria-label="项目步骤">
            {FLOW_STEPS.map((step) => {
              const item = steps[step.id];
              const current = active === step.id;
              return (
                <li className={`timeline-item timeline-item--${item.state}${current ? " timeline-item--current" : ""}`} key={step.id}>
                  <button type="button" aria-current={current ? "step" : undefined} onClick={() => setActive(step.id)}>
                    <span className="timeline-mark" aria-hidden="true">
                      {item.state === "done" ? <Icon name="check" /> : item.state === "failed" ? <Icon name="x" /> : null}
                    </span>
                    <span className="timeline-copy">
                      <strong>{step.label}</strong>
                      <small>{item.label}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <section className="derived" aria-labelledby="overview-title">
            <h3 id="overview-title">项目概况</h3>
            <dl>
              <div><dt>执行框架</dt><dd>{project.plan.runner} · {project.plan.patternLabel}</dd></div>
              <div><dt>模型</dt><dd>{project.plan.sharing ? `${project.plan.model.label} · ${project.plan.sharing}` : project.plan.model.label}</dd></div>
              <div><dt>参与方</dt><dd>{project.run ? `${project.run.participants.length} 方参加` : `${progress.confirmed} / 最少 ${progress.min} 方`}</dd></div>
              <div><dt>资源</dt><dd>{project.plan.estimate.resources}</dd></div>
              <div><dt>预计耗时</dt><dd>{project.plan.estimate.duration}</dd></div>
              <div><dt>交付物</dt><dd>{project.plan.deliverable} · {project.plan.deliveryScope.label}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}

export function ProjectNotFound() {
  return (
    <div className="empty-page">
      <h1>找不到这个项目</h1>
      <p>项目可能已被重置。回到工作台查看现有项目。</p>
      <a className="button button--secondary" href={hrefOf({ page: "workbench" })}>回到工作台</a>
    </div>
  );
}
