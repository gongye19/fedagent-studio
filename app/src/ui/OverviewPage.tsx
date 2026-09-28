import type { Dispatch } from "react";
import type { Route } from "../state/route";
import { algorithmsFor, SCENARIOS, type Scenario } from "../domain/catalog";
import { progressOf, totalProblems } from "../domain/task";
import { hrefOf } from "../state/route";
import type { Action, State } from "../state/store";
import { EmptyState, PageHead, Panel, ProgressBar, StatusPill } from "./common";
import { formatDate, formatNumber } from "./format";
import { Icon } from "./icons";
import { stageText } from "./labels";
import { TaskTable } from "./TaskTable";

/** 平台的使用流程：从选场景到用上洞见库。 */
const STEPS: readonly { title: string; text: string; link: string; route: Route }[] = [
  { title: "选场景和算法", text: "横向联邦 Agent 用 FoT；纵向和迁移的算法规划中", link: "新建任务", route: { page: "newTask" } },
  { title: "选数据", text: "每份数据由一个参与方持有，题目和答案不离开持有方", link: "参与方与数据", route: { page: "participants" } },
  { title: "运行", text: "每轮参与方解题、反思、提取 trace，服务端汇成洞见库再下发", link: "联邦任务", route: { page: "tasks" } },
  { title: "看结果，用洞见库", text: "对比第 1 轮（本地）和最后一轮（联邦）；发布洞见库后试用或导出", link: "洞见库", route: { page: "libraries" } },
];

export default function OverviewPage({ state }: { state: State; dispatch: Dispatch<Action> }) {
  const running = state.tasks.filter((task) => task.status === "running" || task.status === "paused");
  const recent = state.tasks.slice(0, 5);
  const online = state.participants.filter((participant) => participant.status === "online").length;
  const problems = state.datasets.reduce((sum, dataset) => sum + dataset.count, 0);

  return (
    <>
      <PageHead
        title="总览"
        actions={<a className="button button--primary" href={hrefOf({ page: "newTask" })}><Icon name="plus" />新建联邦任务</a>}
      />

      <ol className="usage-steps" aria-label="使用流程">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="usage-index" aria-hidden="true">{index + 1}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.text}</p>
              <a className="text-link" href={hrefOf(step.route)}>{step.link}</a>
            </div>
          </li>
        ))}
      </ol>

      <section className="section" aria-labelledby="scenarios-title">
        <h2 className="section-title" id="scenarios-title">场景</h2>
        <div className="scenario-grid">
          {SCENARIOS.map((scenario) => <ScenarioCard key={scenario.id} scenario={scenario} />)}
        </div>
      </section>

      <div className="overview-grid">
        <div className="stack">
          {running.length ? (
            <Panel title="进行中" id="running" flush>
              <ul className="running-list">
                {running.map((task) => (
                  <li key={task.id}>
                    <div>
                      <a className="table-link" href={hrefOf({ page: "task", id: task.id, tab: "progress" })}>{task.name}</a>
                      <small>{task.status === "paused" ? "已暂停 · " : ""}{stageText(task)} · {task.members.length} 方 · {totalProblems(task)} 题</small>
                    </div>
                    <ProgressBar value={progressOf(task)} label={`${task.name} 的进度`} tone={task.status === "running" ? "info" : "warning"} />
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel title="最近任务" id="recent" flush extra={<a className="text-link" href={hrefOf({ page: "tasks" })}>全部任务</a>}>
            {recent.length ? <TaskTable tasks={recent} /> : (
              <EmptyState title="还没有任务" action={<a className="button button--secondary" href={hrefOf({ page: "newTask" })}>新建联邦任务</a>} />
            )}
          </Panel>
        </div>

        <aside className="stack" aria-label="资源概况">
          <Panel title="资源" id="resources" flush>
            <ul className="resource-list">
              <li>
                <a href={hrefOf({ page: "participants" })}>参与方</a>
                <span>{state.participants.length} 个 · 在线 {online}</span>
              </li>
              <li>
                <a href={hrefOf({ page: "participants" })}>题库</a>
                <span>{state.datasets.length} 份 · {formatNumber(problems)} 题</span>
              </li>
              <li>
                <a href={hrefOf({ page: "models" })}>模型接口</a>
                <span>{state.endpoints.length} 个 · {state.endpoints.reduce((sum, endpoint) => sum + endpoint.models.length, 0)} 个模型</span>
              </li>
            </ul>
          </Panel>

          <Panel title="已发布的洞见库" id="published" flush extra={<a className="text-link" href={hrefOf({ page: "libraries" })}>全部</a>}>
            {state.published.length ? (
              <ul className="resource-list">
                {state.published.slice(0, 4).map((item) => (
                  <li key={item.id}>
                    <a href={hrefOf({ page: "library", id: item.id })}>{item.name}</a>
                    <span>{formatDate(item.publishedAt)}</span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="还没有发布的洞见库">任务完成后，在任务详情的"洞见库"里发布。</EmptyState>}
          </Panel>
        </aside>
      </div>
    </>
  );
}

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const available = scenario.status === "available";
  const algorithms = algorithmsFor(scenario.id);
  return (
    <article className={`scenario-card${available ? "" : " scenario-card--planned"}`}>
      <header>
        <h3>{scenario.name}</h3>
        <StatusPill tone={available ? "success" : "neutral"}>{available ? "可用" : "规划中"}</StatusPill>
      </header>
      <p>{scenario.summary}</p>
      <dl className="scenario-facts">
        <div><dt>算法</dt><dd>{algorithms.length ? algorithms.map((algorithm) => algorithm.name).join("、") : "待接入"}</dd></div>
        <div><dt>数据</dt><dd>{scenario.dataNeeds}</dd></div>
        <div><dt>例子</dt><dd>{scenario.example}</dd></div>
      </dl>
      {available ? (
        <a className="button button--secondary" href={hrefOf({ page: "newTask", scenario: scenario.id })}>
          新建任务<Icon name="chevron" />
        </a>
      ) : (
        <a className="button button--ghost" href={hrefOf({ page: "newTask", scenario: scenario.id })}>查看说明</a>
      )}
    </article>
  );
}
