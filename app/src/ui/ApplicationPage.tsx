import { TASK_TYPES, algorithmOf } from "../domain/catalog";
import { availableResource } from "../domain/resources";
import { hrefOf } from "../state/route";
import type { State } from "../state/store";
import { NotFound, PageHead, PanelEmpty } from "./common";
import { Panel } from "./console";
import { formatDate } from "./format";

export default function ApplicationPage({ state, taskType }: { state: State; taskType: string }) {
  const definition = TASK_TYPES[taskType];
  if (!definition?.recordBased) return <NotFound kind="应用" back={{ page: "apps" }} backLabel="应用" />;
  const libraries = state.published.filter((item) => item.taskType === taskType);
  const hasRecords = state.datasets.some((item) => item.taskType === taskType && item.ready && availableResource(item));
  return (
    <>
      <PageHead title={definition.label} back={{ label: "应用", route: { page: "apps" } }}
        meta="从已有过程生成经验库，再用经验处理新的输入。" />
      <div className="list-toolbar">
        <a className={`button ${hasRecords ? "button--primary" : "button--secondary"}`}
          href={hrefOf({ page: "newTask", application: taskType })}>生成经验库</a>
        <a className={`button ${hasRecords ? "button--secondary" : "button--primary"}`}
          href={hrefOf({ page: "resources", kind: "data" })}>上传过程记录</a>
      </div>
      <Panel title="可用经验库" flush>
        {libraries.length ? (
          <div className="table-shell">
            <table className="table table--stack" aria-label={`${definition.label}经验库`}>
              <thead><tr><th scope="col">经验库</th><th scope="col">算法</th><th scope="col">发布时间</th><th scope="col">操作</th></tr></thead>
              <tbody>{libraries.map((library) => (
                <tr key={library.id}>
                  <th scope="row">{library.name}</th>
                  <td data-label="算法">{algorithmOf(library.algorithm).name}</td>
                  <td data-label="发布时间">{formatDate(library.publishedAt)}</td>
                  <td data-label="操作"><a className="text-link" href={hrefOf({ page: "app", id: library.id })}>使用经验库</a></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <PanelEmpty>{hasRecords ? "选择过程记录生成经验库，发布后在这里使用。" : "先上传过程记录。"}</PanelEmpty>}
      </Panel>
    </>
  );
}
