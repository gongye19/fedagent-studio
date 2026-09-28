import { Fragment, useState, type Dispatch } from "react";
import { HOSTING_LABELS, PARTICIPANT_STATUS, type Dataset, type Hosting, type Participant } from "../domain/resources";
import { checkJsonl, MAX_FILE_BYTES, type JsonlCheck } from "../domain/validate";
import { hrefOf, navigate } from "../state/route";
import { datasetsOf, taskCountOf, type Action, type State } from "../state/store";
import { PageHead, StatusPill } from "./common";
import { formatNumber } from "./format";
import { Icon } from "./icons";
import { OptionCard } from "./OptionCard";

type Props = { state: State; dispatch: Dispatch<Action>; selectedId?: string };

const HOSTING_DETAIL: Record<Hosting, string> = {
  platform: "题库上传到平台，由平台运行这一方的 Agent。平台能看到题库，适合公开数据和演示。",
  local: "题库和模型密钥留在参与方自己的环境，由参与方运行客户端，每轮只上传 trace。适合真实的跨机构联邦。",
};

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export default function ParticipantsPage({ state, dispatch, selectedId }: Props) {
  const [adding, setAdding] = useState(false);
  const toggle = (id: string) => navigate(selectedId === id ? { page: "participants" } : { page: "participants", id }, { keepScroll: true });
  const builtin = state.participants.filter((participant) => participant.builtin);
  const others = state.participants.filter((participant) => !participant.builtin);
  const groups = [
    { key: "others", title: "添加的参与方", note: null, members: others },
    { key: "builtin", title: "内置示例", note: "平台托管，各持一份数学题库", members: builtin },
  ].filter((group) => group.members.length);

  return (
    <>
      <PageHead
        title="参与方与数据"
        meta="每个参与方持有自己的题库，由一个 Agent 代表它参加联邦任务。"
        actions={adding ? null : <button type="button" className="button button--primary" onClick={() => setAdding(true)}><Icon name="plus" />新增参与方</button>}
      />

      {adding ? <NewParticipant dispatch={dispatch} onDone={(id) => { setAdding(false); if (id) navigate({ page: "participants", id }, { keepScroll: true }); }} /> : null}

      <div className="table-shell">
        <table className="table table--rows">
          <thead>
            <tr>
              <th scope="col">参与方</th>
              <th scope="col" className="numeric">题目</th>
              <th scope="col" className="numeric">参加任务</th>
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.key}>
              <tr className="group-row">
                <th scope="colgroup" colSpan={3}>{group.title} · {group.members.length}{group.note ? <span>{group.note}</span> : null}</th>
              </tr>
              {group.members.map((participant) => {
                const datasets = datasetsOf(state, participant.id);
                const open = selectedId === participant.id;
                const flags = [
                  participant.hosting === "local" ? HOSTING_LABELS.local : null,
                  participant.status !== "online" ? PARTICIPANT_STATUS[participant.status] : null,
                ].filter((flag): flag is string => Boolean(flag));
                return (
                  <Fragment key={participant.id}>
                    <tr className={open ? "row--open" : undefined}>
                      <th scope="row">
                        <button type="button" className="row-button" aria-expanded={open} onClick={() => toggle(participant.id)}>
                          <Icon name="chevron" />
                          <span className="row-title">
                            {participant.name}
                            {participant.org && !participant.builtin ? <small>{participant.org}</small> : null}
                          </span>
                          {flags.map((flag) => <StatusPill key={flag} tone={flag === PARTICIPANT_STATUS.waiting ? "warning" : "neutral"}>{flag}</StatusPill>)}
                        </button>
                      </th>
                      <td className="numeric" data-label="题目">{datasets.length ? formatNumber(datasets.reduce((sum, dataset) => sum + dataset.count, 0)) : <span className="muted">未登记</span>}</td>
                      <td className="numeric" data-label="参加任务">{taskCountOf(state, participant.id)}</td>
                    </tr>
                    {open ? (
                      <tr className="detail-row">
                        <td colSpan={3}>
                          <ParticipantDetail participant={participant} datasets={datasets} dispatch={dispatch} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </>
  );
}

function ParticipantDetail({ participant, datasets, dispatch }: { participant: Participant; datasets: Dataset[]; dispatch: Dispatch<Action> }) {
  const [uploading, setUploading] = useState(false);

  function remove() {
    if (window.confirm(`删除参与方“${participant.name}”和它的题库？已有任务里的记录不受影响。`)) {
      dispatch({ type: "removeParticipant", id: participant.id });
      navigate({ page: "participants" }, { keepScroll: true });
    }
  }

  return (
    <div className="participant-detail">
      <p className="detail-lede">{participant.intro || "没有简介。"}</p>
      {participant.hosting === "local" ? <LocalConnect /> : null}
      {datasets.map((dataset) => (
        <div key={dataset.id} className="dataset-info">
          <h3>{dataset.name}<span>{dataset.description}{dataset.origin ? `（${dataset.origin}）` : ""}</span></h3>
          <dl className="facts facts--row">
            <div><dt>题目</dt><dd>{formatNumber(dataset.count)}</dd></div>
            <div><dt>带答案</dt><dd>{formatNumber(dataset.answered)}</dd></div>
            <div><dt>字段</dt><dd><code>id</code> <code>question</code> <code>answer</code></dd></div>
            <div><dt>来源</dt><dd>{dataset.source === "builtin" ? "FoT 复现包" : "上传"}</dd></div>
          </dl>
          {dataset.sample ? (
            <div className="sample-question">
              <span>样例题</span>
              <p lang="en">{dataset.sample.question}</p>
              {dataset.sample.answer ? <p className="sample-answer" lang="en">答案：{dataset.sample.answer}</p> : null}
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
            <button type="button" className="button button--secondary button--compact" onClick={() => setUploading(true)}><Icon name="upload" />上传题库</button>
          ) : null}
          <button type="button" className="button button--ghost button--compact button--danger" onClick={remove}>删除参与方</button>
        </div>
      )}
    </div>
  );
}

function LocalConnect() {
  return (
    <div className="connect-steps">
      <h3>在参与方的环境里连接</h3>
      <p className="detail-lede">安装客户端，登记题库并连接平台。客户端用参与方自己的模型解题，每轮只上传 trace；加 <code>--review</code> 可以在上传前逐条确认。</p>
      <pre className="code-block code-block--wrap">{`pip install fedagent-client
fedagent-client connect \\
  --server https://<平台地址> \\
  --token <平台签发的令牌> \\
  --data ./questions.jsonl --review`}</pre>
      <p className="section-meta">客户端尚未发布。连上之前显示“等待连接”，不能加入任务。</p>
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
    <section className="form-card" aria-labelledby="new-participant-title">
      <h2 id="new-participant-title">新增参与方</h2>
      <div className="form-grid">
        <label className="field">
          <span>名称</span>
          <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="例如：某高校数学组" />
        </label>
        <label className="field">
          <span>所属机构（可不填）</span>
          <input value={org} maxLength={40} onChange={(event) => setOrg(event.target.value)} />
        </label>
        <label className="field field--wide">
          <span>简介（可不填）</span>
          <input value={intro} maxLength={120} onChange={(event) => setIntro(event.target.value)} placeholder="这个参与方的数据是什么、来自哪里" />
        </label>
        <fieldset className="field field--wide">
          <legend>运行位置</legend>
          <div className="option-grid option-grid--two">
            {(["platform", "local"] as const).map((option) => (
              <OptionCard key={option} type="radio" name="hosting" compact checked={hosting === option} onChange={() => setHosting(option)} title={HOSTING_LABELS[option]}>
                {HOSTING_DETAIL[option]}
              </OptionCard>
            ))}
          </div>
        </fieldset>
      </div>
      {hosting === "platform" ? <DatasetPicker onChange={setDataset} /> : <LocalConnect />}
      <div className="form-actions">
        <button type="button" className="button button--secondary" onClick={() => onDone()}>取消</button>
        <button type="button" className="button button--primary" disabled={!ready} onClick={save}>保存</button>
      </div>
    </section>
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
        <span>每行一道题：<code>{`{"id": "q1", "question": "…", "answer": "…"}`}</code>，answer 可以没有。文件只在浏览器里检查，不会上传。</span>
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
          <label className="field">
            <span>题库名称</span>
            <input value={title} placeholder={file.name.replace(/\.jsonl?$/i, "")} maxLength={40} onChange={(event) => { setTitle(event.target.value); emit(file, event.target.value, description); }} />
          </label>
          <label className="field">
            <span>说明</span>
            <input value={description} placeholder="例如：2024 年校内竞赛题" maxLength={60} onChange={(event) => { setDescription(event.target.value); emit(file, title, event.target.value); }} />
          </label>
        </div>
      ) : null}
      <p className="section-meta">第一版只支持数学推理题（按 <code>\boxed{}</code> 里的答案判分）。<a className="text-link" href={hrefOf({ page: "newTask", scenario: "horizontal" })}>保存后可在新建任务里选择</a></p>
    </div>
  );
}
