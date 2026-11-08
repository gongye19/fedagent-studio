import { useQuery } from "@tanstack/react-query";
import { packageEvaluations, type PackageEvaluationSummary } from "../../api/evaluations";
import { hrefOf } from "../../state/route";
import { Notice, PageHead, Tag } from "../common";
import { formatDate } from "../format";
import { Icon } from "../icons";
import { ResourceTable } from "../resources/ResourceTable";
import { activeEvaluation, evaluationListKey, USAGE } from "./evaluationView";

const STATUS = {
  queued: "排队中", running: "评测中", paused: "已暂停", canceled: "已停止", completed: "已完成",
} as const;

export function EvaluationStatus({ status }: { status: PackageEvaluationSummary["status"] }) {
  return <Tag tone={status === "completed" ? "success" : status === "paused" ? "warning" : "neutral"}>{STATUS[status]}</Tag>;
}

export function EvaluationsPage() {
  const list = useQuery({
    queryKey: evaluationListKey,
    queryFn: ({ signal }) => packageEvaluations.list(signal),
    refetchInterval: ({ state }) => state.data?.some(({ status }) => activeEvaluation(status)) ? 4000 : false,
  });
  const rows = list.data ?? [];

  return <>
    <PageHead title="联邦评测" meta="用同一批病例对比不加载经验和加载经验包的诊断结果。" actions={
      <a className="button button--primary" href={hrefOf({ page: "newEvaluation" })}><Icon name="plus" />新建评测</a>
    } />
    {list.isError ? <Notice tone="warning">评测记录读取失败。<button type="button" className="text-link" onClick={() => void list.refetch()}>重试</button></Notice> : null}
    <ResourceTable label="联邦评测列表" columns={[
      { label: "经验包" }, { label: "病例范围" }, { label: "病例数", className: "numeric" }, { label: "状态" }, { label: "创建时间" },
    ]} empty={!rows.length} emptyContent={list.isPending ? "正在读取评测记录…" : list.isError ? "暂时无法读取评测记录。" : "暂无评测记录。"}>
      {rows.map((row) => <tr key={row.id}>
        <th scope="row"><a className="table-link" href={hrefOf({ page: "evaluation", id: row.id })}>{row.packageName}</a></th>
        <td data-label="病例范围">{USAGE[row.usage]}</td>
        <td data-label="病例数" className="numeric">{row.total}</td>
        <td data-label="状态"><EvaluationStatus status={row.status} /></td>
        <td data-label="创建时间"><time dateTime={row.createdAt}>{formatDate(row.createdAt)}</time></td>
      </tr>)}
    </ResourceTable>
  </>;
}
