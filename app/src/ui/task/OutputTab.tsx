import { useState, type Dispatch } from "react";
import { libraries, type Task } from "../../domain/task";
import { hrefOf } from "../../state/route";
import { publishedOf, type Action, type State } from "../../state/store";
import { EmptyState, Tag } from "../common";
import { Panel } from "../console";
import { formatNumber } from "../format";
import { InsightGroups } from "../InsightGroups";
import { algorithmOfTask, versionLabel } from "../labels";

/** 任务的产出：由算法决定（FoT 产出洞见库）。每轮一版，任意一版都可以发布为应用。 */
export function OutputTab({ task, state, dispatch }: { task: Task; state: State; dispatch: Dispatch<Action> }) {
  const output = algorithmOfTask(task).output;
  const versions = libraries(task);
  const [chosen, setChosen] = useState<number | null>(null);
  if (!versions.length) {
    return <EmptyState title={`还没有${output.name}`}><p>第 1 轮结束后生成第一版，之后每轮更新一次。</p></EmptyState>;
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
      name: final ? `${task.name} ${output.name}` : `${task.name} 第 ${round} 轮后${output.name}`,
      publishedAt: new Date().toISOString(),
    });
  }

  return (
    <Panel
      title={output.name}
      extra={`${current.insights.length} 条${previous ? `，新增 ${added}` : ""} · 来自 ${formatNumber(current.traceCount)} 条上传`}
      actions={(
        <>
          {versions.length > 1 ? (
            <select name="version" aria-label="版本" value={current.builtAfterRound} onChange={(event) => setChosen(Number(event.target.value))}>
              {versions.map((version) => <option key={version.builtAfterRound} value={version.builtAfterRound}>{versionLabel(task, version)}</option>)}
            </select>
          ) : null}
          {published ? (
            <>
              <Tag>已发布</Tag>
              <a className="button button--secondary button--compact" href={hrefOf({ page: "app", id: published.id })}>查看应用</a>
            </>
          ) : (
            <button type="button" className="button button--primary button--compact" onClick={publish}>发布为应用</button>
          )}
        </>
      )}
    >
      <InsightGroups insights={current.insights} isNew={previous ? (key) => !previousKeys.has(key) : undefined} />
    </Panel>
  );
}
