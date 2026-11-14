import type { PackageEvaluation } from "../../api/evaluations";
import { Panel } from "../console";
import { formatDelta, formatPercent } from "../format";
import { deltaClass } from "../labels";
import { CaseDetails } from "./CaseDetails";
import { USAGE } from "./evaluationView";

const ARMS = [["none", "无经验"], ["federated", "加载经验包"]] as const;


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
    {result.status !== "queued" && result.status !== "running" ? <CaseDetails result={result} /> : null}
  </>;
}
