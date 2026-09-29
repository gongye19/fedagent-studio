import { useId, useRef, type Dispatch, type SetStateAction } from "react";
import { SCENARIOS, TASK_TYPES, taskTypesFor } from "../domain/catalog";
import type { Hosting } from "../domain/resources";
import { checkJsonl, MAX_FILE_BYTES, MAX_PROBLEMS } from "../domain/validate";
import { Choices, Field } from "./console";
import type { DatasetForm } from "./datasetForm";
import { formatNumber } from "./format";
import { Icon } from "./icons";

/**
 * 数据集的登记字段：场景 → 任务类型 → 平台托管时选文件并在浏览器里检查，参与方本地时只填名称和说明。
 * 只列出这个场景里有算法能处理的任务类型；规划中的场景不能选。新增参与方页和新增数据集页共用。
 */
export function DatasetFields({ form, hosting, onChange }: { form: DatasetForm; hosting: Hosting; onChange: Dispatch<SetStateAction<DatasetForm>> }) {
  // 同一页可能有别的表单，id 不能写死。
  const uid = useId();
  const ids = { scenario: `${uid}-scenario`, type: `${uid}-type`, file: `${uid}-file`, format: `${uid}-format`, name: `${uid}-name`, description: `${uid}-description` };
  const input = useRef<HTMLInputElement>(null);
  const types = form.scenario ? taskTypesFor(form.scenario) : [];
  const type = form.taskType ? TASK_TYPES[form.taskType] : null;
  const file = form.file;
  const failed = file && !file.check?.ok;

  async function pick(selected: File | undefined) {
    if (!selected) return;
    if (selected.size > MAX_FILE_BYTES) {
      onChange((current) => ({ ...current, file: { name: selected.name, size: selected.size, check: null, error: "文件超过 20 MB，请拆分后再选择" } }));
      return;
    }
    const check = checkJsonl(await selected.text());
    // 读文件期间用户可能改了别的字段，只更新文件这一项。
    onChange((current) => ({ ...current, file: { name: selected.name, size: selected.size, check } }));
  }

  function choose() {
    // 同一个文件改好后再次选择时也要触发检查。
    if (input.current) input.current.value = "";
    input.current?.click();
  }

  return (
    <>
      <Field label="场景" labelId={ids.scenario} wide>
        <Choices
          labelledBy={ids.scenario}
          value={form.scenario}
          options={SCENARIOS.map((item) => ({ value: item.id, label: item.short, disabled: item.status !== "available", badge: item.status === "available" ? undefined : "规划中" }))}
          // 换了场景，任务类型要重新选。
          onChange={(scenario) => onChange((current) => (current.scenario === scenario ? current : { ...current, scenario, taskType: null }))}
        />
      </Field>
      {form.scenario ? (
        <Field label="任务类型" labelId={ids.type} wide>
          {types.length ? (
            <Choices labelledBy={ids.type} value={form.taskType} options={types.map((item) => ({ value: item, label: TASK_TYPES[item].label }))} placeholder="更多类型" onChange={(taskType) => onChange((current) => ({ ...current, taskType }))} />
          ) : <p className="field-static">这个场景还没有可用的任务类型。</p>}
        </Field>
      ) : null}

      {type && hosting === "platform" ? (
        <Field label="数据集文件" labelId={ids.file} wide>
          <label className="upload-zone">
            <input ref={input} name="dataset-file" type="file" accept=".jsonl,.json,application/json" aria-labelledby={ids.file} aria-describedby={ids.format} onChange={(event) => pick(event.target.files?.[0])} />
            <Icon name="upload" />
            <strong>{file ? file.name : "选择 JSONL 文件"}</strong>
            <span id={ids.format}>每行一条 <code>{type.format}</code>；{type.unlabeledNote}；不超过 20&nbsp;MB</span>
          </label>
          {file ? (
            <div className={`check-result${failed ? " check-result--failed" : " check-result--ok"}`} aria-live="polite">
              {file.error ? <p><Icon name="x" />{file.error}</p> : null}
              {file.check?.ok ? (
                <p><Icon name="check" />检查通过：{formatNumber(file.check.count)} 条样本，其中 {formatNumber(file.check.answered)} 条有标注。</p>
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
              {failed ? <button type="button" className="button button--secondary button--compact check-retry" onClick={choose}>改好后重新选择文件</button> : null}
            </div>
          ) : null}
        </Field>
      ) : null}

      {type && (hosting === "local" || file?.check?.ok) ? (
        <>
          <Field label="数据集名称" optional={hosting === "platform"} htmlFor={ids.name}>
            <input
              id={ids.name}
              name="dataset-name"
              autoComplete="off"
              value={form.name}
              placeholder={file?.check?.ok ? file.name.replace(/\.jsonl?$/i, "") : "例如：内部评测集"}
              maxLength={40}
              onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
            />
          </Field>
          <Field label="说明" optional htmlFor={ids.description}>
            <input id={ids.description} name="dataset-description" autoComplete="off" value={form.description} placeholder="例如：2024 年收集的样本" maxLength={60} onChange={(event) => onChange((current) => ({ ...current, description: event.target.value }))} />
          </Field>
        </>
      ) : null}
    </>
  );
}
