import { SelectField } from "./SelectField";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { components } from "../api/schema";
import { algorithmOf, scenarioOf, TASK_TYPES } from "../domain/catalog";
import { DEFAULT_ENDPOINT_ID, modelLabel, usableModelOptions } from "../domain/resources";
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
import { useContentMotion } from "./hooks";

type Props = { item: Published; task: Task | undefined; state: State; tab?: AppTab };
type Comparison = components["schemas"]["ApplyOut"];

/** 应用详情：试用、查看内容、接入方式。选好应用、输入、运行、看结果。 */
export default function AppPage({ item, task, state, tab }: Props) {
  const [editing, setEditing] = useState<"rename" | "unpublish" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const algorithm = algorithmOf(item.algorithm);
  const active: AppTab = tab ?? "try";
  const panelMotion = useContentMotion(active, true);

  async function run(action: () => Promise<void>) {
    if (managing) return;
    setManaging(true);
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "操作失败，稍后再试");
    } finally {
      setManaging(false);
    }
  }

  const unpublish = async () => {
    await withdrawApp(item.id);
    showFlash({ page: "apps" }, `已撤下“${item.name}”。${task ? "产出还在任务里，可以重新发布。" : "来源任务已删除。"}`);
    navigate({ page: "apps" });
  };

  const manage = (
    <>
      <button type="button" className="button button--secondary" disabled={managing} onClick={() => void run(() => api.exportApp(item.id))}><Icon name="download" />导出 JSON</button>
      <button type="button" className="button button--secondary" disabled={managing} onClick={() => setEditing("rename")}>重命名</button>
      <button type="button" className="button button--secondary button--danger" disabled={managing} onClick={() => { setProblem(null); setEditing("unpublish"); }}>撤下应用</button>
    </>
  );
  const editor = editing === "rename" ? (
    <RenameForm name={item.name} saving={managing} onCancel={() => setEditing(null)} onSave={(name) => void run(async () => {
      await renameApp(item.id, name);
      setEditing(null);
      showFlash({ page: "app", id: item.id }, `已改名为“${name}”。`);
    })} />
  ) : editing === "unpublish" ? (
    <Confirm title={`撤下“${item.name}”？`} confirmLabel="撤下" onConfirm={unpublish} onCancel={() => setEditing(null)}>
      {task ? "撤下后不能再试用和接入；产出还在任务里，可以重新发布。" : "来源任务已删除，撤下后无法从原任务重新发布。请先导出需要保留的内容。"}
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
        actions={editing === "rename" ? null : manage}
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
      <div className="tab-panel" ref={panelMotion}>
        {active === "try" ? <TryPanel key={item.id} item={item} state={state} /> : null}
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
function RenameForm({ name, saving, onSave, onCancel }: { name: string; saving: boolean; onSave: (name: string) => void; onCancel: () => void }) {
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
        if (value.trim() && !saving) onSave(value.trim());
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) onCancel();
      }}
    >
      <div className="confirm-copy">
        <label className="field-label" htmlFor="app-name">应用名称</label>
        <input ref={input} id="app-name" name="app-name" autoComplete="off" disabled={saving} value={value} maxLength={60} onChange={(event) => setValue(event.target.value)} />
      </div>
      <div className="confirm-actions">
        <button type="button" className="button button--secondary" disabled={saving} onClick={onCancel}>取消</button>
        <button type="submit" className="button button--primary" disabled={!value.trim() || saving}>{saving ? "正在保存…" : "保存"}</button>
      </div>
    </form>
  );
}

/** 试用：同一个问题分别"不带应用""带应用"各问一次，并排对比；填了标准答案时自动判分。 */
function TryPanel({ item, state }: { item: Published; state: State }) {
  const options = usableModelOptions(state.endpoints);
  const [chosenModel, setModel] = useState(options[0]?.ref ?? "");
  const model = options.some((option) => option.ref === chosenModel) ? chosenModel : options[0]?.ref ?? "";
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ comparison: Comparison; input: string; answer: string; model: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const type = TASK_TYPES[item.taskType];
  const fields = type?.inputFields ?? [];
  const fieldErrors: Record<string, string> = {};
  const structured: Record<string, unknown> = {};
  if (type?.structuredInput) {
    for (const field of fields) {
      const raw = values[field.key]?.trim() ?? "";
      if (field.required && !raw) fieldErrors[field.key] = `请填写${field.label}`;
      if (field.kind === "json" && raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
          structured[field.key] = parsed;
        } catch { fieldErrors[field.key] = "请填写合法的 JSON 对象"; }
      } else if (raw) structured[field.key] = raw;
    }
  }
  const submittedInput = type?.structuredInput ? structured : question.trim();
  const snapshot = typeof submittedInput === "string" ? submittedInput : JSON.stringify(submittedInput, null, 2);
  const missing = !model ? "还需配置可用的模型接口" : type?.structuredInput
    ? Object.values(fieldErrors).join("；") : question.trim() ? "" : "还需填写：问题";
  const outdated = result && (snapshot !== result.input || answer.trim() !== result.answer || model !== result.model);

  async function compare() {
    if (missing || running) return;
    const submitted = { input: submittedInput, answer: answer.trim() || null, model };
    setRunning(true);
    setProblem(null);
    setResult(null);
    try {
      const comparison = await api.applyApp(item.id, submitted);
      setResult({ comparison, input: snapshot, answer: submitted.answer ?? "", model: submitted.model });
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
            {type?.structuredInput ? fields.map((field) => (
              <Field key={field.key} label={field.label} info={field.help || undefined} optional={!field.required} htmlFor={`try-${field.key}`} wide>
                {field.kind === "text" ? <input id={`try-${field.key}`} disabled={running} value={values[field.key] ?? ""} maxLength={20000}
                  onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} /> :
                  <textarea id={`try-${field.key}`} disabled={running} value={values[field.key] ?? ""} rows={field.kind === "json" ? 3 : 4} maxLength={20000}
                    placeholder={field.kind === "json" ? "{}" : undefined} aria-invalid={Boolean(values[field.key] && fieldErrors[field.key])}
                    aria-describedby={values[field.key] && fieldErrors[field.key] ? `try-${field.key}-error` : undefined}
                    onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />}
                {values[field.key] && fieldErrors[field.key] ? <p className="field-error" id={`try-${field.key}-error`}>{fieldErrors[field.key]}</p> : null}
              </Field>
            )) : <Field label={type?.inputLabel ?? "问题"} htmlFor="try-question" wide>
              <textarea id="try-question" name="question" autoComplete="off" rows={4} maxLength={20000} disabled={running} value={question} placeholder={type?.placeholder} onChange={(event) => setQuestion(event.target.value)} />
            </Field>}
            <Field label={type?.answerLabel ?? "标准答案"} optional htmlFor="try-answer">
              <input id="try-answer" name="answer" autoComplete="off" disabled={running} value={answer} onChange={(event) => setAnswer(event.target.value)} />
            </Field>
            <Field label="模型" htmlFor="try-model">
              <SelectField id="try-model" name="model" disabled={running || !options.length} value={model} onValueChange={(value) => setModel(value)}>
                {!options.length ? <option value="" disabled>没有可用的模型接口</option> : null}
                {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
              </SelectField>
              {!model ? <a className="text-link" href={hrefOf(state.endpoints.some((endpoint) => endpoint.id === DEFAULT_ENDPOINT_ID) ? { page: "editEndpoint", id: DEFAULT_ENDPOINT_ID } : { page: "newEndpoint" })}>去配置</a> : null}
            </Field>
          </FieldGroup>
          <div className="form-actions">
            <span className="form-status" id="try-status" aria-live="polite">{running ? "正在运行，两次调用需要一些时间…" : missing}</span>
            <div className="form-buttons">
              <button type="button" className="button button--primary" disabled={Boolean(missing) || running} aria-describedby="try-status" onClick={() => void compare()}>{running ? "正在运行…" : "运行对比"}</button>
            </div>
          </div>
        </div>
      </Panel>
      {problem ? <p className="field-error" role="alert">{problem}</p> : null}
      {result ? (
        <Panel title={outdated ? "上次对比结果" : "对比结果"} id="try-result" extra={modelLabel(result.model, state.endpoints)}>
          <details className="comparison-input">
            <summary>本次{type?.inputLabel ?? "问题"}{result.answer ? `与${type?.answerLabel ?? "标准答案"}` : ""}</summary>
            <p className="input-snapshot">{result.input}</p>
            {result.answer ? <p>{type?.answerLabel ?? "标准答案"}：{result.answer}</p> : null}
          </details>
          <div className="compare-grid">
            {([["不带应用", result.comparison.without], ["带应用", result.comparison.with]] as const).map(([title, side]) => (
              <div key={title} className="compare-item">
                <div className="compare-head">
                  <h3>{title}</h3>
                  {side.correct === null ? (
                    <span className="section-meta">未判分</span>
                  ) : (
                    <span className={side.correct ? "verdict verdict--right" : "verdict verdict--wrong"}>
                      <Icon name={side.correct ? "check" : "x"} />{side.correct ? "正确" : "错误"}
                    </span>
                  )}
                </div>
                <p className="answer" lang="en">{side.output}</p>
                <span className="compare-usage">{formatNumber(side.tokens)} token</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function IntegratePanel({ item }: { item: Published }) {
  const exported = useQuery({ queryKey: ["app-export", item.id], queryFn: () => api.appContent(item.id) });
  const body = exported.data;
  const full = body ? JSON.stringify(body, null, 2) : "";
  const lines = full.split("\n");
  const preview = lines.slice(0, 24).join("\n") + (lines.length > 24 ? "\n…" : "");
  const type = TASK_TYPES[item.taskType];
  const input = type?.structuredInput ? Object.fromEntries((type.inputFields ?? []).map((field) => [field.key, field.kind === "json" ? {} : "…"])) : "…";
  const payload = JSON.stringify({ input, model: "default" });
  const origin = window.location.origin;
  // 平台开了访问令牌才需要带令牌
  const meta = useQuery({ queryKey: keys.meta, queryFn: api.meta, staleTime: 60_000 });
  const auth = meta.data?.authRequired ? `  -H "Authorization: Bearer <访问令牌>" \\\n` : "";
  return (
    <div className="panel-stack">
      <Panel title="导出" extra="算法定义的 JSON 格式">
        {exported.isPending ? <p>正在读取产出…</p> : exported.isError ? <p role="alert">读取失败。<button type="button" className="text-link" onClick={() => void exported.refetch()}>重试</button></p> :
          <CodeBlock wrap code={preview} copyText={`${full}\n`} copyLabel="复制完整 JSON" />}
      </Panel>
      <Panel title="API" extra="单次运行已发布成果">
        <CodeBlock code={`curl -X POST ${origin}/v1/apps/${item.id}/invoke \\
${auth}  -H "Content-Type: application/json" \\
  -d '${payload}'`} />
      </Panel>
    </div>
  );
}
