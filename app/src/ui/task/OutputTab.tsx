import { SelectField } from "../SelectField";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { outputs, type Task } from "../../domain/task";
import { publish as publishApp } from "../../state/actions";
import { showFlash } from "../../state/flash";
import { hrefOf } from "../../state/route";
import { publishedOf, type State } from "../../state/store";
import { EmptyState, Meta, Notice, Tag } from "../common";
import { Panel } from "../console";
import { formatNumber } from "../format";
import { OutputGroups } from "../OutputGroups";
import { algorithmOfTask, versionLabel } from "../labels";

/** 任务的产出：由算法决定（FoT 产出经验库）。每轮一版，任意一版都可以发布经验库。 */
export function OutputTab({ task, state }: { task: Task; state: State }) {
  const output = algorithmOfTask(task).output;
  const versions = outputs(task);
  const [chosen, setChosen] = useState<number | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const isNaming = naming !== null;
  useEffect(() => {
    // 展开后直接输入名称。
    if (isNaming) nameInput.current?.select();
  }, [isNaming]);
  if (!versions.length) {
    return <EmptyState title={`还没有${output.name}`}><p>生成后可在这里查看和发布。</p></EmptyState>;
  }
  const current = versions.find((version) => version.builtAfterRound === chosen) ?? versions[versions.length - 1];
  const previous = versions.find((version) => version.builtAfterRound === current.builtAfterRound - 1);
  const previousKeys = new Set(previous?.items.map((item) => item.key) ?? []);
  const added = current.items.filter((item) => !previousKeys.has(item.key)).length;
  const published = publishedOf(state, task.id, current.builtAfterRound);
  const final = task.status === "completed" && current.builtAfterRound === versions.at(-1)?.builtAfterRound;
  const suggested = final ? `${task.name} ${output.name}` : `${task.name} 第 ${current.builtAfterRound} 轮后${output.name}`;

  async function publish(name: string) {
    if (saving) return;
    const title = name.trim() || suggested;
    setSaving(true);
    setProblem(null);
    try {
      const app = await publishApp(task.id, current.builtAfterRound, title);
      setNaming(null);
      showFlash({ page: "task", id: task.id }, `已发布经验库“${app.name}”。`, { label: "立即试用", route: { page: "app", id: app.id } });
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "发布失败，稍后再试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title={output.name}
      extra={`${current.items.length} 条${previous ? `，新增 ${added}` : ""} · 来自 ${formatNumber(current.uploadCount)} 条上传`}
      actions={(
        <>
          {versions.length > 1 ? (
            <SelectField name="version" aria-label="版本" disabled={saving} value={current.builtAfterRound} onValueChange={(value) => { setChosen(Number(value)); setNaming(null); }}>
              {versions.map((version) => <option key={version.builtAfterRound} value={version.builtAfterRound}>{versionLabel(task, version)}</option>)}
            </SelectField>
          ) : null}
          {published ? (
            <>
              <Tag>已发布</Tag>
              <a className="button button--secondary button--compact" href={hrefOf({ page: "app", id: published.id })}>使用经验库</a>
            </>
          ) : naming === null ? (
            <button type="button" className="button button--primary button--compact" onClick={() => { setChosen(current.builtAfterRound); setNaming(suggested); }}>发布经验库</button>
          ) : null}
        </>
      )}
    >
      {naming !== null && !published ? (
        <form
          className="confirm publish-form"
          aria-label="发布经验库"
          onSubmit={(event) => {
            event.preventDefault();
            void publish(naming);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !saving) setNaming(null);
          }}
        >
          <div className="confirm-copy">
            <strong>发布经验库</strong>
            <p className="publish-source"><Meta parts={[task.name, task.evaluationLabels?.length ? "联邦经验" : `第 ${current.builtAfterRound} 轮后`, `${output.name} ${formatNumber(current.items.length)} 条`]} /></p>
            <label className="field-label" htmlFor="publish-name">经验库名称</label>
            <input ref={nameInput} id="publish-name" name="publish-name" autoComplete="off" disabled={saving} value={naming} maxLength={60} onChange={(event) => setNaming(event.target.value)} />
          </div>
          <div className="confirm-actions">
            <button type="button" className="button button--secondary" disabled={saving} onClick={() => setNaming(null)}>取消</button>
            <button type="submit" className="button button--primary" disabled={saving}>{saving ? "正在发布…" : "发布"}</button>
          </div>
        </form>
      ) : null}
      {problem ? <Notice tone="warning" onDismiss={() => setProblem(null)}>{problem}</Notice> : null}
      <OutputGroups items={current.items} isNew={previous ? (key) => !previousKeys.has(key) : undefined} />
    </Panel>
  );
}
