import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DATASETS, PARTICIPANTS } from "../../test/fixtures";
import type { Dataset } from "../../domain/resources";
import { DEFAULT_DRAFT } from "../../domain/config";
import { ParticipantTable } from "../task-config/DataSelection";
import { DatasetFields } from "../DatasetFields";
import { EMPTY_DATASET_FORM } from "../datasetForm";
import { DataResources } from "./DataResources";

const data: Dataset = { ...DATASETS[0], id: "own-records", name: "站点记录", source: "upload", resourceSpace: "workspace",
  taskType: "medical-records", schemaVersion: "process-record/1.0", description: "不应在目录展开的说明", count: 54, answered: 54 };

it("shows useful data columns without expandable implementation metadata or duplicate source fields", () => {
  const html = renderToStaticMarkup(<DataResources datasets={[data]} />);
  for (const label of ["数据名称", "任务类型", "样本数", "操作"]) expect(html).toContain(label);
  expect(html).not.toContain("数据来源");
  expect(html).toContain("医疗问诊");
  for (const text of ["process-record/1.0", data.description, "已标注", "数据格式", "参考答案", "aria-expanded", "detail-row"]) expect(html).not.toContain(text);
  const cells = [...html.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)];
  expect(cells.at(-1)?.[1]).toContain('aria-label="删除数据“站点记录”"');
  expect(html).not.toContain('class="row-button"');
});
it("keeps provider-managed data read-only and retains columns in the empty state", () => {
  const html = renderToStaticMarkup(<DataResources datasets={[{...data,resourceSpace:"public"}]} />);
  expect(html).toContain("只读");
  expect(html).not.toContain("删除数据");
  const empty = renderToStaticMarkup(<DataResources datasets={[]} />);
  expect(empty).toContain("还没有数据");
  expect(empty).toContain("操作");
});

it("does not collect unused notes in ordinary upload while preserving legacy client settings", () => {
  const form = {...EMPTY_DATASET_FORM, scenario:"horizontal", taskType:"medical-records"};
  const html = renderToStaticMarkup(<DatasetFields form={form} hosting="platform" resourceIntake categoryLocked onChange={() => {}} />);
  expect(html).toContain('name="dataset-file"');
  expect(html).toContain('name="dataset-name"');
  expect(html).not.toContain('name="dataset-description"');
  const legacy = renderToStaticMarkup(<DatasetFields form={form} hosting="local" categoryLocked onChange={() => {}} />);
  expect(legacy).toContain('name="dataset-description"');
});

it("keeps task data selection focused on records unless storage locations actually differ", () => {
  const candidates = [{participant: {...PARTICIPANTS[0], hosting:"platform" as const},datasets:[data]}];
  const html = renderToStaticMarkup(<ParticipantTable candidates={candidates} draft={DEFAULT_DRAFT} dispatch={() => {}} />);
  expect(html).not.toContain("存放位置");
  expect(html).not.toContain("平台存储");
  const mixed = [...candidates, {participant:{...PARTICIPANTS[1],hosting:"local" as const}, datasets:[{...data,id:"local"}]}];
  expect(renderToStaticMarkup(<ParticipantTable candidates={mixed} draft={DEFAULT_DRAFT} dispatch={() => {}} />)).toContain("存放位置");
});

it("preserves the connection instructions for legacy local data without expanding the catalogue", () => {
  for (const ready of [false, true]) {
    const html = renderToStaticMarkup(<DataResources datasets={[{...data, source:"local", ready}]} />);
    expect(html).toContain('href="#/participants/own-records"');
    expect(html).toContain("站点记录：连接管理");
    expect(html.includes("待连接")).toBe(!ready);
    expect(html).not.toContain("aria-expanded");
  }
});

it("distinguishes same-named records from different sources only when needed", () => {
  const candidates = PARTICIPANTS.slice(0, 2).map((participant) => ({participant, datasets:[{...data, id:participant.id}]}));
  const html = renderToStaticMarkup(<ParticipantTable candidates={candidates} draft={DEFAULT_DRAFT} dispatch={() => {}} />);
  for (const participant of PARTICIPANTS.slice(0, 2)) expect(html).toContain(`${participant.name} 的来源说明`);
  expect(html).not.toContain("存放位置");
});
