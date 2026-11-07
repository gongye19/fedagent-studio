import { useState } from "react";
import type { EvaluationSource } from "../../api/consultation";
import { availableResource, usableModelOptions } from "../../domain/resources";
import type { Task } from "../../domain/task";
import type { State } from "../../state/store";
import { hrefOf } from "../../state/route";
import { Field, FieldGroup } from "../console";
import { SelectField } from "../SelectField";

type Selection = { datasetId?: string; file?: File; limit?: string };

export function ExperienceEvaluationForm({ task, state, busy, onStart, onClose }: {
  task: Task;
  state: State;
  busy: boolean;
  onStart: (body: { model: string; sources: EvaluationSource[] }) => Promise<void>;
  onClose: () => void;
}) {
  const datasets = state.datasets.filter((item) => item.taskType === "medical-diagnosis" && item.ready &&
    item.source !== "local" && item.answered > 0 && availableResource(item));
  const models = usableModelOptions(state.endpoints);
  const [model, setModel] = useState("");
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState("");
  const disabled = busy || reading;
  function change(site: string, patch: Selection) {
    setSelections((old) => ({ ...old, [site]: { ...old[site], ...patch } }));
  }

  async function submit() {
    if (disabled || !model) return;
    setProblem("");
    setReading(true);
    try {
      const sources: EvaluationSource[] = [];
      for (const site of task.members) {
        const choice = selections[site.participantId];
        if (!choice?.file && !choice?.datasetId) {
          setProblem(`请为「${site.participant}」选择病例数据。`);
          return;
        }
        if (choice.file) {
          if (choice.file.size > 1_000_000) {
            setProblem(`「${site.participant}」的病例文件不能超过 1 MB。`);
            return;
          }
          sources.push({ siteId: site.participantId, jsonl: await choice.file.text(), limit: 50 });
        } else {
          sources.push({ siteId: site.participantId, datasetId: choice.datasetId, limit: Number(choice.limit ?? 5) });
        }
      }
      await onStart({ model, sources });
    } catch {
      setProblem("无法读取病例文件，请重新选择。");
    } finally {
      setReading(false);
    }
  }

  return (
    <form className="evaluation-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p>为每个来源选择带参考诊断的留出病例。三组使用同一个模型和同一批病例。</p>
      <FieldGroup>
        <Field label="评测模型" htmlFor="eval-model">
          <SelectField id="eval-model" name="eval-model" aria-label="评测模型" value={model} onValueChange={setModel} disabled={disabled || !models.length}>
            <option value="" disabled>选择模型</option>
            {models.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}
          </SelectField>
          {!models.length ? <a className="text-link" href={hrefOf({ page: "models" })}>配置模型接口</a> : null}
        </Field>
        {task.members.map((site) => {
          const id = site.participantId;
          const choice = selections[id];
          return (
            <fieldset key={id} className="evaluation-source" disabled={disabled}>
              <legend>{site.participant}</legend>
              {datasets.length ? <SelectField name={`eval-data-${id}`} aria-label={`${site.participant}的病例数据`}
                value={choice?.datasetId ?? ""} onValueChange={(datasetId) => change(id, { datasetId, file: undefined })}>
                <option value="" disabled>选择已有评测病例</option>
                {datasets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </SelectField> : null}
              {choice?.datasetId ? <label className="evaluation-limit">最多病例数
                <input type="number" min={1} max={50} value={choice.limit ?? "5"} required
                  onChange={(event) => change(id, { limit: event.target.value })} />
              </label> : null}
              <label className="evaluation-file">
                {datasets.length ? "或上传 JSONL" : "上传病例 JSONL"}
                <input key={choice?.datasetId ?? ""} type="file" accept=".jsonl,.json,application/json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) change(id, { file, datasetId: undefined });
                  }} />
              </label>
              {choice?.file ? <small className="muted">{choice.file.name}</small> : null}
            </fieldset>
          );
        })}
      </FieldGroup>
      <details className="muted">
        <summary>病例文件格式</summary>
        <p>JSONL 每行一例，字段为 id、patient、objective、answer（参考诊断），可附 examination 和 tests。每个来源最多 50 例，整项最多 100 例。</p>
      </details>
      <p className="muted">每例运行三次问诊回答，另有本站经验生成及判分调用。</p>
      {problem ? <p className="field-error" role="alert">{problem}</p> : null}
      <div className="detail-actions">
        <button type="submit" className="button button--primary" disabled={!model || disabled}>{disabled ? "正在提交…" : "开始评测"}</button>
        <button type="button" className="button button--secondary" onClick={onClose} disabled={disabled}>收起配置</button>
      </div>
    </form>
  );
}
