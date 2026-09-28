import { Fragment, useRef, useState, type Dispatch } from "react";
import { HOSTING_LABELS, PARTICIPANT_STATUS, type Dataset, type Hosting, type Participant } from "../domain/resources";
import { checkJsonl, MAX_FILE_BYTES, MAX_PROBLEMS, type JsonlCheck } from "../domain/validate";
import { navigate } from "../state/route";
import { datasetsOf, taskCountOf, type Action, type State } from "../state/store";
import { CodeBlock, Collapsible, Facts, FormActions, Notice, PageHead, Tag } from "./common";
import { formatNumber } from "./format";
import { Icon } from "./icons";
import { OptionCard } from "./OptionCard";

type Props = { state: State; dispatch: Dispatch<Action>; selectedId?: string };

/** 选项卡片上只写一句区分点；适用场合写在选中后的说明里。 */
const HOSTING_OPTIONS: Record<Hosting, { summary: string; foot?: string; detail: string }> = {
  platform: {
    summary: "题库上传到平台，由平台运行 Agent",
    detail: "平台能看到题库，适合公开数据和演示。",
  },
  local: {
    summary: "题库留在本地，只上传 trace",
    foot: "客户端尚未发布",
    detail: "适合真实的跨机构联邦。保存后，在参与方详情里查看连接命令。",
  },
};

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export default function ParticipantsPage({ state, dispatch, selectedId }: Props) {
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const toggle = (id: string) => navigate(selectedId === id ? { page: "participants" } : { page: "participants", id }, { keepScroll: true });
  const builtin = state.participants.filter((participant) => participant.builtin);
  const others = state.participants.filter((participant) => !participant.builtin);
  const groups = [
    { key: "others", title: "添加的参与方", note: null, members: others },
    { key: "builtin", title: "内置示例", note: "平台托管", members: builtin },
  ].filter((group) => group.members.length);

  return (
    <>
      <PageHead
        title="参与方与数据"
        meta="每个参与方持有自己的题库，由一个 Agent 代表它参加联邦任务。"
        actions={adding ? null : <button type="button" className="button button--primary" onClick={() => { setAdding(true); setSaved(null); }}><Icon name="plus" />新增参与方</button>}
      />

      {saved ? (
        <Notice action={<button type="button" className="link-button" onClick={() => setSaved(null)}>知道了</button>}>{saved}</Notice>
      ) : null}

      {adding ? (
        <NewParticipant
          dispatch={dispatch}
          onDone={(created) => {
            setAdding(false);
            if (!created) return;
            setSaved(created.hosting === "local"
              ? `已添加“${created.name}”。下面的详情里有连接命令，连上之前显示“等待连接”。`
              : `已添加“${created.name}”，现在可以在新建任务里选择它的题库。`);
            navigate({ page: "participants", id: created.id }, { keepScroll: true });
          }}
        />
      ) : null}

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
                <th scope="colgroup" colSpan={3}>{group.title}<span>{group.members.length}{group.note ? ` · ${group.note}` : ""}</span></th>
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
                            {note(participant, datasets) ? <span className="cell-note">{note(participant, datasets)}</span> : null}
                            {flags.map((flag) => <Tag key={flag} tone={flag === PARTICIPANT_STATUS.waiting ? "warning" : "neutral"}>{flag}</Tag>)}
                          </span>
                        </button>
                      </th>
                      <td className="numeric" data-label="题目">{datasets.length ? formatNumber(datasets.reduce((sum, dataset) => sum + dataset.count, 0)) : "—"}</td>
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

/** 名称后面的一句说明：内置示例写题库说明，添加的参与方写所属机构。 */
function note(participant: Participant, datasets: Dataset[]): string {
  if (participant.builtin) return datasets[0]?.description ?? "";
  return participant.org;
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
      {participant.builtin ? null : <p className="detail-lede">{participant.intro || "没有简介。"}</p>}
      {participant.hosting === "local" ? <LocalConnect /> : null}
      {datasets.map((dataset) => (
        <div key={dataset.id} className="dataset-info">
          <Facts items={[
            // 表格行里已经写了名称和说明；只有一个参与方有多份题库、或题库和参与方不同名时才再写一遍。
            ...(datasets.length > 1 || dataset.name !== participant.name ? [["题库", `${dataset.name} · ${dataset.description}`] as const] : []),
            ["来源", dataset.source === "builtin" ? `${dataset.origin ? `${dataset.origin}，` : ""}随 FoT 复现包提供` : "上传"],
            ["题目", dataset.answered === dataset.count ? `${formatNumber(dataset.count)} 题，都带答案` : `${formatNumber(dataset.count)} 题，其中 ${formatNumber(dataset.answered)} 题带答案`],
          ]} />
          {dataset.sample ? (
            <div className="sample-question">
              <span>样例题（原文）</span>
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
      <p className="detail-lede">客户端用参与方自己的模型解题，每轮只上传 trace；加 <code>--review</code> 可以在上传前逐条确认。</p>
      <CodeBlock code={`pip install fedagent-client
fedagent-client connect \\
  --server https://<平台地址> \\
  --token <平台签发的令牌> \\
  --data ./questions.jsonl \\
  --review`} />
      <p className="connect-foot"><Tag>客户端尚未发布</Tag>连上之前不能加入任务。</p>
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
    hosting === "platform" && !dataset ? "检查通过的题库文件" : null,
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
    <section className="card" aria-labelledby="new-participant-title">
      <h2 id="new-participant-title">新增参与方</h2>
      <div className="form-grid">
        <label className="field">
          <span>名称</span>
          <input name="participant-name" autoComplete="off" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="例如：某高校数学组" />
        </label>
        <label className="field">
          <span>所属机构（可不填）</span>
          <input name="participant-org" autoComplete="off" value={org} maxLength={40} onChange={(event) => setOrg(event.target.value)} />
        </label>
        <label className="field field--wide">
          <span>简介（可不填）</span>
          <input name="participant-intro" autoComplete="off" value={intro} maxLength={120} onChange={(event) => setIntro(event.target.value)} placeholder="这个参与方的数据是什么、来自哪里…" />
        </label>
        <fieldset className="field field--wide">
          <legend>运行位置</legend>
          <div className="option-grid option-grid--form" role="radiogroup" aria-label="运行位置">
            {(["platform", "local"] as const).map((option) => (
              <OptionCard key={option} name="hosting" checked={hosting === option} onChange={() => setHosting(option)} title={HOSTING_LABELS[option]} foot={HOSTING_OPTIONS[option].foot}>
                {HOSTING_OPTIONS[option].summary}
              </OptionCard>
            ))}
          </div>
          <small className="field-hint">{HOSTING_OPTIONS[hosting].detail}</small>
        </fieldset>
        {hosting === "platform" ? <DatasetPicker onChange={setDataset} /> : null}
      </div>
      <FormActions missing={missing} saveLabel="保存参与方" onCancel={() => onDone()} onSave={save} />
    </section>
  );
}

function DatasetForm({ participantId, onSave, onCancel }: { participantId: string; onSave: (dataset: Dataset) => void; onCancel: () => void }) {
  const [dataset, setDataset] = useState<Omit<Dataset, "participantId"> | null>(null);
  return (
    <div className="dataset-form">
      <div className="form-grid">
        <DatasetPicker onChange={setDataset} />
      </div>
      <FormActions
        compact
        missing={dataset ? [] : ["检查通过的题库文件"]}
        saveLabel="保存题库"
        onCancel={onCancel}
        onSave={() => dataset && onSave({ ...dataset, participantId })}
      />
    </div>
  );
}

type FileState = { name: string; size: number; check: JsonlCheck | null; error?: string };

/**
 * 选择 JSONL 题库并在浏览器里检查；检查通过后给出数据集描述（只保存描述，不保存题目内容）。
 * 放在表单的两栏网格里，文件选择占整行，名称和说明各占一栏。
 */
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
      const next = { name: selected.name, size: selected.size, check: null, error: "文件超过 20\u00a0MB，请拆分后再选择" };
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
      <div className="field field--wide">
        <span>题库</span>
        <label className="upload-zone">
          <input ref={input} name="dataset-file" type="file" accept=".jsonl,.json,application/json" onChange={(event) => pick(event.target.files?.[0])} />
          <Icon name="upload" />
          <strong>{file ? file.name : "选择 JSONL 文件"}</strong>
          <span>每行一道数学题，需要 id 和 question，answer 可选；不超过 20&nbsp;MB</span>
        </label>
        <Collapsible card={false} title="查看格式">
          <p>每行一个 JSON 对象，例如 <code>{`{"id": "q1", "question": "…", "answer": "…"}`}</code>。评分时抽取 <code>{"\\boxed{}"}</code> 里的答案，与 answer 比较；没有 answer 的题也能参与联邦，只是不计准确率。</p>
        </Collapsible>
        {file ? (
          <div className={`check-result${failed ? " check-result--failed" : " check-result--ok"}`} aria-live="polite">
            {file.error ? <p><Icon name="x" />{file.error}</p> : null}
            {file.check?.ok ? (
              <p><Icon name="check" />检查通过：{formatNumber(file.check.count)} 道题，其中 {formatNumber(file.check.answered)} 道带答案。保存后可以在新建任务里选择。</p>
            ) : null}
            {file.check && !file.check.ok ? (
              <>
                <p><Icon name="x" />有 {file.check.problemCount} 处问题{file.check.count ? `（另有 ${file.check.count} 道题合格）` : ""}{file.check.problemCount > MAX_PROBLEMS ? `，下面只列前 ${MAX_PROBLEMS} 处` : ""}：</p>
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
      </div>
      {file?.check?.ok ? (
        <>
          <label className="field">
            <span>题库名称（可不填）</span>
            <input name="dataset-name" autoComplete="off" value={title} placeholder={file.name.replace(/\.jsonl?$/i, "")} maxLength={40} onChange={(event) => { setTitle(event.target.value); emit(file, event.target.value, description); }} />
            <small className="field-hint">不填则用文件名</small>
          </label>
          <label className="field">
            <span>说明（可不填）</span>
            <input name="dataset-description" autoComplete="off" value={description} placeholder="例如：2024 年校内竞赛题" maxLength={60} onChange={(event) => { setDescription(event.target.value); emit(file, title, event.target.value); }} />
          </label>
        </>
      ) : null}
    </>
  );
}
