import { useState, type Dispatch } from "react";
import { canPickInto } from "../domain/config";
import { HOSTING_LABELS, type Hosting, type Participant } from "../domain/resources";
import { showFlash } from "../state/flash";
import { newId } from "../state/ids";
import { backTo, navigate, type From } from "../state/route";
import type { Action, State } from "../state/store";
import { FormActions, PageHead } from "./common";
import { Choices, Field, FieldGroup, Panel } from "./console";
import { DatasetFields } from "./DatasetFields";
import { buildDataset, datasetMissing, EMPTY_DATASET_FORM, type DatasetForm } from "./datasetForm";

type Props = { state: State; dispatch: Dispatch<Action>; from?: From };

/** 选了运行位置之后，这一方的数据怎么处理；两种都写，让用户知道平台能看到什么。 */
const HOSTING_ALERT: Record<Hosting, string> = {
  platform: "数据集上传到平台，由平台代这一方运行 Agent，平台能看到数据内容。",
  local: "数据和模型密钥留在参与方本地，只上传交换内容。保存后，在参与方详情里查看连接命令。",
};

/**
 * 新增参与方：和 AWS 的创建页一样是独立页面。参与方是一个机构或节点，登记时一起登记它的第一份数据集，
 * 运行位置、数据集的场景和任务类型都由用户选。以后再加数据集，在"数据集"页新增。
 * 从新建任务过来时，保存后回到新建任务；数据集和任务的场景、任务类型一致时直接选入。
 */
export default function NewParticipantPage({ state, dispatch, from }: Props) {
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [intro, setIntro] = useState("");
  const [hosting, setHosting] = useState<Hosting | null>(null);
  const [form, setForm] = useState<DatasetForm>(EMPTY_DATASET_FORM);
  const missing = [name.trim() ? null : "名称", hosting ? null : "运行位置", ...(hosting ? datasetMissing(form, hosting) : [])]
    .filter((item): item is string => Boolean(item));

  function save() {
    if (missing.length || !hosting) return;
    const id = newId("p");
    const participant: Participant = {
      id,
      name: name.trim(),
      org: org.trim(),
      intro: intro.trim(),
      hosting,
      status: hosting === "platform" ? "online" : "waiting",
    };
    const dataset = buildDataset(form, hosting, id);
    if (!dataset) return;
    dispatch({ type: "addParticipant", participant, dataset });

    if (from === "newTask") {
      const picked = canPickInto(state.draft, participant, dataset);
      if (picked) dispatch({ type: "pickDataset", participantId: id, datasetId: dataset.id });
      const back = backTo(from, { page: "participants" }, state.draft.scenario);
      showFlash(back, picked
        ? `已添加“${participant.name}”，并选入这个任务。`
        : hosting === "local"
          ? `已添加“${participant.name}”。连上客户端之后才能选入任务。`
          : `已添加“${participant.name}”。它的数据集和这个任务的场景或任务类型不同，没有选入。`);
      navigate(back);
      return;
    }
    showFlash({ page: "participants" }, hosting === "platform"
      ? `已添加“${participant.name}”和它的数据集“${dataset.name}”。`
      : `已添加“${participant.name}”，详情里有连接命令；连上之前显示“等待连接”。`);
    navigate({ page: "participants", scenario: dataset.scenario, id });
  }

  return (
    <>
      <PageHead title="新增参与方" crumbs={[{ label: "参与方与数据", route: { page: "participants" } }]} />
      <div className="form-page">
        <Panel title="基本信息">
          <div className="form-body">
            <FieldGroup>
              <Field label="名称" htmlFor="participant-name">
                <input id="participant-name" name="participant-name" autoComplete="off" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="例如：某高校实验室" />
              </Field>
              <Field label="所属机构" optional htmlFor="participant-org">
                <input id="participant-org" name="participant-org" autoComplete="off" value={org} maxLength={40} onChange={(event) => setOrg(event.target.value)} />
              </Field>
              <Field label="简介" optional htmlFor="participant-intro" wide>
                <input id="participant-intro" name="participant-intro" autoComplete="off" value={intro} maxLength={120} onChange={(event) => setIntro(event.target.value)} placeholder="这个参与方是谁、数据来自哪里…" />
              </Field>
              <Field label="运行位置" labelId="hosting-label" wide>
                <Choices labelledBy="hosting-label" value={hosting} options={[{ value: "platform", label: HOSTING_LABELS.platform }, { value: "local", label: HOSTING_LABELS.local, badge: "客户端未发布" }]} onChange={setHosting} />
              </Field>
            </FieldGroup>
            {hosting ? <p className="form-alert">{HOSTING_ALERT[hosting]}</p> : null}
          </div>
        </Panel>

        {hosting ? (
          <Panel title="数据集">
            <div className="form-body">
              <FieldGroup>
                <DatasetFields form={form} hosting={hosting} onChange={setForm} />
              </FieldGroup>
            </div>
          </Panel>
        ) : null}

        <FormActions missing={missing} saveLabel="保存参与方" onCancel={() => navigate(backTo(from, { page: "participants" }, state.draft.scenario))} onSave={save} />
      </div>
    </>
  );
}
