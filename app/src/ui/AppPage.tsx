import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { components } from "../api/schema";
import { algorithmOf, scenarioOf, TASK_TYPES } from "../domain/catalog";
import { DEFAULT_ENDPOINT_ID, DEFAULT_MODEL, isConfigured, modelLabel, modelOptions } from "../domain/resources";
import type { Task } from "../domain/task";
import { renameApp, withdrawApp } from "../state/actions";
import { showFlash } from "../state/flash";
import { hrefOf, navigate, type AppTab } from "../state/route";
import { keys } from "../state/server";
import type { Published, State } from "../state/store";
import { CodeBlock, Confirm, Meta, Notice, PageHead, TabLinks } from "./common";
import { Field, FieldGroup, Panel } from "./console";
import { formatDate, formatNumber } from "./format";
import { Icon } from "./icons";
import { OutputGroups } from "./OutputGroups";

type Props = { item: Published; task: Task | undefined; state: State; tab?: AppTab };
type Comparison = components["schemas"]["ApplyOut"];

/** 导出的 JSON：条目名 → 内容（FoT 经验库的格式，和复现器的 library_r{n}.json 一样）。 */
function bodyOf(item: Published): Record<string, string> {
  return Object.fromEntries(item.items.map((entry) => [entry.key, entry.text]));
}

/** 应用详情：试用、查看内容、接入方式。选好应用、输入、运行、看结果。 */
export default function AppPage({ item, task, state, tab }: Props) {
  const [editing, setEditing] = useState<"rename" | "unpublish" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const algorithm = algorithmOf(item.algorithm);
  const active: AppTab = tab ?? "try";

  async function run(action: () => Promise<void>) {
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "操作失败，稍后再试");
    }
  }

  const unpublish = () => run(async () => {
    await withdrawApp(item.id);
    showFlash({ page: "apps" }, `已撤下“${item.name}”。产出还在任务里，可以重新发布。`);
    navigate({ page: "apps" });
  });

  const manage = (
    <>
      <button type="button" className="button button--secondary" onClick={() => void run(() => api.exportApp(item.id))}><Icon name="download" />导出 JSON</button>
      <button type="button" className="button button--secondary" onClick={() => setEditing("rename")}>重命名</button>
      <button type="button" className="button button--secondary button--danger" onClick={() => setEditing("unpublish")}>撤下应用</button>
    </>
  );
  const editor = editing === "rename" ? (
    <RenameForm name={item.name} onCancel={() => setEditing(null)} onSave={(name) => void run(async () => {
      await renameApp(item.id, name);
      setEditing(null);
      showFlash({ page: "app", id: item.id }, `已改名为“${name}”。`);
    })} />
  ) : editing === "unpublish" ? (
    <Confirm title={`撤下“${item.name}”？`} confirmLabel="撤下" onConfirm={() => void unpublish()} onCancel={() => setEditing(null)}>
      撤下后不能再试用和接入；产出还在任务里，可以重新发布。
    </Confirm>
  ) : null;

  return (
    <>
      <PageHead
        crumbs={[{ label: "应用", route: { page: "apps" } }]}
        title={item.name}
        meta={<Meta parts={[
          scenarioOf(item.scenario).short,
          TASK_TYPES[item.taskType]?.label ?? item.taskType,
          algorithm.name,
          `${algorithm.output.name} ${item.items.length} 条`,
          task ? <>来源任务 <a className="text-link" href={hrefOf({ page: "task", id: task.id, tab: "output" })}>{task.name}</a></> : "来源任务已删除",
          `发布于 ${formatDate(item.publishedAt)}`,
        ]} />}
        actions={editing ? null : manage}
      />
      {editor}
      {problem ? <Notice tone="warning" onDismiss={() => setProblem(null)}>{problem}</Notice> : null}
      <TabLinks
        label="应用"
        tabs={[
          { id: "try", label: "试用" },
          { id: "content", label: "内容" },
          { id: "integrate", label: "接入" },
        ]}
        active={active}
        routeOf={(id) => ({ page: "app", id: item.id, tab: id })}
      />
      <div className="tab-panel">
        {active === "try" ? <TryPanel item={item} state={state} /> : null}
        {active === "content" ? (
          <Panel title={algorithm.output.name} extra={`${item.items.length} 条`}>
            <OutputGroups items={item.items} />
          </Panel>
        ) : null}
        {active === "integrate" ? <IntegratePanel item={item} /> : null}
      </div>
    </>
  );
}

/** 重命名：在页面标题下方展开一行，和发布时填名称的样式一样。 */
function RenameForm({ name, onSave, onCancel }: { name: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.select();
  }, []);
  return (
    <form
      className="confirm publish-form"
      aria-label="重命名应用"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSave(value.trim());
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className="confirm-copy">
        <label className="field-label" htmlFor="app-name">应用名称</label>
        <input ref={input} id="app-name" name="app-name" autoComplete="off" value={value} maxLength={60} onChange={(event) => setValue(event.target.value)} />
      </div>
      <div className="confirm-actions">
        <button type="button" className="button button--secondary" onClick={onCancel}>取消</button>
        <button type="submit" className="button button--primary" disabled={!value.trim()}>保存</button>
      </div>
    </form>
  );
}

/** 试用：同一个问题分别"不带应用""带应用"各问一次，并排对比；填了标准答案时自动判分。 */
function TryPanel({ item, state }: { item: Published; state: State }) {
  const options = modelOptions(state.endpoints);
  const [model, setModel] = useState(options[0]?.ref ?? DEFAULT_MODEL);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ comparison: Comparison; answer: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const type = TASK_TYPES[item.taskType];
  const endpoint = state.endpoints.find((entry) => entry.id === DEFAULT_ENDPOINT_ID);
  const missing = question.trim() ? "" : "还需填写：问题";

  async function compare() {
    setRunning(true);
    setProblem(null);
    try {
      const comparison = await api.applyApp(item.id, { input: question.trim(), answer: answer.trim() || null, model });
      setResult({ comparison, answer: answer.trim() });
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "运行失败，稍后再试");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="panel-stack">
      <Panel>
        <div className="form-body">
          <FieldGroup>
            <Field label="问题" htmlFor="try-question" wide>
              <textarea id="try-question" name="question" autoComplete="off" rows={4} value={question} placeholder={type?.placeholder} onChange={(event) => setQuestion(event.target.value)} />
            </Field>
            <Field label="标准答案" optional htmlFor="try-answer">
              <input id="try-answer" name="answer" autoComplete="off" value={answer} onChange={(event) => setAnswer(event.target.value)} />
            </Field>
            {options.length > 1 ? (
              <Field label="模型" htmlFor="try-model">
                <select id="try-model" name="model" value={model} onChange={(event) => setModel(event.target.value)}>
                  {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="模型">
                <p className="field-static">
                  <span>{modelLabel(DEFAULT_MODEL, state.endpoints)}</span>
                  {endpoint && !isConfigured(endpoint) ? <a className="text-link" href={hrefOf({ page: "editEndpoint", id: endpoint.id })}>去配置</a> : null}
                </p>
              </Field>
            )}
          </FieldGroup>
          <div className="form-actions">
            <span className="form-status" id="try-status" aria-live="polite">{running ? "正在运行，两次调用需要一些时间…" : missing}</span>
            <div className="form-buttons">
              <button type="button" className="button button--primary" disabled={!question.trim() || running} aria-describedby="try-status" onClick={() => void compare()}>运行对比</button>
            </div>
          </div>
        </div>
      </Panel>
      {problem ? <Notice tone="warning" onDismiss={() => setProblem(null)}>{problem}</Notice> : null}
      {result ? (
        <Panel title="对比结果" id="try-result" actions={result.answer ? <span className="section-value">标准答案：{result.answer}</span> : undefined}>
          <div className="compare-grid">
            {([["不带应用", result.comparison.without], ["带应用", result.comparison.with]] as const).map(([title, side]) => (
              <div key={title} className="compare-item">
                <div className="compare-head">
                  <h3>{title}</h3>
                  {side.correct === null ? (
                    <span className="section-meta">{formatNumber(side.tokens)} token</span>
                  ) : (
                    <span className={side.correct ? "verdict verdict--right" : "verdict verdict--wrong"}>
                      <Icon name={side.correct ? "check" : "x"} />{side.correct ? "正确" : "错误"}
                    </span>
                  )}
                </div>
                <p className="answer" lang="en">{side.output}</p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function IntegratePanel({ item }: { item: Published }) {
  const body = bodyOf(item);
  const preview = JSON.stringify(Object.fromEntries(Object.entries(body).slice(0, 2)), null, 2);
  const origin = window.location.origin;
  // 平台开了访问令牌才需要带令牌
  const meta = useQuery({ queryKey: keys.meta, queryFn: api.meta, staleTime: 60_000 });
  const auth = meta.data?.authRequired ? `  -H "Authorization: Bearer <访问令牌>" \\\n` : "";
  return (
    <div className="panel-stack">
      <Panel title="导出" extra="JSON 格式，放进自己 Agent 的提示词">
        <CodeBlock wrap code={`${preview.slice(0, -2)},\n  …\n}`} copyText={`${JSON.stringify(body, null, 2)}\n`} copyLabel="复制完整 JSON" />
      </Panel>
      <Panel title="API" extra="带应用、不带应用各回答一次；给了标准答案时一起判分">
        <CodeBlock code={`curl -X POST ${origin}/v1/apps/${item.id}/apply \\
${auth}  -H "Content-Type: application/json" \\
  -d '{"input": "…", "model": "default"}'`} />
      </Panel>
    </div>
  );
}
