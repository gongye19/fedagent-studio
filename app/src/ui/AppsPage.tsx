import { libraries } from "../domain/task";
import { hrefOf } from "../state/route";
import { taskOf, type State } from "../state/store";
import { EmptyState, PageHead } from "./common";
import { Panel } from "./console";
import { formatDate } from "./format";
import { algorithmOfTask } from "./labels";

/** 应用：任务的产出发布后，可以试用或接入自己的 Agent。 */
export default function AppsPage({ state }: { state: State }) {
  if (!state.published.length) {
    return (
      <>
        <PageHead title="应用" />
        <EmptyState title="还没有应用" action={<a className="button button--secondary" href={hrefOf({ page: "tasks" })}>查看联邦任务</a>}>
          <p>在任务详情的“产出”里，把任意一版产出发布为应用。</p>
        </EmptyState>
      </>
    );
  }
  return (
    <>
      <PageHead title="应用" meta="任务的产出发布后成为应用，可以直接试用，也可以接入自己的 Agent。" />
      <Panel flush>
        <div className="table-shell">
          <table className="table table--stack">
            <thead>
              <tr>
                <th scope="col">应用</th>
                <th scope="col">类型</th>
                <th scope="col">来源任务</th>
                <th scope="col" className="numeric">发布时间</th>
              </tr>
            </thead>
            <tbody>
              {state.published.map((item) => {
                const task = taskOf(state, item.taskId);
                const version = task ? libraries(task).find((library) => library.builtAfterRound === item.builtAfterRound) : undefined;
                const algorithm = task ? algorithmOfTask(task) : null;
                return (
                  <tr key={item.id}>
                    <th scope="row">
                      <a className="table-link" href={hrefOf({ page: "app", id: item.id })}>{item.name}</a>
                      <small>{version ? `${version.insights.length} 条 · 第 ${item.builtAfterRound} 轮后` : `第 ${item.builtAfterRound} 轮后`}</small>
                    </th>
                    <td data-label="类型">{algorithm ? `${algorithm.output.name} · ${algorithm.name}` : "—"}</td>
                    <td data-label="来源任务">{task ? <a className="text-link" href={hrefOf({ page: "task", id: task.id })}>{task.name}</a> : "任务已删除"}</td>
                    <td className="numeric nowrap" data-label="发布时间">{formatDate(item.publishedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
