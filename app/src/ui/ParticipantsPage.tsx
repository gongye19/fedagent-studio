import { Fragment, useState, type Dispatch } from "react";
import { HOSTING_LABELS, PARTICIPANT_STATUS, type Dataset, type Hosting, type Participant } from "../domain/resources";
import { checkJsonl, MAX_FILE_BYTES, type JsonlCheck } from "../domain/validate";
import { hrefOf, navigate } from "../state/route";
import { datasetsOf, taskCountOf, type Action, type State } from "../state/store";
import { Badge, PageHead, Panel, StatusPill, type Tone } from "./common";
import { formatNumber } from "./format";
import { Icon } from "./icons";

type Props = { state: State; dispatch: Dispatch<Action>; selectedId?: string };

const STATUS_TONE: Record<Participant["status"], Tone> = { online: "success", offline: "neutral", waiting: "warning" };

const HOSTING_DETAIL: Record<Hosting, { where: string; uploads: string; fits: string }> = {
  platform: {
    where: "题库上传到平台，由平台运行这个参与方的 Agent",
    uploads: "平台能看到题库；服务端步骤仍然只用 trace",
    fits: "公开数据、演示、算法验证",
  },
  local: {
    where: "题库和模型密钥留在参与方自己的环境，由参与方运行客户端",
    uploads: "只有 trace 离开参与方，上传前可以先审查",
    fits: "真实的跨机构联邦",
  },
};

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export default function ParticipantsPage({ state, dispatch, selectedId }: Props) {
  const [adding, setAdding] = useState(false);
  const toggle = (id: string) => navigate(selectedId === id ? { page: "participants" } : { page: "participants", id }, { keepScroll: true });

  return (
    <>
      <PageHead
        title="参与方与数据"
        meta="每个参与方持有自己的题库，由一个 Agent 代表它参加联邦任务。"
        actions={adding ? null : <button type="button" className="button button--primary" onClick={() => setAdding(true)}><Icon name="plus" />新增参与方</button>}
      />

      <div className="hosting-grid" aria-label="两种运行位置">
        {(["platform", "local"] as const).map((hosting) => (
          <div key={hosting} className="hosting-card">
            <strong>{HOSTING_LABELS[hosting]}</strong>
            <dl>
              <div><dt>运行</dt><dd>{HOSTING_DETAIL[hosting].where}</dd></div>
              <div><dt>数据</dt><dd>{HOSTING_DETAIL[hosting].uploads}</dd></div>
              <div><dt>适合</dt><dd>{HOSTING_DETAIL[hosting].fits}</dd></div>
            </dl>
          </div>
        ))}
      </div>

      {adding ? <NewParticipant dispatch={dispatch} onDone={(id) => { setAdding(false); if (id) navigate({ page: "participants", id }, { keepScroll: true }); }} /> : null}

      <Panel title="参与方" id="participants" flush extra={<small className="muted">点一行查看详情</small>}>
        <div className="table-wrap">
          <table className="table table--rows table--stack">
            <thead>
              <tr>
                <th scope="col">参与方</th>
                <th scope="col">运行位置</th>
                <th scope="col">题库</th>
                <th scope="col" className="numeric">题目</th>
                <th scope="col">状态</th>
                <th scope="col" className="numeric">参加任务</th>
              </tr>
            </thead>
            <tbody>
              {state.participants.map((participant) => {
                const datasets = datasetsOf(state, participant.id);
                const open = selectedId === participant.id;
                return (
                  <Fragment key={participant.id}>
                    <tr className={open ? "row--open" : undefined}>
                      <th scope="row">
                        <button type="button" className="row-button" aria-expanded={open} onClick={() => toggle(participant.id)}>
                          <Icon name="chevron" />
                          <span>{participant.name}<small>{participant.org || "未填写机构"}</small></span>
                        </button>
                      </th>
                      <td data-label="运行位置">{HOSTING_LABELS[participant.hosting]}</td>
                      <td data-label="题库">{datasets.length ? datasets.map((dataset) => dataset.name).join("、") : <span className="muted">未登记</span>}</td>
                      <td className="numeric" data-label="题目">{formatNumber(datasets.reduce((sum, dataset) => sum + dataset.count, 0))}</td>
                      <td data-label="状态"><StatusPill tone={STATUS_TONE[participant.status]}>{PARTICIPANT_STATUS[participant.status]}</StatusPill></td>
                      <td className="numeric" data-label="参加任务">{taskCountOf(state, participant.id)}</td>
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
    if (window.confirm(`删除参与方"${participant.name}"和它的题库？已有任务里的记录不受影响。`)) {
      dispatch({ type: "removeParticipant", id: participant.id });
      navigate({ page: "participants" }, { keepScroll: true });
    }
  }

  return (
    <div className="participant-detail">
      <p>{participant.intro || "没有简介。"}</p>
      {participant.hosting === "local" ? <LocalConnect /> : null}
      {datasets.map((dataset) => (
        <div key={dataset.id} className="dataset-card">
          <div className="dataset-head">
            <strong>{dataset.name}</strong>
            <span className="muted">{dataset.description}</span>
            <Badge>{dataset.source === "builtin" ? "内置" : "上传"}</Badge>
          </div>
          <dl className="facts facts--row">
            <div><dt>题目</dt><dd>{formatNumber(dataset.count)}</dd></div>
            <div><dt>带答案</dt><dd>{formatNumber(dataset.answered)}</dd></div>
            <div><dt>字段</dt><dd><code>id</code> <code>question</code> <code>answer</code></dd></div>
          </dl>
          {dataset.sample ? (
            <div className="sample-question">
              <span>样例题</span>
              <p lang="en">{dataset.sample.question}</p>
              {dataset.sample.answer ? <small lang="en">答案：{dataset.sample.answer}</small> : null}
            </div>
          ) : null}
        </div>
      ))}
      {participant.hosting === "platform" && !participant.builtin ? (
        uploading ? (
          <DatasetForm
            participantId={participant.id}
            onCancel={() => setUploading(false)}
            onSave={(dataset) => { dispatch({ type: "addDataset", dataset }); setUploading(false); }}
          />
        ) : null
      ) : null}
      <div className="detail-actions">
        {participant.hosting === "platform" && !participant.builtin && !uploading ? (
          <button type="button" className="button button--secondary button--compact" onClick={() => setUploading(true)}><Icon name="upload" />上传题库</button>
        ) : null}
        {!participant.builtin ? (
          <button type="button" className="button button--ghost button--compact button--danger" onClick={remove}>删除参与方</button>
        ) : <span className="muted">内置示例参与方不能删除</span>}
      </div>
    </div>
  );
}

function LocalConnect() {
  return (
    <div className="connect-steps">
      <strong>在参与方的环境里连接</strong>
      <ol>
        <li>安装客户端</li>
        <li>登记题库并连接平台</li>
        <li>客户端用参与方自己的模型密钥解题，每轮只上传 trace；加 <code>--review</code> 可以在上传前逐条确认。</li>
      </ol>
      <pre className="code-block code-block--wrap">{`pip install fedagent-client
fedagent-client connect \\
  --server https://<平台地址> \\
  --token <平台签发的令牌> \\
  --data ./questions.jsonl --review`}</pre>
      <small className="muted">客户端尚未发布。连上之前这个参与方显示"等待连接"，不能加入任务。</small>
    </div>
  );
}

function NewParticipant({ dispatch, onDone }: { dispatch: Dispatch<Action>; onDone: (id?: string) => void }) {
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [intro, setIntro] = useState("");
  const [hosting, setHosting] = useState<Hosting>("platform");
  const [dataset, setDataset] = useState<Omit<Dataset, "participantId"> | null>(null);
  const ready = name.trim() && (hosting === "local" || dataset);

  function save() {
    if (!ready) return;
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
    onDone(id);
  }

  return (
    <Panel title="新增参与方" id="new-participant">
      <div className="form-grid">
        <label className="setting">
          <span className="setting-label">名称</span>
          <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="例如：某高校数学组" />
        </label>
        <label className="setting">
          <span className="setting-label">所属机构</span>
          <input value={org} maxLength={40} onChange={(event) => setOrg(event.target.value)} placeholder="可不填" />
        </label>
        <label className="setting setting--wide">
          <span className="setting-label">简介</span>
          <input value={intro} maxLength={120} onChange={(event) => setIntro(event.target.value)} placeholder="这个参与方的数据是什么、来自哪里" />
        </label>
        <fieldset className="setting setting--wide">
          <legend className="setting-label">运行位置</legend>
          <div className="radio-row">
            {(["platform", "local"] as const).map((option) => (
              <label key={option} className={`radio-card${hosting === option ? " radio-card--checked" : ""}`}>
                <input type="radio" name="hosting" checked={hosting === option} onChange={() => setHosting(option)} />
                <span><strong>{HOSTING_LABELS[option]}</strong><small>{HOSTING_DETAIL[option].where}</small></span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {hosting === "platform" ? (
        <DatasetPicker onChange={setDataset} />
      ) : (
        <LocalConnect />
      )}
      <div className="form-actions">
        <button type="button" className="button button--secondary" onClick={() => onDone()}>取消</button>
        <button type="button" className="button button--primary" disabled={!ready} onClick={save}>保存</button>
      </div>
    </Panel>
  );
}

function DatasetForm({ participantId, onSave, onCancel }: { participantId: string; onSave: (dataset: Dataset) => void; onCancel: () => void }) {
  const [dataset, setDataset] = useState<Omit<Dataset, "participantId"> | null>(null);
  return (
    <div className="dataset-form">
      <DatasetPicker onChange={setDataset} />
      <div className="form-actions">
        <button type="button" className="button button--secondary button--compact" onClick={onCancel}>取消</button>
        <button type="button" className="button button--primary button--compact" disabled={!dataset} onClick={() => dataset && onSave({ ...dataset, participantId })}>保存题库</button>
      </div>
    </div>
  );
}

type FileState = { name: string; size: number; check: JsonlCheck | null; error?: string };

/** 选择 JSONL 题库并在浏览器里检查；检查通过后给出数据集描述（只保存描述，不保存题目内容）。 */
function DatasetPicker({ onChange }: { onChange: (dataset: Omit<Dataset, "participantId"> | null) => void }) {
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
      description: nextDescription.trim() || "上传的题库",
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
      const next = { name: selected.name, size: selected.size, check: null, error: "文件超过 20 MB，请拆分后上传" };
      setFile(next);
      emit(next, title, description);
      return;
    }
    const check = checkJsonl(await selected.text());
    const next = { name: selected.name, size: selected.size, check };
    setFile(next);
    emit(next, title, description);
  }

  return (
    <div className="dataset-picker">
      <label className="upload-zone">
        <input type="file" accept=".jsonl,.json,application/json" onChange={(event) => pick(event.target.files?.[0])} />
        <Icon name="upload" />
        <strong>{file ? file.name : "选择题库文件（JSONL）"}</strong>
        <small>每行一道题：<code>{`{"id": "q1", "question": "…", "answer": "…"}`}</code>；answer 可以没有。文件只在浏览器里检查，不会上传。</small>
      </label>
      {file ? (
        <div className={`check-result${file.check?.ok ? " check-result--ok" : " check-result--failed"}`} aria-live="polite">
          {file.error ? <p><Icon name="x" />{file.error}</p> : null}
          {file.check?.ok ? (
            <p><Icon name="check" />检查通过：{formatNumber(file.check.count)} 道题，其中 {formatNumber(file.check.answered)} 道带答案。</p>
          ) : null}
          {file.check && !file.check.ok ? (
            <>
              <p><Icon name="x" />有 {file.check.problemCount} 处问题{file.check.count ? `（另有 ${file.check.count} 道题合格）` : ""}，改好后重新选择文件：</p>
              <ul>
                {file.check.problems.map((problem) => (
                  <li key={`${problem.line}-${problem.message}`}>{problem.line ? `第 ${problem.line} 行：` : ""}{problem.message}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
      {file?.check?.ok ? (
        <div className="form-grid">
          <label className="setting">
            <span className="setting-label">题库名称</span>
            <input value={title} placeholder={file.name.replace(/\.jsonl?$/i, "")} maxLength={40} onChange={(event) => { setTitle(event.target.value); emit(file, event.target.value, description); }} />
          </label>
          <label className="setting">
            <span className="setting-label">说明</span>
            <input value={description} placeholder="例如：2024 年校内竞赛题" maxLength={60} onChange={(event) => { setDescription(event.target.value); emit(file, title, event.target.value); }} />
          </label>
        </div>
      ) : null}
      <p className="panel-foot">第一版只支持数学推理题（按 <code>\boxed{}</code> 里的答案判分）。<a className="text-link" href={hrefOf({ page: "newTask", scenario: "horizontal" })}>保存后可在新建任务里选择</a></p>
    </div>
  );
}
