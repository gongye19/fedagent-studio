import { useEffect, useRef, useState, type Dispatch } from "react";
import { libraries, type Task } from "../../domain/task";
import { showFlash } from "../../state/flash";
import { hrefOf } from "../../state/route";
import { publishedOf, type Action, type State } from "../../state/store";
import { EmptyState, Tag } from "../common";
import { Panel } from "../console";
import { formatNumber } from "../format";
import { InsightGroups } from "../InsightGroups";
import { algorithmOfTask, versionLabel } from "../labels";

/** 任务的产出：由算法决定（FoT 产出经验库）。每轮一版，任意一版都可以发布为应用。 */
export function OutputTab({ task, state, dispatch }: { task: Task; state: State; dispatch: Dispatch<Action> }) {
  const output = algorithmOfTask(task).output;
  const versions = libraries(task);
  const [chosen, setChosen] = useState<number | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const isNaming = naming !== null;
  useEffect(() => {
    // 展开后直接输入名称。
    if (isNaming) nameInput.current?.select();
  }, [isNaming]);
  if (!versions.length) {
    return <EmptyState title={`还没有${output.name}`}><p>第 1 轮结束后生成第一版，之后每轮更新一次。</p></EmptyState>;
  }
  const current = versions.find((version) => version.builtAfterRound === chosen) ?? versions[versions.length - 1];
  const previous = versions.find((version) => version.builtAfterRound === current.builtAfterRound - 1);
  const previousKeys = new Set(previous?.insights.map((insight) => insight.key) ?? []);
  const added = current.insights.filter((insight) => !previousKeys.has(insight.key)).length;
  const published = publishedOf(state, task.id, current.builtAfterRound);
  const final = task.status === "completed" && current.builtAfterRound === task.config.rounds;
  const suggested = final ? `${task.name} ${output.name}` : `${task.name} 第 ${current.builtAfterRound} 轮后${output.name}`;

  function publish(name: string) {
    const round = current.builtAfterRound;
    const id = `app-${task.id}-r${round}`;
    const title = name.trim() || suggested;
    dispatch({ type: "publish", id, taskId: task.id, builtAfterRound: round, name: title, publishedAt: new Date().toISOString() });
    setNaming(null);
    showFlash({ page: "task", id: task.id }, `已发布为应用“${title}”。`, { label: "查看应用", route: { page: "app", id } });
  }

  return (
    <Panel
      title={output.name}
      extra={`${current.insights.length} 条${previous ? `，新增 ${added}` : ""} · 来自 ${formatNumber(current.traceCount)} 条上传`}
      actions={(
        <>
          {versions.length > 1 ? (
            <select name="version" aria-label="版本" value={current.builtAfterRound} onChange={(event) => { setChosen(Number(event.target.value)); setNaming(null); }}>
              {versions.map((version) => <option key={version.builtAfterRound} value={version.builtAfterRound}>{versionLabel(task, version)}</option>)}
            </select>
          ) : null}
          {published ? (
            <>
              <Tag>已发布</Tag>
              <a className="button button--secondary button--compact" href={hrefOf({ page: "app", id: published.id })}>查看应用</a>
            </>
          ) : naming === null ? (
            <button type="button" className="button button--primary button--compact" onClick={() => setNaming(suggested)}>发布为应用</button>
          ) : null}
        </>
      )}
    >
      {naming !== null && !published ? (
        <form
          className="confirm publish-form"
          aria-label="发布为应用"
          onSubmit={(event) => {
            event.preventDefault();
            publish(naming);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setNaming(null);
          }}
        >
          <div className="confirm-copy">
            <label className="field-label" htmlFor="publish-name">应用名称</label>
            <input ref={nameInput} id="publish-name" name="publish-name" autoComplete="off" value={naming} maxLength={60} onChange={(event) => setNaming(event.target.value)} />
          </div>
          <div className="confirm-actions">
            <button type="button" className="button button--secondary" onClick={() => setNaming(null)}>取消</button>
            <button type="submit" className="button button--primary">发布</button>
          </div>
        </form>
      ) : null}
      <InsightGroups insights={current.insights} isNew={previous ? (key) => !previousKeys.has(key) : undefined} />
    </Panel>
  );
}
