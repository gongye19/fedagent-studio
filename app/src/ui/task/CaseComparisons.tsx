import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TASK_TYPES } from "../../domain/catalog";
import type { components } from "../../api/schema";
import { request } from "../../api/client";
import { isActive, stagesOf, type Task } from "../../domain/task";
import { CheckStatus } from "../CheckStatus";
import { Panel } from "../console";
import { InfoTip } from "../InfoTip";
import { Icon } from "../icons";

type Row = components["schemas"]["CaseComparisonOut"];
const PAGE = 20;
const outcomes = { passed: "回答正确", incorrect: "答案未匹配", error: "执行失败", unlabeled: "未判分" };

export function CaseComparisons({ task }: { task: Task }) {
  const [offset, setOffset] = useState(0);
  const client = useQueryClient();
  const id = task.id, status = task.status;
  useEffect(() => { void client.invalidateQueries({ queryKey: ["case-comparisons", id] }); }, [client, id, status]);
  const query = useQuery({ queryKey: ["case-comparisons", id, offset],
    queryFn: () => request<components["schemas"]["CaseComparisonPageOut"]>("GET", `/v1/tasks/${encodeURIComponent(id)}/case-comparisons?offset=${offset}&limit=${PAGE}`),
    refetchInterval: isActive(task) ? 2000 : false });
  return <Panel title={<>评测案例<InfoTip label="案例范围">展示全部已记录的独立评测病例，同一病例并列比较三组回答。经验生成病例不计入评测。答案未匹配不代表已经定位到内部出错原因。</InfoTip></>}>
    {query.isPending ? <div className="case-empty"><CheckStatus status="running" label="正在读取案例" /></div> : query.isError ? <div className="case-empty"><p role="alert">案例读取失败</p><button type="button" className="button button--secondary button--compact" onClick={() => void query.refetch()}>重试</button></div> : query.data.items.length ? <>
      <ul className="case-list">{query.data.items.map((item) => <ComparisonCase key={item.key} item={item} task={task} />)}</ul>
      <div className="case-pagination"><span>共 {query.data.total} 条</span>{query.data.total > PAGE ? <>
        <button type="button" className="button button--ghost button--compact" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - PAGE))}>上一页</button>
        <button type="button" className="button button--ghost button--compact" disabled={!query.data.hasMore} onClick={() => setOffset(offset + PAGE)}>下一页</button>
      </> : null}</div>
    </> : <p className="case-empty muted">独立评测完成后展示案例</p>}
  </Panel>;
}

export function ComparisonCase({ item, task }: { item: Row; task: Task }) {
  const member = task.members.find((m) => m.participantId === item.site);
  const source = item.cases.find((c) => c.fields?.length || c.input) ?? item.cases[0];
  const failedStep = stagesOf(task).find((s) => s.id === source?.step)?.label ?? "步骤执行";
  return <li><details className="case-result case-result--comparison"><summary>
    <div className="case-summary"><strong>{item.itemId === "_" ? `${failedStep}失败` : item.itemId}</strong><span>{member?.agentName ?? member?.participant ?? item.site}</span></div>
    <div className="case-group-status">{task.evaluationLabels?.map((label, i) => {
      const row = item.cases.find((c) => c.round === i + 1);
      return <span key={label}><CheckStatus status={!row || row.outcome === "unlabeled" ? "pending" : row.outcome === "passed" ? "passed" : "failed"} label={row ? outcomes[row.outcome] : "尚未完成"} />{label}</span>;
    })}</div><Icon name="chevron" />
  </summary><div className="case-body">
    {source?.reference ? <dl className="case-reference"><dt>{TASK_TYPES[task.config.taskType].answerLabel ?? "参考答案"}</dt><dd>{source.reference}</dd></dl> : null}
    <div className="case-answers">{task.evaluationLabels?.map((label, i) => {
      const row = item.cases.find((c) => c.round === i + 1);
      return <section key={label}><h3>{label}<span className={`case-label case-label--${row?.outcome ?? "pending"}`}>{row ? outcomes[row.outcome] : "尚未完成"}</span></h3>
        <p>{row?.prediction ?? row?.error ?? (row ? "未保存回答正文" : "—")}</p>
      </section>;
    })}</div>
    {source?.fields?.length || source?.input ? <details className="case-input"><summary>查看病例</summary>
    <dl className="case-content">{source?.fields?.map((field, i) => <div key={i}><dt>{field.label}</dt><dd>{field.text}</dd></div>)}
      {source?.input ? <div><dt>输入</dt><dd>{source.input}</dd></div> : null}
    </dl>
    </details> : null}
  </div></details></li>;
}
