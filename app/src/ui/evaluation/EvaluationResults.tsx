import { useState } from "react";
import type { PackageEvaluation } from "../../api/evaluations";
import { Panel } from "../console";
import { formatDelta, formatPercent } from "../format";
import { deltaClass } from "../labels";
import { SelectField } from "../SelectField";
import { USAGE } from "./evaluationView";

const CHANGES = {
  improved: "由错变对", worsened: "由对变错", unchanged: "结果不变", incomplete: "未完成配对",
} as const;
const ARMS = [["none", "无经验"], ["federated", "加载经验包"]] as const;
const PAGE_SIZE = 12;

export function EvaluationResults({ result }: { result: PackageEvaluation }) {
  return <>
    <Panel title="各站诊断匹配率">
      {result.sites.length ? <div className="evaluation-chart" role="group" aria-label="各站诊断匹配率柱状对比">
        {result.sites.map((entry) => {
          const delta = entry.paired ? (entry.federated - entry.none) / entry.paired : null;
          return <section key={entry.id} className="evaluation-chart-group">
            <div className="evaluation-chart-heading">
              <div>
                <h3>{entry.name}</h3>
                <p>{USAGE[entry.usage]} · 已配对 {entry.paired} / {entry.total} 例</p>
              </div>
              <strong className={deltaClass(delta)}>{delta === null ? "待评测" : formatDelta(delta)}</strong>
            </div>
            {ARMS.map(([arm, label]) => {
              const ratio = entry.paired ? entry[arm] / entry.paired : null;
              return <div key={arm} className="evaluation-chart-row">
                <span>{label}</span>
                <div className="evaluation-chart-track" aria-hidden="true">
                  {ratio !== null ? <span className={"evaluation-chart-bar evaluation-chart-bar--" + arm}
                    style={{ width: formatPercent(ratio, 3) }} /> : null}
                </div>
                <span className="evaluation-chart-value">
                  <strong>{formatPercent(ratio)}</strong>
                  {ratio !== null ? <small>{entry[arm]} / {entry.paired} 例</small> : null}
                </span>
              </div>;
            })}
            <div className="evaluation-chart-row evaluation-chart-axis" aria-hidden="true">
              <div><span>0%</span><span>50%</span><span>100%</span></div>
            </div>
          </section>;
        })}
      </div> : <p className="muted">暂无评测结果。</p>}
    </Panel>
    {result.cases.length ? <CaseDetails result={result} /> : null}
  </>;
}

type CaseFilter = keyof typeof CHANGES | "all" | "changed";

function matchesChange(change: PackageEvaluation["cases"][number]["change"], filter: CaseFilter) {
  if (filter === "all") return true;
  if (filter === "changed") return change === "improved" || change === "worsened";
  return change === filter;
}

function CaseDetails({ result }: { result: PackageEvaluation }) {
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState("all");
  const [change, setChange] = useState<CaseFilter>("changed");
  const [requestedPage, setPage] = useState(0);
  const cases = site === "all" ? result.cases : result.cases.filter((item) => item.siteId === site);
  const visible = cases.filter((item) => matchesChange(item.change, change));
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pages - 1);
  const sites = new Map(result.sites.map((entry) => [entry.id, entry]));

  return <Panel title="病例变化">
    <ul className="evaluation-change-summary" aria-label="病例变化汇总">
      {(Object.keys(CHANGES) as (keyof typeof CHANGES)[]).map((key) =>
        <li key={key}><strong className={"evaluation-" + key}>{result.cases.filter((item) => item.change === key).length}</strong>{CHANGES[key]}</li>
      )}
    </ul>
    <details className="evaluation-disclosure" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>查看病例明细</summary>
      {open ? <div className="evaluation-results">
        <div className="list-toolbar">
          <SelectField name="package-evaluation-site" aria-label="筛选病例来源" value={site}
            onValueChange={(value) => { setSite(value); setPage(0); }}>
            <option value="all">全部病例来源</option>
            {result.sites.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {USAGE[entry.usage]}</option>)}
          </SelectField>
        </div>
        <div className="evaluation-filters" aria-label="筛选病例变化">
          {(["changed", "improved", "worsened", "unchanged", "incomplete", "all"] as const).map((key) => (
            <button key={key} type="button" className="button button--secondary button--compact" aria-pressed={change === key}
              onClick={() => { setChange(key); setPage(0); }}>
              {key === "all" ? "全部病例" : key === "changed" ? "有变化" : CHANGES[key]} {cases.filter((item) => matchesChange(item.change, key)).length}
            </button>
          ))}
        </div>
        <div className="evaluation-cases">
          {visible.length ? visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((item) => (
            <details key={item.siteId + "/" + item.caseId} className="evaluation-case">
              <summary><span>{item.caseId} · {sites.get(item.siteId)?.name}</span>
                <strong className={"evaluation-" + item.change}>{CHANGES[item.change]}</strong>
              </summary>
              <div className="evaluation-answers">
                {ARMS.map(([arm, label]) => {
                  const correct = item.arms[arm]?.correct;
                  return <article key={arm}><h4>{label} · {correct === true ? "匹配" : correct === false ? "未匹配" : "未完成"}</h4></article>;
                })}
              </div>
            </details>
          )) : <p className="muted">没有符合条件的病例。</p>}
        </div>
        {pages > 1 ? <nav className="case-pagination" aria-label="病例分页">
          <span role="status">第 {page + 1} / {pages} 页</span>
          <button type="button" className="button button--ghost button--compact" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button>
          <button type="button" className="button button--ghost button--compact" disabled={page === pages - 1} onClick={() => setPage(page + 1)}>下一页</button>
        </nav> : null}
      </div> : null}
    </details>
  </Panel>;
}
