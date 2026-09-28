import { useState, type Dispatch } from "react";
import { libraries, type Task } from "../../domain/task";
import { hrefOf } from "../../state/route";
import { publishedOf, type Action, type State } from "../../state/store";
import { EmptyState, Section, Segmented } from "../common";
import { formatNumber } from "../format";
import { InsightGroups } from "../InsightGroups";
import { versionLabel } from "../labels";

export function LibraryTab({ task, state, dispatch }: { task: Task; state: State; dispatch: Dispatch<Action> }) {
  const versions = libraries(task);
  const [chosen, setChosen] = useState<number | null>(null);
  if (!versions.length) {
    return <EmptyState title="还没有洞见库"><p>第 1 轮的服务端步骤完成后生成第一版，之后每轮更新一次。</p></EmptyState>;
  }
  const current = versions.find((version) => version.builtAfterRound === chosen) ?? versions[versions.length - 1];
  const previous = versions.find((version) => version.builtAfterRound === current.builtAfterRound - 1);
  const previousKeys = new Set(previous?.insights.map((insight) => insight.key) ?? []);
  const added = current.insights.filter((insight) => !previousKeys.has(insight.key)).length;
  const published = publishedOf(state, task.id, current.builtAfterRound);
  const final = task.status === "completed" && current.builtAfterRound === task.config.rounds;

  function publish() {
    const round = current.builtAfterRound;
    dispatch({
      type: "publish",
      id: `lib-${task.id}-r${round}`,
      taskId: task.id,
      builtAfterRound: round,
      name: final ? `${task.name} · 洞见库` : `${task.name} · 第 ${round} 轮后`,
      publishedAt: new Date().toISOString(),
    });
  }

  const summary = [
    `${current.insights.length} 条洞见${previous ? `（新增 ${added}）` : ""}`,
    `来自 ${formatNumber(current.traceCount)} 条 trace`,
    `${current.clusters.length} 类 · ${formatNumber(current.relationships)} 条关系`,
    final ? "最终版" : `供第 ${current.builtAfterRound + 1} 轮使用`,
  ].join(" · ");

  return (
    <div className="stack stack--loose">
      <div className="toolbar">
        {versions.length > 1 ? (
          <Segmented
            label="洞见库版本"
            options={versions.map((version) => ({ id: String(version.builtAfterRound), label: versionLabel(task, version) }))}
            value={String(current.builtAfterRound)}
            onChange={(value) => setChosen(Number(value))}
          />
        ) : <span />}
        {published ? (
          <a className="button button--secondary" href={hrefOf({ page: "library", id: published.id })}>已发布，去查看</a>
        ) : (
          <button type="button" className="button button--primary" onClick={publish}>发布这一版</button>
        )}
      </div>

      <Section title="洞见" id="insights" meta={summary}>
        <InsightGroups insights={current.insights} isNew={previous ? (key) => !previousKeys.has(key) : undefined} />
      </Section>

      <Section title="关系分析" id="clusters" meta="每条 trace 只归入一类；洞见由服务端按类别提炼，不和单条 trace 一一对应。">
        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">类别</th>
                <th scope="col" className="numeric">trace 数</th>
                <th scope="col">来自</th>
              </tr>
            </thead>
            <tbody>
              {current.clusters.map((cluster) => {
                const total = Object.values(cluster.traces).reduce((sum, value) => sum + value, 0);
                const sources = task.members
                  .map((member) => ({ name: member.participant, count: cluster.traces[member.datasetId] ?? 0 }))
                  .filter((item) => item.count > 0)
                  .sort((a, b) => b.count - a.count);
                return (
                  <tr key={cluster.name}>
                    <th scope="row" className="nowrap">{cluster.name}</th>
                    <td className="numeric">{formatNumber(total)}</td>
                    <td>
                      <ul className="chips">
                        {sources.map((source) => <li key={source.name}>{source.name}<span>{source.count}</span></li>)}
                      </ul>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
