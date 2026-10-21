import { type Dispatch } from "react";
import { type ScenarioId } from "../domain/catalog";
import { type Action, type State } from "../state/store";
import { Confirm, Meta, PageHead } from "./common";
import { Panel } from "./console";
import { formatDuration, formatNumber, formatYuan } from "./format";
import { RunSettings, AdvancedPanel } from "./task-config/ExecutionSettings";
import { useTaskConfig } from "./task-config/useTaskConfig";
import { TaskBasicsPanel } from "./task-config/TaskBasicsPanel";
import { TaskResourcesPanel } from "./task-config/TaskResourcesPanel";
import { TaskSummary } from "./task-config/TaskSummary";
import { TaskStartBar } from "./task-config/TaskStartBar";
import { TaskCheckPanel } from "./task-config/TaskCheckPanel";
import { ResourceIntakeDialog } from "./ResourceIntakeDialog";

export default function TaskConfigPage({
  state,
  dispatch,
  initialScenario,
}: {
  state: State;
  dispatch: Dispatch<Action>;
  initialScenario?: ScenarioId;
}) {
  const config = useTaskConfig(state, dispatch, initialScenario);
  const {
    draft,
    algorithm,
    joined,
    result,
    canCreate,
    pending,
    setPending,
    create,
    restart,
    createError,
    formRef,
    intake,
    setIntake,
    scenarioId,
    taskType,
    update,
    fieldError,
    setSpace,
  } = config;
  const cost = result ? (result.cost === null ? "费用无法估算（没有设置单价）" : `费用${formatYuan(result.cost)}`) : "";
  // 确认条里的数字按段排版（Meta），不会把"3 轮"拆成两行。
  const confirm =
    pending === "full" && result && canCreate
      ? {
          title: "开始正式运行？",
          text: (
            <>
              <Meta
                parts={[`${joined.length} 个数据来源`, `${formatNumber(result.problems)} 条样本`, `${draft.rounds} 轮`]}
              />
              <Meta parts={[formatDuration(result.seconds), cost]} />
              <span>创建后配置不能修改，运行中可以暂停或取消。</span>
            </>
          ),
          confirmLabel: "确认开始",
          cancelLabel: "取消",
          tone: "primary" as const,
          onConfirm: create,
        }
      : pending === "restart"
        ? {
            title: "重置这次的配置？",
            text: "清空本次选择和运行配置，已保存到我的资源的数据与模型接口会保留。",
            confirmLabel: "重置",
            cancelLabel: "继续编辑",
            tone: "danger" as const,
            onConfirm: restart,
          }
        : null;

  return (
    <>
      <PageHead title="新建联邦任务" crumbs={[{ label: "联邦任务", route: { page: "tasks" } }]} />
      <div className="order-layout task-config" ref={formRef}>
        <div className="order-main">
          <TaskBasicsPanel dispatch={dispatch} config={config} />
          <TaskResourcesPanel state={state} dispatch={dispatch} config={config} />
          <Panel title="运行配置" id="settings" step={3}>
            <RunSettings draft={draft} update={update} algorithm={algorithm} roundsError={fieldError("rounds")} />
          </Panel>
          <TaskCheckPanel config={config} />
          <AdvancedPanel
            state={state}
            draft={draft}
            update={update}
            algorithm={algorithm}
            joined={joined.map((item) => item.participantId)}
            error={fieldError("params")}
          />
        </div>
        <TaskSummary state={state} config={config} />
      </div>
      {confirm ? (
        <Confirm
          title={confirm.title}
          confirmLabel={confirm.confirmLabel}
          cancelLabel={confirm.cancelLabel}
          tone={confirm.tone}
          onConfirm={confirm.onConfirm}
          onCancel={() => setPending(null)}
          error={pending === "full" ? createError : undefined}
        >
          {confirm.text}
        </Confirm>
      ) : null}
      <TaskStartBar config={config} />
      <ResourceIntakeDialog
        state={state}
        kind={intake === "data" || intake === "agent" ? intake : intake ? "model" : null}
        category={scenarioId && taskType ? { scenario: scenarioId, taskType } : undefined}
        onClose={() => { setIntake(null); config.setAgentTarget(null); }}
        onSaved={async (saved) => {
          if (saved.kind === "data") {
            const resource = saved.value;
            setSpace("workspace");
            if (resource.dataset.ready)
              dispatch({ type: "pickDataset", participantId: resource.source.id, datasetId: resource.dataset.id });
          } else if (saved.kind === "agent") {
            if (config.agentTarget) {
              await config.binding.save(config.agentTarget, saved.value.id);
              config.setAgentTarget(null);
            } else if (!algorithm?.requirements.agentRequired) update({ execution: "agent", agentId: saved.value.id });
          } else if (intake === "clientModel" || intake === "serverModel") {
            update({ [intake]: `${saved.value.id}:${saved.value.models[0]}` });
          }
          setIntake(null);
        }}
      />
    </>
  );
}
