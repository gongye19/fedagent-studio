import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { casePage, type CaseResult, type CaseOutcome } from "../../api/cases";
import { isActive, latestScoredRound, stagesOf, type Task } from "../../domain/task";
import { CheckStatus } from "../CheckStatus";
import { Panel } from "../console";
import { InfoTip } from "../InfoTip";
import { SelectField } from "../SelectField";
import { Icon } from "../icons";

const LABELS: Record<CaseOutcome, string> = { passed: "回答正确", incorrect: "回答错误", unlabeled: "未判分", error: "执行失败" };

export function CaseResults({ task }: { task: Task }) {
  const [selectedRound, setRound] = useState(() => latestScoredRound(task) ?? task.cursor?.round ?? 1);
  const client = useQueryClient();
  const taskId = task.id, status = task.status;
  useEffect(() => { void client.invalidateQueries({ queryKey: ["cases", taskId] }); }, [client, taskId, status]);
  const [outcome, setOutcome] = useState("");
  const [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: ["cases", task.id, selectedRound, outcome, offset], queryFn: () => casePage(task.id, selectedRound, outcome, offset), refetchInterval: isActive(task) ? 2000 : false });
  return <Panel title={<>回答案例<InfoTip label="案例判定">按本任务的判分规则标记对错。答案未匹配定位到结果评测，不代表已经查明内部出错原因。历史任务仅展示已保存的内容。</InfoTip></>}>
    <div className="case-filters">
      <SelectField aria-label="案例轮次" value={selectedRound} onValueChange={(value) => { setRound(Number(value)); setOffset(0); }}>
        {Array.from({ length: task.config.rounds }, (_, i) => <option key={i + 1} value={i + 1}>第 {i + 1} 轮</option>)}
      </SelectField>
      <div className="case-outcomes" role="group" aria-label="案例结果">
        {["", "passed", "incorrect", "error", "unlabeled"].filter((key) => key === "" || key === "passed" || key === "incorrect" || outcome === key || (query.data?.counts[key] ?? 0) > 0).map((key) => <button key={key} type="button" className="button button--ghost button--compact" aria-pressed={outcome === key} onClick={() => { setOutcome(key); setOffset(0); }}>
          {key ? LABELS[key as CaseOutcome] : "全部"}{key && query.data ? <span>{query.data.counts[key] ?? 0}</span> : null}
        </button>)}
      </div>
    </div>
    {query.isPending ? <div className="case-empty"><CheckStatus status="running" label="正在读取案例" /></div> : query.isError ? <div className="case-empty"><p role="alert">案例读取失败</p><button type="button" className="button button--secondary button--compact" onClick={() => void query.refetch()}>重试</button></div> : query.data.items.length ? <>
      <ul className="case-list">{query.data.items.map((item) => <CaseItem key={item.key} item={item} task={task} />)}</ul>
      <div className="case-pagination"><span>共 {query.data.total} 条</span><button type="button" className="button button--ghost button--compact" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>上一页</button><button type="button" className="button button--ghost button--compact" disabled={!query.data.hasMore} onClick={() => setOffset(offset + 20)}>下一页</button></div>
    </> : <p className="case-empty muted">{isActive(task) ? "评测完成后展示案例" : "暂无此类案例"}</p>}
  </Panel>;
}

export function CaseItem({ item, task }: { item: CaseResult; task: Task }) {
  const member = task.members.find((m) => m.participantId === item.site);
  const step = stagesOf(task, item.round).find((s) => s.id === item.step)?.label ?? item.step;
  const status = item.outcome === "passed" ? "passed" : item.outcome === "unlabeled" ? "pending" : "failed";
  return <li><details className="case-result">
    <summary><CheckStatus status={status} /><div className="case-summary"><strong>{item.itemId === "_" ? `${step}步骤` : item.itemId}</strong><span>{member?.agentName ?? member?.participant ?? (item.site === "server" ? "服务端" : item.site)}</span><p>{item.prediction ?? LABELS[item.outcome]}</p></div><span className={`case-label case-label--${item.outcome}`}>{LABELS[item.outcome]}</span><Icon name="chevron" /></summary>
    <div className="case-body">
      <ol className="case-stages" aria-label="案例结果定位">
        <li><CheckStatus status={item.outcome === "error" ? "failed" : "passed"} /><span>{step}{item.outcome === "error" ? "失败" : "完成"}</span></li>
        <li><CheckStatus status={item.outcome === "error" ? "pending" : status} /><span>{item.outcome === "passed" ? "答案匹配" : item.outcome === "incorrect" ? "答案未匹配" : item.outcome === "error" ? "未完成评测" : "未判分"}</span></li>
      </ol>
      {item.error ? <p className="field-error">{item.error}</p> : null}
      {item.fields?.length || item.input || item.prediction || item.reference ? <dl className="case-content">
        {item.fields?.map((field, index) => <div key={index}><dt>{field.label}</dt><dd>{field.text}</dd></div>)}
        {item.input ? <div><dt>输入</dt><dd>{item.input}</dd></div> : null}
        {item.prediction ? <div><dt>实际回答</dt><dd>{item.prediction}</dd></div> : null}
        {item.reference ? <div><dt>参考答案</dt><dd>{item.reference}</dd></div> : null}
      </dl> : !item.error ? <p className="muted">历史记录未保存回答详情</p> : null}
    </div>
  </details></li>;
}
