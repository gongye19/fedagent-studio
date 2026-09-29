import { algorithmsFor, SCENARIOS } from "../domain/catalog";
import { isConfigured } from "../domain/resources";
import { hrefOf } from "../state/route";
import type { State } from "../state/store";
import { PageHead, PanelEmpty, Tag } from "./common";
import { Panel } from "./console";
import { formatNumber } from "./format";
import { Icon } from "./icons";
import { sortTasks } from "./labels";
import { TaskTable } from "./TaskTable";

/** 首页：从场景开始新建任务，看最近的任务和平台上的资源。 */
export default function HomePage({ state }: { state: State }) {
  const recent = sortTasks(state.tasks).slice(0, 5);
  const online = state.participants.filter((participant) => participant.status === "online").length;
  const samples = state.datasets.reduce((sum, dataset) => sum + dataset.count, 0);
  const pending = state.endpoints.filter((endpoint) => !isConfigured(endpoint)).length;

  return (
    <>
      <PageHead title="首页" actions={<a className="button button--primary" href={hrefOf({ page: "newTask" })}><Icon name="plus" />新建联邦任务</a>} />

      <div className="scenario-grid">
        {SCENARIOS.map((scenario) => {
          const algorithms = algorithmsFor(scenario.id);
          const available = scenario.status === "available";
          return (
            <section key={scenario.id} className="panel scenario-tile" aria-labelledby={`scenario-${scenario.id}`}>
              <div className="scenario-tile-head">
                <h2 id={`scenario-${scenario.id}`}>{scenario.name}</h2>
                {available ? null : <Tag>规划中</Tag>}
              </div>
              <p>{scenario.summary}</p>
              <div className="scenario-tile-foot">
                <span className="muted">{algorithms.length ? `算法：${algorithms.map((item) => item.name).join("、")}` : "算法待接入"}</span>
                {available ? <a className="button button--secondary button--compact" href={hrefOf({ page: "newTask", scenario: scenario.id })}>新建联邦任务</a> : null}
              </div>
            </section>
          );
        })}
      </div>

      <dl className="resource-strip">
        <a className="resource" href={hrefOf({ page: "participants" })}>
          <dt>参与方<Icon name="chevron" /></dt>
          <dd><strong>{state.participants.length}</strong><span>{online} 个在线</span></dd>
        </a>
        <a className="resource" href={hrefOf({ page: "participants" })}>
          <dt>数据集<Icon name="chevron" /></dt>
          <dd><strong>{state.datasets.length}</strong><span>{formatNumber(samples)} 条样本</span></dd>
        </a>
        <a className="resource" href={hrefOf({ page: "models" })}>
          <dt>模型接口<Icon name="chevron" /></dt>
          <dd><strong>{state.endpoints.length}</strong><span>{pending ? `${pending} 个待配置` : "都已配置"}</span></dd>
        </a>
        <a className="resource" href={hrefOf({ page: "apps" })}>
          <dt>应用<Icon name="chevron" /></dt>
          <dd><strong>{state.published.length}</strong><span>由任务产出发布</span></dd>
        </a>
      </dl>

      <Panel
        title="最近任务"
        flush
        actions={state.tasks.length > recent.length ? <a className="text-link" href={hrefOf({ page: "tasks" })}>查看全部</a> : null}
      >
        {recent.length ? <TaskTable tasks={recent} /> : (
          <PanelEmpty action={<a className="button button--secondary button--compact" href={hrefOf({ page: "newTask" })}>新建联邦任务</a>}>还没有任务。</PanelEmpty>
        )}
      </Panel>
    </>
  );
}
