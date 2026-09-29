import { useState, type Dispatch } from "react";
import { DEFAULT_TASK_TYPE, TASK_TYPES } from "../domain/catalog";
import { HOSTING_LABELS, type Dataset, type Hosting, type Participant } from "../domain/resources";
import { showFlash } from "../state/flash";
import { newId } from "../state/ids";
import { backTo, navigate, type From } from "../state/route";
import type { Action } from "../state/store";
import { FormActions, PageHead } from "./common";
import { Choices, Field, FieldGroup, Panel } from "./console";
import { DatasetPicker } from "./DatasetPicker";

type Props = { dispatch: Dispatch<Action>; from?: From };

/** 选了运行位置之后，这一方的数据怎么处理；两种都写，让用户知道平台能看到什么。 */
const HOSTING_ALERT: Record<Hosting, string> = {
  platform: "数据集上传到平台，由平台代这一方运行 Agent，平台能看到数据内容。",
  local: "数据和模型密钥留在参与方本地，只上传交换内容。保存后，在参与方详情里查看连接命令。",
};

/**
 * 新增参与方：和 AWS 的创建页一样是独立页面。从新建任务过来时，保存后回到新建任务，
 * 平台托管的数据集直接选入任务；本地参与方要连上客户端之后才能选。
 */
export default function NewParticipantPage({ dispatch, from }: Props) {
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [intro, setIntro] = useState("");
  const [hosting, setHosting] = useState<Hosting>("platform");
  const [upload, setUpload] = useState<Omit<Dataset, "participantId"> | null>(null);
  const [localName, setLocalName] = useState("");
  const [localDescription, setLocalDescription] = useState("");
  const missing = [
    name.trim() ? null : "名称",
    hosting === "platform" && !upload ? "检查通过的数据集文件" : null,
    hosting === "local" && !localName.trim() ? "数据集名称" : null,
  ].filter((item): item is string => Boolean(item));

  function save() {
    if (missing.length) return;
    const id = newId("p");
    const participant: Participant = {
      id,
      name: name.trim(),
      org: org.trim(),
      intro: intro.trim(),
      hosting,
      status: hosting === "platform" ? "online" : "waiting",
    };
    const dataset: Dataset = hosting === "platform" && upload
      ? { ...upload, participantId: id }
      : {
        id: newId("ds"),
        name: localName.trim(),
        participantId: id,
        description: localDescription.trim(),
        taskType: DEFAULT_TASK_TYPE,
        count: 0,
        answered: 0,
        source: "local",
      };
    dispatch({ type: "addParticipant", participant, dataset });

    if (from === "newTask") {
      if (hosting === "platform") dispatch({ type: "toggleDataset", datasetId: dataset.id });
      showFlash({ page: "newTask" }, hosting === "platform"
        ? `已添加“${participant.name}”，并选入这个任务。`
        : `已添加“${participant.name}”。连上客户端之后才能选入任务。`);
      navigate({ page: "newTask" });
      return;
    }
    showFlash({ page: "participants" }, hosting === "platform"
      ? `已添加“${participant.name}”，新建任务时可以选它的数据集。`
      : `已添加“${participant.name}”，详情里有连接命令；连上之前显示“等待连接”。`);
    navigate({ page: "participants", id });
  }

  return (
    <>
      <PageHead title="新增参与方" crumbs={[{ label: "参与方与数据", route: { page: "participants" } }]} />
      <div className="form-page">
        <Panel title="基本信息">
          <div className="form-body">
            <FieldGroup>
              <Field label="名称" htmlFor="participant-name">
                <input id="participant-name" name="participant-name" autoComplete="off" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="例如：某高校数学组" />
              </Field>
              <Field label="所属机构" optional htmlFor="participant-org">
                <input id="participant-org" name="participant-org" autoComplete="off" value={org} maxLength={40} onChange={(event) => setOrg(event.target.value)} />
              </Field>
              <Field label="简介" optional htmlFor="participant-intro" wide>
                <input id="participant-intro" name="participant-intro" autoComplete="off" value={intro} maxLength={120} onChange={(event) => setIntro(event.target.value)} placeholder="这个参与方的数据是什么、来自哪里…" />
              </Field>
              <Field label="运行位置" labelId="hosting-label" wide>
                <Choices labelledBy="hosting-label" value={hosting} options={[{ value: "platform", label: HOSTING_LABELS.platform }, { value: "local", label: HOSTING_LABELS.local, badge: "客户端未发布" }]} onChange={setHosting} />
              </Field>
            </FieldGroup>
            <p className="form-alert">{HOSTING_ALERT[hosting]}</p>
          </div>
        </Panel>

        <Panel title="数据集">
          <div className="form-body">
            {hosting === "platform" ? <DatasetPicker onChange={setUpload} /> : (
              <FieldGroup>
                <Field label="任务类型">
                  <p className="field-static">{TASK_TYPES[DEFAULT_TASK_TYPE].label}</p>
                </Field>
                <Field label="数据集名称" htmlFor="local-dataset-name">
                  <input id="local-dataset-name" name="local-dataset-name" autoComplete="off" value={localName} maxLength={40} onChange={(event) => setLocalName(event.target.value)} placeholder="例如：校内竞赛题库" />
                </Field>
                <Field label="说明" optional htmlFor="local-dataset-description">
                  <input id="local-dataset-description" name="local-dataset-description" autoComplete="off" value={localDescription} maxLength={60} onChange={(event) => setLocalDescription(event.target.value)} placeholder="例如：2024 年校内竞赛题" />
                </Field>
              </FieldGroup>
            )}
          </div>
        </Panel>

        <FormActions missing={missing} saveLabel="保存参与方" onCancel={() => navigate(backTo(from, { page: "participants" }))} onSave={save} />
      </div>
    </>
  );
}
