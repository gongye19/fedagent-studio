import { TASK_TYPES, visibleTaskType } from "../domain/catalog";
import { availableResource, usable } from "../domain/resources";
import { hrefOf } from "../state/route";
import type { State } from "../state/store";
import { PageHead, PanelEmpty, Stat } from "./common";
import { Panel } from "./console";
import { formatDate } from "./format";
import { Icon } from "./icons";
import { ScenarioTag } from "./ScenarioTag";
import { TaskStatus } from "./TaskTable";

export default function HomePage({ state }: { state: State }) {
  const tasks = state.tasks.filter((task) => visibleTaskType(task.config.taskType));
  const running = tasks.filter((task) => task.status === "running").length;
  const queued = tasks.filter((task) => task.status === "queued").length;
  const paused = tasks.filter((task) => task.status === "paused").length;
  const recent = tasks.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const readyData = state.datasets.filter((item) => visibleTaskType(item.taskType) && availableResource(item) && usable(item, state.participants)).length;
  const readyModels = state.endpoints.filter((item) => availableResource(item) && item.configured && item.verified && item.models.length).length;
  const packages = state.published.filter((item) => visibleTaskType(item.taskType) && TASK_TYPES[item.taskType]?.recordBased && item.items.length).length;

  return (
    <>
      <PageHead title="工作台" meta="查看联邦任务、可用资源和已发布成果。" actions={
        <a className="button button--primary" href={hrefOf({ page: "newTask" })}><Icon name="plus" />新建联邦任务</a>
      } />
      <Panel title="平台概览" id="workspace-overview">
        <dl className="stats">
          <Stat label="运行中与排队中" value={running + queued} sub={`${running} 个运行中 · ${queued} 个排队中 · ${paused} 个已暂停`}
            href={hrefOf({ page: "tasks" })} />
          <Stat label="可用数据集" value={readyData} href={hrefOf({ page: "resources" })} />
          <Stat label="已验证大模型接口" value={readyModels} href={hrefOf({ page: "models" })} />
          <Stat label="已发布经验包" value={packages} href={hrefOf({ page: "apps" })} />
        </dl>
      </Panel>
      <Panel title="最近任务" id="workspace-recent" flush actions={
        <a className="button button--secondary button--compact" href={hrefOf({ page: "tasks" })}>查看全部任务</a>
      }>
        {recent.length ? (
          <div className="table-shell">
            <table className="table table--stack" aria-label="最近任务">
              <thead><tr><th scope="col">任务名称</th><th scope="col">场景</th><th scope="col">状态</th><th scope="col">创建时间</th></tr></thead>
              <tbody>
                {recent.map((task) => (
                  <tr key={task.id}>
                    <th scope="row"><a className="table-link" href={hrefOf({ page: "task", id: task.id })}>{task.name}</a></th>
                    <td data-label="场景"><span><ScenarioTag scenario={task.config.scenario} /></span></td>
                    <td data-label="状态"><span><TaskStatus task={task} /></span></td>
                    <td data-label="创建时间"><time dateTime={task.createdAt}>{formatDate(task.createdAt)}</time></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <PanelEmpty>暂无联邦任务。</PanelEmpty>}
      </Panel>
    </>
  );
}
