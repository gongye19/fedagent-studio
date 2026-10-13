import { useState } from "react";
import { ApiError } from "../api/client";
import type { components } from "../api/schema";
import { TASK_TYPES, type ScenarioId, type TaskType } from "../domain/catalog";
import { HOSTING_LABELS, type Hosting } from "../domain/resources";
import { createDataResource } from "../state/actions";
import type { State } from "../state/store";
import { FormActions } from "./common";
import { Choices, Field, FieldGroup } from "./console";
import { DatasetFields } from "./DatasetFields";
import { appendDataset, datasetMissing, datasetName, EMPTY_DATASET_FORM, type DatasetForm } from "./datasetForm";
import { LocalConnect } from "./ParticipantsPage";
import { SelectField } from "./SelectField";

type Created = components["schemas"]["DataResourceOut"];
export function DataResourceForm({ state, category, onSaved, onCancel, onBusyChange }: {
  state: State; category?: { scenario: ScenarioId; taskType: TaskType };
  onSaved: (resource: Created) => void; onCancel: () => void;
  onBusyChange?: (value: boolean) => void;
}) {
  const [hosting, setHosting] = useState<Hosting | null>(null);
  const [sourceId, setSourceId] = useState("__new");
  const [form, setForm] = useState<DatasetForm>({ ...EMPTY_DATASET_FORM, ...category });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<Created | null>(null);
  const sources = state.participants.filter(p => !p.builtin && (!hosting || p.hosting === hosting));
  const missing = [...(!hosting ? ["运行位置"] : []), ...datasetMissing(form, hosting ?? "platform").filter(label => label !== "场景")];
  async function save() {
    if (!hosting || missing.length || saving) return;
    const data = new FormData();
    if (!appendDataset(data, form, hosting, { name: "name", description: "description" })) return;
    if (!form.name.trim()) data.set("name", datasetName(form).slice(0,40));
    data.set("hosting", hosting);if (sourceId !== "__new") data.set("sourceId", sourceId);
    setSaving(true);onBusyChange?.(true);setError(null);
    try {const resource = await createDataResource(data);
      if (hosting === "local") setLocal(resource);else onSaved(resource);
    } catch (failure) {setError(failure instanceof ApiError ? failure.message : "接入失败，请重试");}
    finally {setSaving(false);onBusyChange?.(false);}
  }
  if (local) return <div className="panel-stack">
    <p>已保存“{local.dataset.name}”。连接客户端后，上报实际样本并检查算法版本。</p>
    <LocalConnect participantId={local.source.id} datasetIds={[...new Set([...state.datasets.filter(d => d.participantId === local.source.id).map(d => d.id),local.dataset.id])]} />
    <button type="button" className="button button--primary" onClick={() => onSaved(local)}>完成接入</button>
  </div>;
  return <div className="resource-intake">
    {category ? <p className="resource-context">{TASK_TYPES[category.taskType].label} · 上传后保存到我的资源</p> : null}
    <FieldGroup>
      <Field label="运行位置" labelId="resource-hosting-label" info="平台运行会把文件保存到当前工作区；本地客户端保留原始数据和模型密钥，只提交算法声明的交换内容。" wide>
        <Choices labelledBy="resource-hosting-label" value={hosting} options={[{value:"platform",label:HOSTING_LABELS.platform},{value:"local",label:HOSTING_LABELS.local}]}
          onChange={value => {setHosting(value);setSourceId("__new");setForm(f => ({...f,file:null}));}} />
      </Field>
      <DatasetFields form={form} hosting={hosting ?? "platform"} onChange={setForm} resourceIntake categoryLocked={Boolean(category)} disabled={!hosting} />
      <Field label="数据来源" htmlFor="resource-source" info="每个来源代表一个执行节点或逻辑数据分组，同一来源的多份文件在任务中只选一份。平台运行的分组不代表独立机构。" wide>
        <SelectField id="resource-source" name="resource-source" value={sourceId} disabled={!hosting} onValueChange={setSourceId}>
          <option value="__new">新建数据来源</option>{sources.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
      </Field>
    </FieldGroup>
    <FormActions missing={missing} saving={saving} error={error} saveLabel="保存数据" onCancel={onCancel} onSave={() => void save()} />
  </div>;
}
