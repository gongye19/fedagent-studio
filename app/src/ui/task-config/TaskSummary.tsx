import { taskModelSummary } from "../../domain/config";
import { TASK_TYPES } from "../../domain/catalog";
import { ScenarioTag } from "../ScenarioTag";
import { CheckStatus } from "../CheckStatus";
import { modelLabel } from "../../domain/resources";
import { hrefOf, type Route } from "../../state/route";
import { type State } from "../../state/store";
import { Panel } from "../console";
import { formatNumber } from "../format";
import { EstimateBlock } from "../task-config/TaskEstimate";
import type { TaskConfigController } from "./useTaskConfig";
const endpointRoute = (id: string): Route => ({
  page: "editEndpoint",
  id,
  from: "newTask",
});

export function TaskSummary({
  state,
  config,
}: {
  state: State;
  config: TaskConfigController;
}) {
  const {
    draft,
    pending,
    setPending,
    algorithm,
    joined,
    result,
    canCreate,
    creating,
    createError,
    full,
    overrideCount,
    priceEndpoint,
    start,
    startLabel,
    validationPending,
    validationError,
    check,
  } = config;
  return (
    <aside className="order-summary" aria-label="配置摘要" id="task-summary">
      <Panel
        title="配置摘要"
        className="summary-panel"
        actions={
          <button
            type="button"
            className="button button--ghost button--compact summary-reset"
            disabled={!draft.touched || creating}
            onClick={() => setPending("restart")}
          >
            重置配置
          </button>
        }
      >
        <dl className="summary-list">
          <div>
            <dt>场景</dt>
            <dd>{algorithm ? <ScenarioTag scenario={algorithm.scenario} /> : "—"}</dd>
          </div>
          <div>
            <dt>算法</dt>
            <dd>{algorithm ? algorithm.name : "—"}</dd>
          </div>
          <div>
            <dt>应用</dt>
            <dd>{draft.taskType ? TASK_TYPES[draft.taskType].label : "—"}</dd>
          </div>
          <div>
            <dt>
              {algorithm?.requirements.agentRequired ? "资源组" : "数据来源"}
            </dt>
            <dd>
              {joined.length
                ? `${joined.length} ${algorithm?.requirements.agentRequired ? "组" : "个"}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>样本</dt>
            <dd>
              {result
                ? `${formatNumber(result.problems)} 条${full ? "" : `（每份最多 ${draft.trialCap} 条）`}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>运行</dt>
            <dd>
              {full ? "正式运行" : "试跑"} ·{" "}
              {TASK_TYPES[draft.taskType ?? ""]?.recordBased ? "提取并聚合经验" : algorithm?.evaluationLabels?.length ? `${algorithm.evaluationLabels.length} 组对照` : algorithm ? `${draft.rounds} 轮` : "—"}
            </dd>
          </div>
          <div>
            <dt>{draft.execution === "agent" ? "执行" : "模型"}</dt>
            <dd>
              {algorithm
                ? draft.execution === "agent"
                  ? algorithm.requirements.agentRequired
                    ? joined.length
                      ? [
                          ...new Set(
                            joined.map(
                              (p) =>
                                state.agents.find(
                                  (a) =>
                                    a.id ===
                                    draft.agentGroups.find(
                                      (g) => g.datasetId === p.datasetId,
                                    )?.agentId,
                                )?.name ?? "Agent 待选",
                            ),
                          ),
                        ].map((name) => (
                          <span className="summary-agent" key={name}>
                            {name}
                          </span>
                        ))
                      : "—"
                    : `${state.agents.find((a) => a.id === draft.agentId)?.name ?? "Agent 待选"}${algorithm.requirements.serverModel ? `；${algorithm.requirements.serverModelLabel ?? "汇总模型"} ${modelLabel(draft.serverModel, state.endpoints)}` : ""}`
                  : taskModelSummary(draft, state.endpoints, algorithm)
                : "—"}
            </dd>
          </div>
          {algorithm?.requirements.agentRequired && algorithm.requirements.serverModel ? (
            <div>
              <dt>{algorithm.requirements.serverModelLabel ?? "汇总模型"}</dt>
              <dd>{modelLabel(draft.serverModel, state.endpoints)}</dd>
            </div>
          ) : null}
          {overrideCount && !algorithm?.requirements.agentRequired ? (
            <div>
              <dt>单独指定</dt>
              <dd>{overrideCount} 个参与方</dd>
            </div>
          ) : null}
        </dl>
        {joined.length ? <EstimateBlock
            result={result}
            pending={!result || validationPending}
            remoteExecution={draft.execution === "agent"}
            serverModelLabel={algorithm?.requirements.serverModelLabel}
            priceHref={hrefOf(endpointRoute(priceEndpoint))}
          /> : null}
        <div className="summary-actions">
          <a
            className="button button--secondary button--block"
            href="#task-config-check"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("task-config-check")?.scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches
                  ? "instant"
                  : "smooth",
                block: "center",
              });
            }}
          >
            {config.preflight.valid ? <><CheckStatus status="passed" />连接状态</> : "查看连接状态"}
          </a>
          <button
            type="button"
            className="button button--primary button--block summary-start"
            disabled={creating || validationPending || config.preflight.running}
            data-ready={canCreate}
            aria-describedby="task-action-status"
            onClick={start}
          >
            {creating ? "正在创建…" : startLabel}
          </button>
          <p
            className="summary-issues"
            id="task-action-status"
            aria-live="polite"
          >
            {validationPending
              ? "正在检查配置…"
              : validationError || (pending !== "full" ? createError : null)}
          </p>
          {validationError ? (
            <button
              type="button"
              className="link-button"
              onClick={() => void check.refetch()}
            >
              重新检查
            </button>
          ) : null}
        </div>
      </Panel>
    </aside>
  );
}
