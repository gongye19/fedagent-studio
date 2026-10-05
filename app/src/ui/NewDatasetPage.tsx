import { useState, type Dispatch } from "react";
import { ApiError } from "../api/client";
import { canPickInto } from "../domain/config";
import { HOSTING_LABELS } from "../domain/resources";
import { createDataset } from "../state/actions";
import { showFlash } from "../state/flash";
import { backTo, navigate, type From } from "../state/route";
import { participantOf, type Action, type State } from "../state/store";
import { FormActions, PageHead } from "./common";
import { Field, FieldGroup, Panel } from "./console";
import { DatasetFields } from "./DatasetFields";
import { appendDataset, datasetMissing, EMPTY_DATASET_FORM, type DatasetForm } from "./datasetForm";

type Props = { state: State; dispatch: Dispatch<Action>; participant?: string; from?: From };

/**
 * 新增数据集：先选属于哪个参与方，再选场景、任务类型，然后上传文件（平台托管）或登记名称（参与方本地）。
 * 每一步都由用户选；从参与方详情进来时预先选好这个参与方。
 */
export default function NewDatasetPage({ state, dispatch, participant, from }: Props) {
  const [ownerId, setOwnerId] = useState(() => (participant && participantOf(state, participant) ? participant : ""));
  const [form, setForm] = useState<DatasetForm>(EMPTY_DATASET_FORM);
  const owner = participantOf(state, ownerId);
  const missing = owner ? datasetMissing(form, owner.hosting) : ["参与方"];

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!owner || missing.length || saving) return;
    const data = new FormData();
    data.set("participantId", owner.id);
    if (!appendDataset(data, form, owner.hosting, { name: "name", description: "description" })) return;
    setSaving(true);
    setError(null);
    try {
      const dataset = await createDataset(data);
      if (from === "newTask") {
        const picked = canPickInto(state.draft, owner, dataset);
        if (picked) dispatch({ type: "pickDataset", participantId: owner.id, datasetId: dataset.id });
        const back = backTo(from, { page: "participants" }, state.draft.scenario);
        showFlash(back, picked
          ? `已为“${owner.name}”添加数据集“${dataset.name}”，并选入这个任务。`
          : `已为“${owner.name}”添加数据集“${dataset.name}”。`);
        navigate(back);
        return;
      }
      showFlash({ page: "participants" }, `已为“${owner.name}”添加数据集“${dataset.name}”。`);
      navigate({ page: "participants", scenario: dataset.scenario, id: owner.id });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "保存失败，稍后再试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHead title="新增数据集" crumbs={[{ label: "参与方与数据", route: { page: "participants" } }]} />
      <div className="form-page">
        <Panel title="数据集">
          <div className="form-body">
            <FieldGroup>
              <Field label="参与方" htmlFor="dataset-owner">
                <select
                  id="dataset-owner"
                  name="dataset-owner"
                  value={ownerId}
                  onChange={(event) => {
                    setOwnerId(event.target.value);
                    // 换了参与方，运行位置可能不同，要填的内容也不同，从头再选。
                    setForm(EMPTY_DATASET_FORM);
                  }}
                >
                  <option value="" disabled>选择参与方</option>
                  {state.participants.map((item) => (
                    <option key={item.id} value={item.id}>{item.hosting === "local" ? `${item.name}（${HOSTING_LABELS.local}）` : item.name}</option>
                  ))}
                </select>
              </Field>
              {owner ? <DatasetFields key={owner.id} form={form} hosting={owner.hosting} onChange={setForm} /> : null}
            </FieldGroup>
          </div>
        </Panel>

        <FormActions missing={missing} saving={saving} error={error} saveLabel="保存数据集" onCancel={() => navigate(backTo(from, { page: "participants" }, state.draft.scenario))} onSave={() => void save()} />
      </div>
    </>
  );
}
