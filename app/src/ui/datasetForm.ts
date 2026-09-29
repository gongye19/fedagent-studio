/** 登记数据集的表单状态和规则，新增参与方页和新增数据集页共用；字段本身在 DatasetFields.tsx。 */
import type { ScenarioId, TaskType } from "../domain/catalog";
import type { Dataset, Hosting } from "../domain/resources";
import type { JsonlCheck } from "../domain/validate";
import { newId } from "../state/ids";

export type FileState = { name: string; size: number; check: JsonlCheck | null; error?: string };

/** 登记一份数据集要填的内容，由页面持有；场景和任务类型开始时都没选，由用户选。 */
export type DatasetForm = {
  scenario: ScenarioId | null;
  taskType: TaskType | null;
  file: FileState | null;
  name: string;
  description: string;
};

export const EMPTY_DATASET_FORM: DatasetForm = { scenario: null, taskType: null, file: null, name: "", description: "" };

/** 还差什么，按页面顺序。平台托管要一个检查通过的文件，参与方本地要一个名称。 */
export function datasetMissing(form: DatasetForm, hosting: Hosting): string[] {
  return [
    form.scenario ? null : "场景",
    form.taskType ? null : "任务类型",
    form.taskType && hosting === "platform" && !form.file?.check?.ok ? "检查通过的数据集文件" : null,
    form.taskType && hosting === "local" && !form.name.trim() ? "数据集名称" : null,
  ].filter((item): item is string => Boolean(item));
}

/**
 * 生成数据集。平台托管的只保存检查结果的描述（样本数、标注数、一条示例），不保存文件内容；
 * 参与方本地的只登记名称和说明，样本数等客户端连上后上报。
 */
export function buildDataset(form: DatasetForm, hosting: Hosting, participantId: string): Dataset | null {
  const { scenario, taskType } = form;
  if (!scenario || !taskType) return null;
  const description = form.description.trim();
  if (hosting === "local") {
    const name = form.name.trim();
    return name ? { id: newId("ds"), name, participantId, description, scenario, taskType, count: 0, answered: 0, source: "local" } : null;
  }
  const check = form.file?.check;
  if (!form.file || !check?.ok) return null;
  return {
    id: newId("ds"),
    name: form.name.trim() || form.file.name.replace(/\.jsonl?$/i, ""),
    participantId,
    description,
    scenario,
    taskType,
    count: check.count,
    answered: check.answered,
    source: "upload",
    sample: check.sample,
  };
}
