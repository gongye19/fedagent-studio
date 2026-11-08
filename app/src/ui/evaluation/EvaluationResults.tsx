import { useState } from "react";
import type { PackageEvaluation } from "../../api/evaluations";
import { Panel } from "../console";
import { formatDelta, formatPercent } from "../format";
import { ResourceTable } from "../resources/ResourceTable";
import { SelectField } from "../SelectField";
import { USAGE } from "./evaluationView";

const CHANGES = {
  improved: "由错变对", worsened: "由对变错", unchanged: "结果不变", incomplete: "未完成配对",
} as const;
const ARMS = [["none", "无经验"], ["federated", "加载经验包"]] as const;

export function EvaluationResults({ result }: { result: PackageEvaluation }) {
  const [site, setSite] = useState("all");
  const [change, setChange] = useState<keyof typeof CHANGES | "all">("all");
  const cases = result.cases.filter((item) => site === "all" || item.siteId === site);
  const visible = cases.filter((item) => change === "all" || item.change === change);
  const sites = new Map(result.sites.map((entry) => [entry.id, entry]));

  return <>
    <ResourceTable label="各站诊断匹配率" columns={[
      { label: "病例数据" }, { label: "病例范围" }, { label: "完成配对", className: "numeric" },
      { label: "无经验", className: "numeric" }, { label: "加载经验包", className: "numeric" },
      { label: "变化", className: "numeric" },
    ]} empty={!result.sites.length} emptyContent="暂无评测结果。">
      {result.sites.map((entry) => <tr key={entry.id}>
        <th scope="row">{entry.name}</th>
        <td data-label="病例范围">{USAGE[entry.usage]}</td>
        <td data-label="完成配对" className="numeric">{entry.paired} / {entry.total}</td>
        {ARMS.map(([arm, label]) => <td key={arm} data-label={label} className="numeric">
          {entry.paired ? <>{formatPercent(entry[arm] / entry.paired)}<small>{entry[arm]} / {entry.paired} 例</small></> : "—"}
        </td>)}
        <td data-label="变化" className="numeric">
          {entry.paired ? formatDelta((entry.federated - entry.none) / entry.paired) : "—"}
        </td>
      </tr>)}
    </ResourceTable>
    {result.cases.length ? <Panel title="病例变化">
      <div className="evaluation-results">
        <div className="list-toolbar">
          <SelectField name="package-evaluation-site" aria-label="筛选病例来源" value={site} onValueChange={setSite}>
            <option value="all">全部病例来源</option>
            {result.sites.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {USAGE[entry.usage]}</option>)}
          </SelectField>
        </div>
        <div className="evaluation-filters" aria-label="筛选病例变化">
          {(["all", "improved", "worsened", "unchanged", "incomplete"] as const).map((key) => (
            <button key={key} type="button" className="button button--secondary button--compact" aria-pressed={change === key}
              onClick={() => setChange(key)}>
              {key === "all" ? "全部病例" : CHANGES[key]} {key === "all" ? cases.length : cases.filter((item) => item.change === key).length}
            </button>
          ))}
        </div>
        <div className="evaluation-cases">
          {visible.length ? visible.map((item) => (
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
      </div>
    </Panel> : null}
  </>;
}
