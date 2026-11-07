import { algorithmOf, visibleTaskType } from "../domain/catalog";
import { outputs } from "../domain/task";
import { hrefOf } from "../state/route";
import type { State } from "../state/store";
import { PageHead, Tag } from "./common";
import { formatDate, formatNumber } from "./format";
import { ResourceTable } from "./resources/ResourceTable";

function resultRows({ tasks, published }: State) {
  const publishedVersions = new Set(published.map((item) => `${item.taskId}:${item.builtAfterRound}`));
  const saved = published.filter((item) => visibleTaskType(item.taskType)).map((item) => ({
    id: item.id,
    name: item.name,
    algorithm: algorithmOf(item.algorithm).name,
    count: item.items.length,
    updated: item.publishedAt,
    published: true,
    href: hrefOf({ page: "app", id: item.id, tab: "content" }),
  }));
  const generated = tasks.flatMap((task) => {
    if (task.status !== "completed" || !visibleTaskType(task.config.taskType)) return [];
    const version = outputs(task).at(-1);
    if (!version || publishedVersions.has(`${task.id}:${version.builtAfterRound}`)) return [];
    const algorithm = algorithmOf(task.config.algorithm);
    return [{
      id: task.id,
      name: `${task.name} · ${algorithm.output.name}`,
      algorithm: algorithm.name,
      count: version.items.length,
      updated: task.finishedAt ?? task.createdAt,
      published: false,
      href: hrefOf({ page: "task", id: task.id, tab: "output" }),
    }];
  });
  return [...saved, ...generated].sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
}

export default function FederationResultsPage({ state }: { state: State }) {
  const rows = resultRows(state);
  return (
    <>
      <PageHead title="联邦成果" meta="查看联邦任务生成的成果。经验包发布后可在应用中使用。" />
      <ResourceTable label="联邦成果列表" columns={[
        { label: "成果名称" }, { label: "算法" }, { label: "条目数", className: "numeric" },
        { label: "发布状态" }, { label: "更新时间" },
      ]} empty={!rows.length} emptyContent={
        <>暂无联邦成果。<a className="text-link" href={hrefOf({ page: "tasks" })}>查看联邦任务</a></>
      }>
        {rows.map((item) => (
          <tr key={item.id}>
            <th scope="row"><a className="table-link" href={item.href}>{item.name}</a></th>
            <td data-label="算法">{item.algorithm}</td>
            <td className="numeric" data-label="条目数">{formatNumber(item.count)}</td>
            <td data-label="发布状态"><Tag tone={item.published ? "success" : "neutral"}>{item.published ? "已发布" : "未发布"}</Tag></td>
            <td data-label="更新时间"><time dateTime={item.updated}>{formatDate(item.updated)}</time></td>
          </tr>
        ))}
      </ResourceTable>
    </>
  );
}
