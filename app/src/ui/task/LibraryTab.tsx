import { useState, type Dispatch } from "react";
import { libraries, type Task } from "../../domain/task";
import { hrefOf } from "../../state/route";
import { publishedOf, type Action, type State } from "../../state/store";
import { Badge, EmptyState, Panel, SampleNote, Segmented } from "../common";
import { formatNumber } from "../format";
import { versionLabel } from "../labels";

export function LibraryTab({ task, state, dispatch }: { task: Task; state: State; dispatch: Dispatch<Action> }) {
  const versions = libraries(task);
  const [chosen, setChosen] = useState<number | null>(null);
  if (!versions.length) {
    return <EmptyState title="还没有洞见库">第 1 轮的服务端步骤完成后生成第一版，之后每轮更新一次。</EmptyState>;
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

  return (
    <div className="stack">
      <SampleNote>洞见的文字是英文，因为 FoT 的提示词是英文，真实输出也是英文。</SampleNote>
      <div className="library-toolbar">
        <Segmented
          label="洞见库版本"
          options={versions.map((version) => ({ id: String(version.builtAfterRound), label: versionLabel(task, version) }))}
          value={String(current.builtAfterRound)}
          onChange={(value) => setChosen(Number(value))}
        />
        {published ? (
          <a className="button button--secondary" href={hrefOf({ page: "library", id: published.id })}>已发布 · 查看</a>
        ) : (
          <button type="button" className="button button--primary" onClick={publish}>发布这一版</button>
        )}
      </div>

      <dl className="facts facts--row">
        <div><dt>洞见</dt><dd>{current.insights.length} 条{previous ? `（新增 ${added}）` : ""}</dd></div>
        <div><dt>来自</dt><dd>{formatNumber(current.traceCount)} 条 trace · {task.members.length} 个参与方</dd></div>
        <div><dt>关系分析</dt><dd>{current.clusters.length} 类 · {formatNumber(current.relationships)} 条关系</dd></div>
        <div><dt>用于</dt><dd>{final ? "发布后可在其他任务或自己的 Agent 里使用" : `第 ${current.builtAfterRound + 1} 轮的解题`}</dd></div>
      </dl>

      <Panel title="洞见" id="insights" flush>
        <ol className="insight-list">
          {current.insights.map((insight) => (
            <li key={insight.key}>
              <div className="insight-head">
                <code>{insight.key}</code>
                <Badge>{insight.category}</Badge>
                {previous && !previousKeys.has(insight.key) ? <Badge tone="accent">新增</Badge> : null}
              </div>
              <p lang="en">{insight.text}</p>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="关系分析：trace 分成了哪些类，来自哪些参与方" id="clusters" flush>
        <div className="table-wrap">
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
                    <th scope="row">{cluster.name}</th>
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
        <p className="panel-foot">每条 trace 只归入一类。洞见由服务端按类别提炼，与单条 trace 没有一一对应关系。</p>
      </Panel>
    </div>
  );
}
