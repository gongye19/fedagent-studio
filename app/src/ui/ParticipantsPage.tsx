import { Fragment, useRef, useState, type Dispatch } from "react";
import { TASK_TYPES } from "../domain/catalog";
import { HOSTING_LABELS, PARTICIPANT_STATUS, type Dataset, type Hosting, type Participant } from "../domain/resources";
import { checkJsonl, MAX_FILE_BYTES, MAX_PROBLEMS, type JsonlCheck } from "../domain/validate";
import { navigate } from "../state/route";
import { datasetsOf, taskCountOf, type Action, type State } from "../state/store";
import { CodeBlock, Collapsible, Facts, FormActions, Notice, PageHead, Tag } from "./common";
import { Choices, FormRow, Panel } from "./console";
import { formatNumber } from "./format";
import { Icon } from "./icons";

type Props = { state: State; dispatch: Dispatch<Action>; selectedId?: string };

const HOSTING_HINT: Record<Hosting, string> = {
  platform: "数据集上传到平台，由平台运行这一方的 Agent；适合公开数据和演示",
  local: "数据和模型密钥留在参与方本地，参与方运行客户端，只上传交换内容；适合真实的跨机构联邦",
};

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 参与方与数据：每个参与方持有自己的数据集，由一个 Agent 代表它参加联邦任务。 */
export default function ParticipantsPage({ state, dispatch, selectedId }: Props) {
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const toggle = (id: string) => navigate(selectedId === id ? { page: "participants" } : { page: "participants", id }, { keepScroll: true });
  const participants = [...state.participants].sort((a, b) => Number(Boolean(a.builtin)) - Number(Boolean(b.builtin)));

  return (
    <>
      <PageHead
        title="参与方与数据"
        meta="每个参与方持有自己的数据集，由一个 Agent 代表它参加联邦任务。"
        actions={adding ? null : <button type="button" className="button button--primary" onClick={() => { setAdding(true); setSaved(null); }}><Icon name="plus" />新增参与方</button>}
      />

      {saved ? <Notice action={<button type="button" className="link-button" onClick={() => setSaved(null)}>知道了</button>}>{saved}</Notice> : null}

      {adding ? (
        <NewParticipant
          dispatch={dispatch}
          onDone={(created) => {
            setAdding(false);
            if (!created) return;
            setSaved(created.hosting === "local"
              ? `已添加“${created.name}”，详情里有连接命令；连上之前显示“等待连接”。`
              : `已添加“${created.name}”，新建任务时可以选它的数据集。`);
            navigate({ page: "participants", id: created.id }, { keepScroll: true });
          }}
        />
      ) : null}

      <Panel flush>
        <div className="table-shell">
          <table className="table table--rows">
            <thead>
              <tr>
                <th scope="col">参与方</th>
                <th scope="col" className="col-optional">数据集</th>
                <th scope="col" className="numeric">样本</th>
                <th scope="col" className="col-optional">运行位置</th>
                <th scope="col">状态</th>
                <th scope="col" className="numeric col-optional">参加任务</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((participant) => {
                const datasets = datasetsOf(state, participant.id);
                const open = selectedId === participant.id;
                return (
                  <Fragment key={participant.id}>
                    <tr
                      className={`row--toggle${open ? " row--open" : ""}`}
                      onClick={(event) => {
                        // 整行都能点开；点到行里的按钮时交给按钮自己处理。
                        if ((event.target as HTMLElement).closest("button, a, input, label")) return;
                        toggle(participant.id);
                      }}
                    >
                      <th scope="row">
                        <button type="button" className="row-button" aria-expanded={open} onClick={() => toggle(participant.id)}>
                          <Icon name="chevron" />
                          <span className="cell-title">
                            {participant.name}
                            {participant.org && !participant.builtin ? <span className="cell-note">{participant.org}</span> : null}
                          </span>
                        </button>
                      </th>
                      <td className="col-optional">{datasets.length ? datasets.map((dataset) => dataset.description).join("、") : "—"}</td>
                      <td className="numeric">{datasets.length ? formatNumber(datasets.reduce((sum, dataset) => sum + dataset.count, 0)) : "—"}</td>
                      <td className="col-optional">{HOSTING_LABELS[participant.hosting]}</td>
                      <td>{participant.status === "online" ? <span className="status-text">在线</span> : <Tag tone="warning">{PARTICIPANT_STATUS[participant.status]}</Tag>}</td>
                      <td className="numeric col-optional">{taskCountOf(state, participant.id)}</td>
                    </tr>
                    {open ? (
                      <tr className="detail-row">
                        <td colSpan={6}>
                          <ParticipantDetail participant={participant} datasets={datasets} dispatch={dispatch} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function ParticipantDetail({ participant, datasets, dispatch }: { participant: Participant; datasets: Dataset[]; dispatch: Dispatch<Action> }) {
  const [uploading, setUploading] = useState(false);

  function remove() {
    if (window.confirm(`删除参与方“${participant.name}”和它的数据集？已有任务里的记录不受影响。`)) {
      dispatch({ type: "removeParticipant", id: participant.id });
      navigate({ page: "participants" }, { keepScroll: true });
    }
  }

  return (
    <div className="participant-detail">
      {participant.builtin ? null : <p className="detail-lede">{participant.intro || "没有简介。"}</p>}
      {participant.hosting === "local" ? <LocalConnect /> : null}
      {datasets.map((dataset) => (
        <div key={dataset.id} className="dataset-info">
          <Facts className="facts--columns" items={[
            ["数据集", `${dataset.name} · ${dataset.description}`],
            ["任务类型", TASK_TYPES[dataset.taskType].label],
            ["样本", dataset.answered === dataset.count ? `${formatNumber(dataset.count)} 条，都有标注` : `${formatNumber(dataset.count)} 条，其中 ${formatNumber(dataset.answered)} 条有标注`],
            ["来源", dataset.source === "builtin" ? dataset.origin ?? "内置示例" : "上传"],
          ]} />
          {dataset.sample ? (
            <div className="sample-question">
              <span>样本示例</span>
              <p lang="en">{dataset.sample.question}</p>
              {dataset.sample.answer ? <p className="sample-answer" lang="en">标注：{dataset.sample.answer}</p> : null}
            </div>
          ) : null}
        </div>
      ))}
      {participant.hosting === "platform" && !participant.builtin && uploading ? (
        <DatasetForm
          participantId={participant.id}
          onCancel={() => setUploading(false)}
          onSave={(dataset) => { dispatch({ type: "addDataset", dataset }); setUploading(false); }}
        />
      ) : null}
      {participant.builtin ? null : (
        <div className="detail-actions">
          {participant.hosting === "platform" && !uploading ? (
            <button type="button" className="button button--secondary button--compact" onClick={() => setUploading(true)}><Icon name="upload" />上传数据集</button>
          ) : null}
          <button type="button" className="button button--secondary button--compact button--danger" onClick={remove}>删除参与方</button>
        </div>
      )}
    </div>
  );
}

/** 本地参与方的连接步骤，只在参与方详情里出现（令牌要保存后才有）。 */
function LocalConnect() {
  return (
    <div className="connect-steps">
      <h2 className="connect-title">在参与方的环境里连接</h2>
      <CodeBlock code={`pip install fedagent-client
fedagent-client connect \\
  --server https://<平台地址> \\
  --token <平台签发的令牌> \\
  --data ./dataset.jsonl \\
  --review`} />
      <p className="connect-foot"><Tag>客户端尚未发布</Tag>连上之前不能加入任务；加 <code>--review</code> 可以在上传前逐条确认。</p>
    </div>
  );
}

function NewParticipant({ dispatch, onDone }: { dispatch: Dispatch<Action>; onDone: (created?: Participant) => void }) {
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [intro, setIntro] = useState("");
  const [hosting, setHosting] = useState<Hosting>("platform");
  const [dataset, setDataset] = useState<Omit<Dataset, "participantId"> | null>(null);
  const missing = [
    name.trim() ? null : "名称",
    hosting === "platform" && !dataset ? "检查通过的数据集文件" : null,
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
    dispatch({ type: "addParticipant", participant, dataset: hosting === "platform" && dataset ? { ...dataset, participantId: id } : undefined });
    onDone(participant);
  }

  return (
    <Panel title="新增参与方">
      <FormRow label="名称" htmlFor="participant-name">
        <input id="participant-name" name="participant-name" autoComplete="off" className="control-wide" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="例如：某高校数学组" />
      </FormRow>
      <FormRow label="所属机构" htmlFor="participant-org" hint="可不填">
        <input id="participant-org" name="participant-org" autoComplete="off" className="control-wide" value={org} maxLength={40} onChange={(event) => setOrg(event.target.value)} />
      </FormRow>
      <FormRow label="简介" htmlFor="participant-intro" hint="可不填">
        <input id="participant-intro" name="participant-intro" autoComplete="off" className="control-full" value={intro} maxLength={120} onChange={(event) => setIntro(event.target.value)} placeholder="这个参与方的数据是什么、来自哪里…" />
      </FormRow>
      <FormRow label="运行位置" labelId="hosting-label" hint={HOSTING_HINT[hosting]}>
        <Choices labelledBy="hosting-label" value={hosting} options={[{ value: "platform", label: HOSTING_LABELS.platform }, { value: "local", label: HOSTING_LABELS.local, badge: "客户端未发布" }]} onChange={setHosting} />
      </FormRow>
      {hosting === "platform" ? <DatasetPicker onChange={setDataset} /> : null}
      <FormActions missing={missing} saveLabel="保存参与方" onCancel={() => onDone()} onSave={save} />
    </Panel>
  );
}

function DatasetForm({ participantId, onSave, onCancel }: { participantId: string; onSave: (dataset: Dataset) => void; onCancel: () => void }) {
  const [dataset, setDataset] = useState<Omit<Dataset, "participantId"> | null>(null);
  return (
    <div className="dataset-form">
      <DatasetPicker onChange={setDataset} />
      <FormActions
        compact
        missing={dataset ? [] : ["检查通过的数据集文件"]}
        saveLabel="保存数据集"
        onCancel={onCancel}
        onSave={() => dataset && onSave({ ...dataset, participantId })}
      />
    </div>
  );
}

type FileState = { name: string; size: number; check: JsonlCheck | null; error?: string };

/** 选择数据集文件并在浏览器里检查；检查通过后只保存描述（样本数、标注数、示例），不保存内容。 */
function DatasetPicker({ onChange }: { onChange: (dataset: Omit<Dataset, "participantId"> | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<FileState | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  function emit(next: FileState | null, nextTitle: string, nextDescription: string) {
    const check = next?.check;
    if (!next || !check?.ok) {
      onChange(null);
      return;
    }
    onChange({
      id: newId("ds"),
      name: nextTitle.trim() || next.name.replace(/\.jsonl?$/i, ""),
      description: nextDescription.trim() || "上传的数据集",
      taskType: "math-reasoning",
      count: check.count,
      answered: check.answered,
      source: "upload",
      sample: check.sample,
    });
  }

  async function pick(selected: File | undefined) {
    if (!selected) return;
    if (selected.size > MAX_FILE_BYTES) {
      const next = { name: selected.name, size: selected.size, check: null, error: "文件超过 20 MB，请拆分后再选择" };
      setFile(next);
      emit(next, title, description);
      return;
    }
    const check = checkJsonl(await selected.text());
    const next = { name: selected.name, size: selected.size, check };
    setFile(next);
    emit(next, title, description);
  }

  function choose() {
    // 同一个文件改好后再次选择时也要触发检查。
    if (input.current) input.current.value = "";
    input.current?.click();
  }

  const failed = file && !file.check?.ok;
  return (
    <>
      <FormRow label="任务类型" labelId="dataset-type-label">
        <Choices labelledBy="dataset-type-label" value="math-reasoning" options={[{ value: "math-reasoning", label: TASK_TYPES["math-reasoning"].label }]} onChange={() => undefined} />
      </FormRow>
      <FormRow label="数据集文件" labelId="dataset-file-label">
        <label className="upload-zone control-full">
          <input ref={input} name="dataset-file" type="file" accept=".jsonl,.json,application/json" aria-labelledby="dataset-file-label" onChange={(event) => pick(event.target.files?.[0])} />
          <Icon name="upload" />
          <strong>{file ? file.name : "选择 JSONL 文件"}</strong>
          <span>每行一条样本；不超过 20&nbsp;MB</span>
        </label>
        <Collapsible card={false} title="查看格式">
          <p>每行一个 JSON 对象，例如 <code>{`{"id": "q1", "question": "…", "answer": "…"}`}</code>；id 和 question 必填，answer 是标注，可以没有，没有的样本不计入指标。</p>
        </Collapsible>
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
      </FormRow>
      {file?.check?.ok ? (
        <>
          <FormRow label="数据集名称" htmlFor="dataset-name" hint="不填则用文件名">
            <input id="dataset-name" name="dataset-name" autoComplete="off" className="control-wide" value={title} placeholder={file.name.replace(/\.jsonl?$/i, "")} maxLength={40} onChange={(event) => { setTitle(event.target.value); emit(file, event.target.value, description); }} />
          </FormRow>
          <FormRow label="说明" htmlFor="dataset-description" hint="可不填">
            <input id="dataset-description" name="dataset-description" autoComplete="off" className="control-wide" value={description} placeholder="例如：2024 年校内竞赛题" maxLength={60} onChange={(event) => { setDescription(event.target.value); emit(file, title, event.target.value); }} />
          </FormRow>
        </>
      ) : null}
    </>
  );
}
