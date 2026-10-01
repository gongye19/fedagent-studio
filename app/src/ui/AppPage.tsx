import { useEffect, useRef, useState, type Dispatch } from "react";
import { algorithmOf, scenarioOf, TASK_TYPES } from "../domain/catalog";
import { DEFAULT_ENDPOINT_ID, DEFAULT_MODEL, isConfigured, modelLabel, modelOptions } from "../domain/resources";
import { TRY_EXAMPLE } from "../domain/sample";
import { outputs, type OutputVersion, type Task } from "../domain/task";
import { showFlash } from "../state/flash";
import { hrefOf, navigate, type AppTab } from "../state/route";
import type { Action, Published, State } from "../state/store";
import { CodeBlock, Confirm, EmptyState, Meta, PageHead, TabLinks, Tag } from "./common";
import { Field, FieldGroup, Panel } from "./console";
import { formatDate } from "./format";
import { Icon } from "./icons";
import { OutputGroups } from "./OutputGroups";

type Props = { item: Published; task: Task | undefined; state: State; dispatch: Dispatch<Action>; tab?: AppTab };

/** 导出的 JSON：条目编号 → 内容（FoT 经验库的格式）。 */
function bodyOf(version: OutputVersion): Record<string, string> {
  return Object.fromEntries(version.items.map((item) => [item.key, item.text]));
}

function exportApp(item: Published, version: OutputVersion) {
  const blob = new Blob([`${JSON.stringify(bodyOf(version), null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${item.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** 应用详情：试用、查看内容、接入方式。和原平台的"应用"页一样，选好应用、输入、运行、看结果。 */
export default function AppPage({ item, task, state, dispatch, tab }: Props) {
  const [editing, setEditing] = useState<"rename" | "unpublish" | null>(null);
  const version = task ? outputs(task).find((output) => output.builtAfterRound === item.builtAfterRound) : undefined;

  function unpublish() {
    dispatch({ type: "unpublish", id: item.id });
    showFlash({ page: "apps" }, `已撤下“${item.name}”。产出还在任务里，可以重新发布。`);
    navigate({ page: "apps" });
  }

  const manage = (
    <>
      {version ? <button type="button" className="button button--secondary" onClick={() => exportApp(item, version)}><Icon name="download" />导出 JSON</button> : null}
      <button type="button" className="button button--secondary" onClick={() => setEditing("rename")}>重命名</button>
      <button type="button" className="button button--secondary button--danger" onClick={() => setEditing("unpublish")}>撤下应用</button>
    </>
  );
  const editor = editing === "rename" ? (
    <RenameForm name={item.name} onCancel={() => setEditing(null)} onSave={(name) => {
      dispatch({ type: "renamePublished", id: item.id, name });
      setEditing(null);
      showFlash({ page: "app", id: item.id }, `已改名为“${name}”。`);
    }} />
  ) : editing === "unpublish" ? (
    <Confirm title={`撤下“${item.name}”？`} confirmLabel="撤下" onConfirm={unpublish} onCancel={() => setEditing(null)}>
      撤下后不能再试用和接入；产出还在任务里，可以重新发布。
    </Confirm>
  ) : null;

  if (!task || !version) {
    return (
      <>
        <PageHead
          title={item.name}
          crumbs={[{ label: "应用", route: { page: "apps" } }]}
          meta={<Meta parts={[scenarioOf(item.scenario).short, TASK_TYPES[item.taskType].label, algorithmOf(item.algorithm).name]} />}
          actions={editing ? null : manage}
        />
        {editor}
        <EmptyState title="来源任务已不存在"><p>演示数据重置后，之前发布的应用会失效，可以撤下。</p></EmptyState>
      </>
    );
  }
  const algorithm = algorithmOf(item.algorithm);
  const active: AppTab = tab ?? "try";

  return (
    <>
      <PageHead
        crumbs={[{ label: "应用", route: { page: "apps" } }]}
        title={item.name}
        meta={<Meta parts={[
          scenarioOf(item.scenario).short,
          TASK_TYPES[item.taskType].label,
          algorithm.name,
          `${algorithm.output.name} ${version.items.length} 条`,
          <>来源任务 <a className="text-link" href={hrefOf({ page: "task", id: task.id, tab: "output" })}>{task.name}</a></>,
          `发布于 ${formatDate(item.publishedAt)}`,
        ]} />}
        actions={editing ? null : manage}
      />
      {editor}
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
        {active === "try" ? <TryPanel task={task} version={version} state={state} /> : null}
        {active === "content" ? (
          <Panel title={algorithm.output.name} extra={`${version.items.length} 条`}>
            <OutputGroups items={version.items} />
          </Panel>
        ) : null}
        {active === "integrate" ? <IntegratePanel item={item} version={version} /> : null}
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

function TryPanel({ task, version, state }: { task: Task; version: OutputVersion; state: State }) {
  const options = modelOptions(state.endpoints);
  const [model, setModel] = useState(options[0]?.ref ?? DEFAULT_MODEL);
  const [question, setQuestion] = useState("");
  const [ran, setRan] = useState<string | null>(null);
  const type = TASK_TYPES[task.config.taskType];
  const hasExample = version.items.some((item) => item.key === TRY_EXAMPLE.item);
  const isExample = ran !== null && ran.trim() === TRY_EXAMPLE.question;
  const fillExample = () => setQuestion(TRY_EXAMPLE.question);
  const endpoint = state.endpoints.find((item) => item.id === DEFAULT_ENDPOINT_ID);

  return (
    <div className="panel-stack">
      <Panel>
        <div className="form-body">
          <FieldGroup>
            <Field label="问题" htmlFor="try-question" wide>
              <textarea id="try-question" name="question" autoComplete="off" rows={4} value={question} placeholder={type.placeholder} onChange={(event) => setQuestion(event.target.value)} />
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
            <span className="form-status" id="try-status" aria-live="polite">{question.trim() ? "" : "还需填写：问题"}</span>
            <div className="form-buttons">
              {hasExample ? <button type="button" className="button button--secondary" onClick={fillExample}>填入示例问题</button> : null}
              <button type="button" className="button button--primary" disabled={!question.trim()} aria-describedby={question.trim() ? undefined : "try-status"} onClick={() => setRan(question)}>运行对比</button>
            </div>
          </div>
        </div>
      </Panel>

      {ran !== null ? (
        isExample ? (
          <Panel title={<>对比结果<Tag tone="warning">示意</Tag></>} id="try-result" actions={<span className="section-value">标注：{TRY_EXAMPLE.answer}</span>}>
            <div className="compare-grid">
              {([["不带应用", TRY_EXAMPLE.without], ["带应用", TRY_EXAMPLE.with]] as const).map(([title, answer]) => {
                const correct = answer.boxed === TRY_EXAMPLE.answer;
                return (
                  <div key={title} className="compare-item">
                    <div className="compare-head">
                      <h3>{title}</h3>
                      <span className={correct ? "verdict verdict--right" : "verdict verdict--wrong"}>
                        <Icon name={correct ? "check" : "x"} />{correct ? "正确" : `错误（回答 ${answer.boxed}）`}
                      </span>
                    </div>
                    <p className="answer" lang="en">{answer.text}</p>
                  </div>
                );
              })}
            </div>
          </Panel>
        ) : (
          <EmptyState
            title="前端原型没有连接模型"
            action={hasExample ? <button type="button" className="button button--secondary" onClick={() => { fillExample(); setRan(TRY_EXAMPLE.question); }}>看示例问题的对比</button> : null}
          >
            <p>接入后端后，这里会并排显示两种回答。</p>
          </EmptyState>
        )
      ) : null}
    </div>
  );
}

function IntegratePanel({ item, version }: { item: Published; version: OutputVersion }) {
  const preview = JSON.stringify(Object.fromEntries(version.items.slice(0, 2).map((entry) => [entry.key, entry.text])), null, 2);
  return (
    <div className="panel-stack">
      <Panel title="导出" extra="JSON 格式，放进自己 Agent 的提示词">
        <CodeBlock wrap code={`${preview.slice(0, -2)},\n  …\n}`} copyText={`${JSON.stringify(bodyOf(version), null, 2)}\n`} copyLabel="复制完整 JSON" />
      </Panel>
      <Panel title={<>API 与命令行<Tag>规划中</Tag></>} extra="接入后端后提供">
        <div className="panel-stack panel-stack--tight">
          <CodeBlock copyable={false} code={`curl -X POST https://<平台地址>/api/v1/apps/${item.id}/run \\
  -H "Authorization: Bearer $FEDAGENT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "…", "model": "default", "compare": true}'`} />
          <CodeBlock copyable={false} code={`fedagent run --app ${item.id} --file questions.jsonl --compare`} />
        </div>
      </Panel>
    </div>
  );
}
