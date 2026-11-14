import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { packageEvaluations, type PackageEvaluation } from "../../api/evaluations";
import { Panel } from "../console";
import { SelectField } from "../SelectField";
import { USAGE } from "./evaluationView";

const CHANGES = { improved: "由错变对", worsened: "由对变错", unchanged: "结果不变", incomplete: "未完成配对" } as const;
type CaseFilter = keyof typeof CHANGES | "all" | "changed";
const PAGE_SIZE = 12;

export function CaseDetails({ result }: { result: PackageEvaluation }) {
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState("all");
  const [change, setChange] = useState<CaseFilter>("changed");
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ["evaluation-cases", result.id, site, change, page, result.paired],
    queryFn: ({ signal }) => packageEvaluations.cases(result.id, { site, change, offset: page * PAGE_SIZE, limit: PAGE_SIZE }, signal),
    enabled: open,
  });
  const counts = query.data?.counts ?? result.changes ?? {};
  const pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE));
  const sites = new Map(result.sites.map((entry) => [entry.id, entry]));
  const countFor = (key: CaseFilter) => key === "all" ? Object.values(counts).reduce((a, b) => a + b, 0)
    : key === "changed" ? (counts.improved ?? 0) + (counts.worsened ?? 0) : counts[key] ?? 0;

  return <Panel title="病例变化">
    <ul className="evaluation-change-summary" aria-label="病例变化汇总">
      {(Object.keys(CHANGES) as (keyof typeof CHANGES)[]).map((key) =>
        <li key={key}><strong className={"evaluation-" + key}>{result.changes?.[key] ?? 0}</strong>{CHANGES[key]}</li>)}
    </ul>
    <details className="evaluation-disclosure" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>查看病例明细</summary>
      {open && <div className="evaluation-results">
        <div className="list-toolbar">
          <SelectField name="package-evaluation-site" aria-label="筛选病例来源" value={site}
            onValueChange={(value) => { setSite(value); setPage(0); }}>
            <option value="all">全部病例来源</option>
            {result.sites.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {USAGE[entry.usage]}</option>)}
          </SelectField>
        </div>
        <div className="evaluation-filters" aria-label="筛选病例变化">
          {(["changed", "improved", "worsened", "unchanged", "incomplete", "all"] as const).map((key) =>
            <button key={key} type="button" className="button button--secondary button--compact" aria-pressed={change === key}
              onClick={() => { setChange(key); setPage(0); }}>
              {key === "all" ? "全部病例" : key === "changed" ? "有变化" : CHANGES[key]} {countFor(key)}
            </button>)}
        </div>
        {query.isPending && <p role="status" className="muted">正在读取病例…</p>}
        {query.error && <p className="field-error" role="alert">读取失败。<button type="button" className="text-link" onClick={() => void query.refetch()}>重试</button></p>}
        <div className="evaluation-cases" aria-busy={query.isFetching}>
          {query.data?.cases.map((item) => <details key={item.siteId + "/" + item.caseId} className="evaluation-case">
            <summary><span>{item.caseId} · {sites.get(item.siteId)?.name}</span>
              <strong className={"evaluation-" + item.change}>{CHANGES[item.change]}</strong></summary>
            <div className="evaluation-answers">
              {(["none", "federated"] as const).map((arm) => <article key={arm}>
                <h4>{arm === "none" ? "无经验" : "加载经验包"} · {item.arms[arm]?.correct === true ? "匹配" : item.arms[arm]?.correct === false ? "未匹配" : "未完成"}</h4>
              </article>)}
            </div>
          </details>)}
          {query.isSuccess && !query.data.cases.length && <p className="muted">没有符合条件的病例。</p>}
        </div>
        {pages > 1 && <nav className="case-pagination" aria-label="病例分页">
          <span role="status">第 {page + 1} / {pages} 页</span>
          <button type="button" className="button button--ghost button--compact" disabled={page === 0 || query.isFetching} onClick={() => setPage(page - 1)}>上一页</button>
          <button type="button" className="button button--ghost button--compact" disabled={page >= pages - 1 || query.isFetching} onClick={() => setPage(page + 1)}>下一页</button>
        </nav>}
      </div>}
    </details>
  </Panel>;
}
