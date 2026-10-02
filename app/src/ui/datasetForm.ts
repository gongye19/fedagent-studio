/** 登记数据集的表单状态和规则，新增参与方页和新增数据集页共用；字段本身在 DatasetFields.tsx。 */
import type { ScenarioId, TaskType } from "../domain/catalog";
import type { Hosting } from "../domain/resources";
import type { JsonlCheck } from "../domain/validate";

/** 选好的文件：在浏览器里先检查一遍（和后端同一套规则），保存时把文件交给后端，后端再查一次。 */
export type FileState = { name: string; size: number; check: JsonlCheck | null; error?: string; blob?: File };

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

/** 数据集的名称：没填时用文件名。 */
export function datasetName(form: DatasetForm): string {
  return form.name.trim() || form.file?.name.replace(/\.jsonl?$/i, "") || "";
}

/**
 * 把数据集的字段写进要提交的表单。平台托管的带上文件（后端检查通过才保存）；
 * 参与方本地的只登记名称和说明，样本数等客户端连上后上报。fields 是后端接口里名称、说明两个字段的名字。
 */
export function appendDataset(data: FormData, form: DatasetForm, hosting: Hosting, fields: { name: string; description: string }): boolean {
  if (!form.scenario || !form.taskType) return false;
  data.set(fields.name, datasetName(form));
  data.set(fields.description, form.description.trim());
  data.set("scenario", form.scenario);
  data.set("taskType", form.taskType);
  if (hosting === "platform") {
    if (!form.file?.blob || !form.file.check?.ok) return false;
    data.set("file", form.file.blob, form.file.name);
  }
  return true;
}
