import { libraries } from "../domain/task";
import { hrefOf } from "../state/route";
import { taskOf, type State } from "../state/store";
import { EmptyState, PageHead, Panel } from "./common";
import { formatDate } from "./format";

export default function LibrariesPage({ state }: { state: State }) {
  return (
    <>
      <PageHead title="洞见库" meta="任务生成的洞见库发布到这里后，可以在平台上试用，也可以导出到自己的 Agent 里使用。" />
      <Panel title="已发布" id="published-libraries" flush>
        {state.published.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">洞见库</th>
                  <th scope="col" className="numeric">洞见</th>
                  <th scope="col" className="numeric">参与方</th>
                  <th scope="col">来源任务</th>
                  <th scope="col">发布时间</th>
                </tr>
              </thead>
              <tbody>
                {state.published.map((item) => {
                  const task = taskOf(state, item.taskId);
                  const version = task ? libraries(task).find((library) => library.builtAfterRound === item.builtAfterRound) : undefined;
                  return (
                    <tr key={item.id}>
                      <td>
                        <a className="table-link" href={hrefOf({ page: "library", id: item.id })}>{item.name}</a>
                        <small>第 {item.builtAfterRound} 轮后生成</small>
                      </td>
                      <td className="numeric">{version ? `${version.insights.length} 条` : "—"}</td>
                      <td className="numeric">{task ? `${task.members.length} 方` : "—"}</td>
                      <td>{task ? <a className="text-link" href={hrefOf({ page: "task", id: task.id })}>{task.name}</a> : "任务已删除"}</td>
                      <td className="nowrap">{formatDate(item.publishedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="还没有发布的洞见库">任务完成后，在任务详情的"洞见库"里选一个版本发布。</EmptyState>
        )}
      </Panel>
    </>
  );
}
