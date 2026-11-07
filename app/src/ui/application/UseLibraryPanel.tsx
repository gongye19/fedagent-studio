import { useState } from "react";
import { api, ApiError } from "../../api/client";
import type { components } from "../../api/schema";
import { TASK_TYPES } from "../../domain/catalog";
import { DEFAULT_ENDPOINT_ID, modelLabel, usableModelOptions } from "../../domain/resources";
import { hrefOf } from "../../state/route";
import type { Published, State } from "../../state/store";
import { SelectField } from "../SelectField";
import { Field, FieldGroup, Panel } from "../console";
import { formatNumber } from "../format";
import { Icon } from "../icons";

type RunMode = "invoke" | "compare";
type Side = { title: string; value: components["schemas"]["ApplySide"] };

/** 一次使用经验库，或对同一输入按需比较有／无经验。 */
export function UseLibraryPanel({ item, state }: { item: Published; state: State }) {
  const options = usableModelOptions(state.endpoints);
  const [chosenModel, setModel] = useState("");
  const model = options.some((option) => option.ref === chosenModel) ? chosenModel : "";
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<RunMode | null>(null);
  const busy = running !== null;
  const [result, setResult] = useState<{ sides: Side[]; input: string; answer: string; model: string } | null>(null);
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
  const missing = !model ? options.length ? "请选择模型" : "还需配置可用的模型接口" : type?.structuredInput
    ? Object.values(fieldErrors).join("；") : question.trim() ? "" : "还需填写：问题";
  const outdated = result && (snapshot !== result.input || answer.trim() !== result.answer || model !== result.model);

  async function run(mode: RunMode) {
    if (missing || busy) return;
    const submitted = { input: submittedInput, answer: answer.trim() || null, model };
    setRunning(mode);
    setProblem(null);
    setResult(null);
    try {
      const sides: Side[] = [];
      if (mode === "invoke") {
        sides.push({ title: "使用经验库", value: await api.invokeApp(item.id, submitted) });
      } else {
        const comparison = await api.applyApp(item.id, submitted);
        sides.push({ title: "不使用经验", value: comparison.without }, { title: "使用经验库", value: comparison.with });
      }
      setResult({ sides, input: snapshot, answer: submitted.answer ?? "", model: submitted.model });
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "运行失败，稍后再试");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="panel-stack">
      <Panel>
        <div className="form-body">
          <FieldGroup>
            {type?.structuredInput ? fields.map((field) => (
              <Field key={field.key} label={field.label} info={field.help || undefined} optional={!field.required} htmlFor={`try-${field.key}`} wide>
                {field.kind === "text" ? <input id={`try-${field.key}`} disabled={busy} value={values[field.key] ?? ""} maxLength={20000}
                  onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} /> :
                  <textarea id={`try-${field.key}`} disabled={busy} value={values[field.key] ?? ""} rows={field.kind === "json" ? 3 : 4} maxLength={20000}
                    placeholder={field.kind === "json" ? "{}" : undefined} aria-invalid={Boolean(values[field.key] && fieldErrors[field.key])}
                    aria-describedby={values[field.key] && fieldErrors[field.key] ? `try-${field.key}-error` : undefined}
                    onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />}
                {values[field.key] && fieldErrors[field.key] ? <p className="field-error" id={`try-${field.key}-error`}>{fieldErrors[field.key]}</p> : null}
              </Field>
            )) : <Field label={type?.inputLabel ?? "问题"} htmlFor="try-question" wide>
              <textarea id="try-question" name="question" autoComplete="off" rows={4} maxLength={20000} disabled={busy} value={question} placeholder={type?.placeholder} onChange={(event) => setQuestion(event.target.value)} />
            </Field>}
            <Field label={type?.answerLabel ?? "标准答案"} optional htmlFor="try-answer">
              <input id="try-answer" name="answer" autoComplete="off" disabled={busy} value={answer} onChange={(event) => setAnswer(event.target.value)} />
            </Field>
            <Field label="模型" htmlFor="try-model">
              <SelectField id="try-model" name="model" disabled={busy || !options.length} value={model} onValueChange={(value) => setModel(value)} onClear={() => setModel("")}>
                <option value="" disabled>{options.length ? "请选择模型" : "没有可用的模型接口"}</option>
                {options.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
              </SelectField>
              {!options.length ? <a className="text-link" href={hrefOf(state.endpoints.some((endpoint) => endpoint.id === DEFAULT_ENDPOINT_ID) ? { page: "editEndpoint", id: DEFAULT_ENDPOINT_ID } : { page: "newEndpoint" })}>去配置</a> : null}
            </Field>
          </FieldGroup>
          <div className="form-actions">
            <span className="form-status" id="try-status" aria-live="polite">{busy ? "正在回答…" : missing}</span>
            <div className="form-buttons">
              {type?.recordBased ? <button type="button" className="button button--primary" disabled={Boolean(missing) || busy}
                aria-describedby="try-status" onClick={() => void run("invoke")}>{running === "invoke" ? "正在回答…" : "使用经验回答"}</button> : null}
              <button type="button" className={`button ${type?.recordBased ? "button--secondary" : "button--primary"}`}
                disabled={Boolean(missing) || busy} aria-describedby="try-status" onClick={() => void run("compare")}>
                {running === "compare" ? "正在对比…" : "运行对比"}
              </button>
            </div>
          </div>
        </div>
      </Panel>
      {problem ? <p className="field-error" role="alert">{problem}</p> : null}
      {result ? (
        <Panel title={`${outdated ? "上次" : ""}${result.sides.length === 1 ? "回答" : "对比结果"}`} id="try-result" extra={modelLabel(result.model, state.endpoints)}>
          <details className="comparison-input">
            <summary>本次{type?.inputLabel ?? "问题"}{result.answer ? `与${type?.answerLabel ?? "标准答案"}` : ""}</summary>
            <p className="input-snapshot">{result.input}</p>
            {result.answer ? <p>{type?.answerLabel ?? "标准答案"}：{result.answer}</p> : null}
          </details>
          <div className={result.sides.length > 1 ? "compare-grid" : undefined}>
            {result.sides.map(({ title, value: side }) => (
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
