import { libraries } from "../domain/task";
import { hrefOf } from "../state/route";
import { taskOf, type State } from "../state/store";
import { EmptyState, PageHead } from "./common";
import { formatDate } from "./format";

export default function LibrariesPage({ state }: { state: State }) {
  return (
    <>
      <PageHead title="洞见库" meta="任务发布的洞见库可以在这里试用，也可以导出到自己的 Agent。" />
      {state.published.length ? (
        <div className="table-shell">
          <table className="table table--stack">
            <thead>
              <tr>
                <th scope="col">洞见库</th>
                <th scope="col" className="numeric">洞见</th>
                <th scope="col">来源任务</th>
                <th scope="col" className="numeric">发布时间</th>
              </tr>
            </thead>
            <tbody>
              {state.published.map((item) => {
                const task = taskOf(state, item.taskId);
                const version = task ? libraries(task).find((library) => library.builtAfterRound === item.builtAfterRound) : undefined;
                return (
                  <tr key={item.id}>
                    <th scope="row">
                      <a className="table-link" href={hrefOf({ page: "library", id: item.id })}>{item.name}</a>
                      <small>第 {item.builtAfterRound} 轮后生成{task ? ` · ${task.members.length} 个参与方` : ""}</small>
                    </th>
                    <td className="numeric" data-label="洞见">{version ? `${version.insights.length} 条` : "—"}</td>
                    <td data-label="来源任务">{task ? <a className="text-link" href={hrefOf({ page: "task", id: task.id })}>{task.name}</a> : "任务已删除"}</td>
                    <td className="numeric nowrap" data-label="发布时间">{formatDate(item.publishedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="还没有发布的洞见库" action={<a className="button button--secondary" href={hrefOf({ page: "tasks" })}>查看联邦任务</a>}>
          <p>任务完成后，在任务详情的“洞见库”里选一个版本发布。</p>
        </EmptyState>
      )}
    </>
  );
}
