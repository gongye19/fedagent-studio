import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ALGORITHMS, SCENARIOS, TASK_TYPES, taskTypesFor } from "../domain/catalog";
import type { Hosting } from "../domain/resources";
import { MAX_FILE_BYTES, MAX_PROBLEMS } from "../domain/validate";
import { api, ApiError } from "../api/client";
import { Choices, Field } from "./console";
import type { DatasetForm } from "./datasetForm";
import { formatNumber } from "./format";
import { Icon } from "./icons";
import { CheckStatus } from "./CheckStatus";

/**
 * 数据集的登记字段：场景 → 任务类型 → 平台托管时选文件并在浏览器里检查，参与方本地时只填名称和说明。
 * 只列出这个场景里有算法能处理的任务类型；规划中的场景不能选。新增参与方页和新增数据集页共用。
 */
export function DatasetFields({ form, hosting, onChange, resourceIntake = false, categoryLocked = false, disabled = false }: {
  form: DatasetForm; hosting: Hosting; onChange: Dispatch<SetStateAction<DatasetForm>>;
  resourceIntake?: boolean; categoryLocked?: boolean; disabled?: boolean;
}) {
  // 同一页可能有别的表单，id 不能写死。
  const uid = useId();
  const ids = { scenario: `${uid}-scenario`, type: `${uid}-type`, file: `${uid}-file`, format: `${uid}-format`, name: `${uid}-name`, description: `${uid}-description` };
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  useEffect(() => {
    selection.current += 1;
    pending.current?.abort();
    return () => { selection.current += 1; pending.current?.abort(); };
  }, [hosting, form.scenario, form.taskType]);
  const types = resourceIntake ? Object.keys(TASK_TYPES).filter(type => TASK_TYPES[type].recordBased) : form.scenario ? taskTypesFor(form.scenario) : [];
  const type = form.taskType ? TASK_TYPES[form.taskType] : null;
  const file = form.file;
  const failed = file && !file.checking && !file.check?.ok;

  async function pick(selected: File | undefined) {
    if (!selected) return;
    const version = ++selection.current;
    pending.current?.abort();
    if (selected.size > MAX_FILE_BYTES) {
      onChange((current) => ({ ...current, file: { name: selected.name, size: selected.size, check: null, error: "文件超过 20 MB，请拆分后再选择" } }));
      return;
    }
    onChange((current) => ({ ...current, file: { name: selected.name, size: selected.size, check: null, checking: true } }));
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(await selected.arrayBuffer());
      if (selection.current !== version) return;
      if (!form.taskType) return;
      const controller = new AbortController();
      pending.current = controller;
      const check = await api.checkDataset(form.taskType, selected, controller.signal);
      if (selection.current !== version) return;
      onChange((current) => ({ ...current, file: { name: selected.name, size: selected.size, check, blob: selected } }));
    } catch (error) {
      if (selection.current !== version) return;
      onChange((current) => ({ ...current, file: { name: selected.name, size: selected.size, check: null,
        blob: error instanceof ApiError ? selected : undefined,
        error: error instanceof ApiError ? error.message : "无法读取 UTF-8 文本，请检查文件编码后重新选择" } }));
    }
  }

  function choose() {
    // 同一个文件改好后再次选择时也要触发检查。
    if (input.current) input.current.value = "";
    input.current?.click();
  }

  async function downloadTemplate() {
    if (!form.taskType || downloading) return;
    const version = selection.current;
    setDownloading(true);
    setTemplateError(null);
    try { await api.downloadTemplate(form.taskType); }
    catch (error) {
      if (selection.current === version) setTemplateError(error instanceof ApiError ? error.message : "模板下载失败，请重试");
    } finally { setDownloading(false); }
  }

  return (
    <>
      {!resourceIntake ? <Field label="场景" labelId={ids.scenario} wide>
        <Choices
          labelledBy={ids.scenario}
          value={form.scenario}
          options={SCENARIOS.map((item) => ({ value: item.id, label: item.short, disabled: item.status !== "available", badge: item.status === "available" ? undefined : "规划中" }))}
          // 换了场景，任务类型要重新选。
          onChange={(scenario) => onChange((current) => (current.scenario === scenario ? current : { ...current, scenario, taskType: null, file: null }))}
        />
      </Field> : null}
      {!categoryLocked && (form.scenario || resourceIntake) ? (
        <Field label={resourceIntake ? "应用" : "任务类型"} labelId={ids.type} wide>
          {types.length ? (
            <Choices labelledBy={ids.type} value={form.taskType} options={types.map((item) => ({ value: item, label: TASK_TYPES[item].label }))} placeholder="更多类型" onChange={(taskType) => onChange((current) => current.taskType === taskType ? current : {
              ...current, taskType, file: null, scenario: resourceIntake ? ALGORITHMS.find(a => a.accepts.includes(taskType))?.scenario ?? null : current.scenario,
            })} />
          ) : <p className="field-static">这个场景还没有可用的任务类型。</p>}
          {type && hosting === "local" ? <><button type="button" className="text-link" disabled={downloading} onClick={() => void downloadTemplate()}>{downloading ? "正在下载…" : "下载数据模板"}</button>
            {templateError ? <p className="field-error" role="alert">{templateError}</p> : null}</> : null}
        </Field>
      ) : null}

      {(type || resourceIntake) && hosting === "platform" ? (
        <Field label={type?.recordBased ? "过程记录" : "数据文件"} labelId={ids.file} info={type ? <>每行一条 <code>{type.format}</code>。{type.unlabeledNote}。文件不超过 20 MB。</> : undefined} wide>
          <label className="upload-zone">
            <input ref={input} name="dataset-file" type="file" disabled={!type || disabled} accept=".jsonl,.json,application/json" aria-labelledby={ids.file} aria-describedby={ids.format} onChange={(event) => pick(event.target.files?.[0])} />
            <Icon name="upload" />
            <strong>{file ? file.name : "选择 JSONL 文件"}</strong>
            <span id={ids.format}>{type ? `JSONL · ${type.label} · 最多 20 MB` : "先选择应用"}</span>
          </label>
          <button type="button" className="text-link" disabled={!type || downloading} onClick={() => void downloadTemplate()}>{downloading ? "正在下载…" : "下载数据模板"}</button>
          {templateError ? <p className="field-error" role="alert">{templateError}</p> : null}
          {file ? (
            <div className={`check-result${failed ? " check-result--failed" : " check-result--ok"}`} aria-live="polite">
              {file.checking ? <p><CheckStatus status="running" />{file.name}</p> : null}
              {file.error ? <p><Icon name="x" />{file.error}</p> : null}
              {file.check?.ok ? (
                <p><CheckStatus status="passed" />{formatNumber(file.check.count)} 条样本 · {formatNumber(file.check.answered)} 条标注</p>
              ) : null}
              {file.check && !file.check.ok ? (
                <>
                  <p><Icon name="x" />有 {file.check.problemCount} 处问题{file.check.count ? `（另有 ${file.check.count} 条合格）` : ""}{file.check.problemCount > MAX_PROBLEMS ? `，下面只列前 ${MAX_PROBLEMS} 处` : ""}：</p>
                  <ul>
                    {file.check.problems.map((problem) => (
                      <li key={`${problem.line}-${problem.message}`}>{problem.line ? `第 ${problem.line} 行：` : ""}{problem.message}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {failed ? <button type="button" className="button button--secondary button--compact check-retry"
                onClick={file.error && file.blob ? () => void pick(file.blob) : choose}>
                {file.error && file.blob ? "重试校验" : "改好后重新选择文件"}</button> : null}
            </div>
          ) : null}
        </Field>
      ) : null}

      {categoryLocked && hosting === "local" && type ? <Field label="数据模板" wide>
        <button type="button" className="text-link" disabled={downloading} onClick={() => void downloadTemplate()}>{downloading ? "正在下载…" : "下载数据模板"}</button>
        {templateError ? <p className="field-error" role="alert">{templateError}</p> : null}
      </Field> : null}
      {resourceIntake || type && (hosting === "local" || file?.check?.ok) ? (
        <>
          <Field label="数据集名称" optional={hosting === "platform"} htmlFor={ids.name}>
            <input
              id={ids.name}
              name="dataset-name"
              autoComplete="off"
              value={form.name}
              placeholder={file?.check?.ok ? file.name.replace(/\.jsonl?$/i, "") : hosting === "platform" ? "留空使用文件名" : "填写数据名称"}
              maxLength={40}
              onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
            />
          </Field>
          <Field label="说明" optional htmlFor={ids.description}>
            <input id={ids.description} name="dataset-description" autoComplete="off" value={form.description} placeholder="记录数据用途或来源" maxLength={60} onChange={(event) => onChange((current) => ({ ...current, description: event.target.value }))} />
          </Field>
        </>
      ) : null}
    </>
  );
}
