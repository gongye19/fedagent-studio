import { useState } from "react";
import { ApiError } from "../api/client";
import type { components } from "../api/schema";
import { TASK_TYPES, type ScenarioId, type TaskType } from "../domain/catalog";
import { createDataResource } from "../state/actions";
import { FormActions } from "./common";
import { FieldGroup } from "./console";
import { DatasetFields } from "./DatasetFields";
import { appendDataset, datasetMissing, datasetName, EMPTY_DATASET_FORM, type DatasetForm } from "./datasetForm";

type Created = components["schemas"]["DataResourceOut"];
export function DataResourceForm({
  category,
  onSaved,
  onCancel,
  onBusyChange,
}: {
  category?: { scenario: ScenarioId; taskType: TaskType };
  onSaved: (resource: Created) => void;
  onCancel: () => void;
  onBusyChange?: (value: boolean) => void;
}) {
  const hosting = "platform";
  const [form, setForm] = useState<DatasetForm>({ ...EMPTY_DATASET_FORM, ...category });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = datasetMissing(form, hosting).filter((label) => label !== "场景").map(label => label === "任务类型" ? "应用" : label);
  async function save() {
    if (missing.length || saving) return;
    const data = new FormData();
    if (!appendDataset(data, form, hosting, { name: "name", description: "description" })) return;
    if (!form.name.trim()) data.set("name", datasetName(form).slice(0, 40));
    data.set("hosting", hosting);
    setSaving(true);
    onBusyChange?.(true);
    setError(null);
    try {
      const resource = await createDataResource(data);
      onSaved(resource);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "接入失败，请重试");
    } finally {
      setSaving(false);
      onBusyChange?.(false);
    }
  }
  return (
    <div className="resource-intake">
      <p className="resource-context">{category ? `${TASK_TYPES[category.taskType].label} · ` : ""}上传后供联邦任务使用。数据名称和说明会在目录中显示。</p>
      <FieldGroup>
        <DatasetFields
          form={form}
          hosting={hosting ?? "platform"}
          onChange={setForm}
          resourceIntake
          categoryLocked={Boolean(category)}
        />
      </FieldGroup>
      <FormActions
        missing={missing}
        saving={saving}
        error={error}
        saveLabel="上传数据"
        onCancel={onCancel}
        onSave={() => void save()}
      />
    </div>
  );
}
