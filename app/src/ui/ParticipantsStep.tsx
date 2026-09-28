import { useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { SAMPLE_BYTES, checkUpload, dataContract, isTextFile, nodeDelivery } from "../domain/inputs";
import {
  PARTNER_FLOW,
  SELF_ORG,
  availableExampleOrgs,
  memberStatusLabel,
  readiness,
  type Member,
  type Project,
} from "../domain/project";
import { computeOf, deploymentOf, type DataTypeId } from "../domain/taxonomy";
import { eligibleDatasets, eligibleNodes, type Action, type State } from "../state/store";
import { StageMessage } from "./common";
import { Icon } from "./icons";
import NodeBinding from "./NodeBinding";

/** Agent 检查的演示时长；检查本身在浏览器本地同步完成。 */
const CHECK_DEMO_MS = 900;

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

type Props = { project: Project; state: State; dispatch: (action: Action) => void };

/**
 * 组建参与方：参与要求、成员进度、本机构节点绑定、邀请合作机构（跨机构）、
 * 添加本机构其他节点（组织内部）或上传本机构文件（文件类场景）。
 */
export default function ParticipantsStep({ project, state, dispatch }: Props) {
  const { plan } = project;
  const usesNodes = plan.scenario.inputKind === "nodes";
  const locked = Boolean(project.run);
  const initiator = project.role === "initiator";
  const progress = readiness(project);
  const self = project.members.find((member) => member.kind === "self");

  return (
    <div className="participants">
      <Requirements project={project} />

      <section aria-labelledby="members-title">
        <header className="section-head">
          <h3 id="members-title">参与方</h3>
        </header>
        <ul className="member-list">
          {project.members.map((member) => (
            <MemberRow key={member.id} member={member} project={project} dispatch={dispatch} editable={initiator && !locked} />
          ))}
          {project.uploads.filter((upload) => upload.status === "passed").map((upload) => (
            <li className="member" key={upload.id}>
              <div className="member-main">
                <strong>{SELF_ORG} · {upload.name}</strong>
                <span className="badge">本机构</span>
                <span className="status status--complete">检查通过</span>
              </div>
              <p className="member-detail">{upload.check?.records ?? "—"} 条记录 · 文件只在平台隔离沙箱中读取</p>
            </li>
          ))}
          {!project.members.length && !project.uploads.some((upload) => upload.status === "passed") ? (
            <li className="member member--empty">还没有参与方。邀请合作机构，或在下方上传本机构文件。</li>
          ) : null}
        </ul>
      </section>

      {usesNodes && self && (self.status === "binding") && !locked ? (
        <section aria-labelledby="bind-title">
          <header className="section-head"><h3 id="bind-title">绑定本机构节点</h3></header>
          <SelfBinding project={project} state={state} dispatch={dispatch} memberId={self.id} submitLabel={initiator ? "绑定并确认" : "绑定"} />
        </section>
      ) : null}

      {initiator && !locked ? <InvitePanel project={project} dispatch={dispatch} /> : null}
      {initiator && !locked && usesNodes ? <OwnNodePanel project={project} state={state} dispatch={dispatch} /> : null}
      {initiator && !locked && !usesNodes ? <UploadPanel project={project} dispatch={dispatch} /> : null}

      {!locked ? (
        <p aria-live="polite" className={`inputs-summary${progress.ready ? "" : " inputs-summary--blocked"}`}>
          {progress.ready
            ? initiator
              ? `已有 ${progress.confirmed} 方确认，可以开始运行。${progress.pending ? `还有 ${progress.pending} 方未完成，不参加本次运行。` : ""}`
              : `本机构已确认，等待 ${project.initiatorOrg} 启动运行。`
            : progress.blockers.join("；")}
        </p>
      ) : (
        <StageMessage text={`运行已开始，参与方已冻结：${project.run?.participants.map((participant) => participant.name).join("、")}。`} />
      )}
    </div>
  );
}

function Requirements({ project }: { project: Project }) {
  const { plan } = project;
  const self = project.members.find((member) => member.kind === "self");
  const contract = dataContract(plan.requirements.dataType.id as DataTypeId);
  const facts: [string, string][] = [
    ["参与方", `最少 ${plan.requirements.minParties} 方（${plan.requirements.partyScale}）`],
    ...(plan.requirements.compute ? [["节点规格", `≥ ${plan.requirements.compute.label}（${plan.requirements.compute.hint}）`] as [string, string]] : []),
    ["数据", plan.requirements.dataType.label],
    ...(plan.requirements.network ? [["网络", plan.requirements.network] as [string, string]] : []),
    ...(self && plan.pattern === "vertical-protocol" ? [["本机构角色", self.role] as [string, string]] : []),
  ];
  return (
    <section className="data-contract" aria-labelledby="requirements-title">
      <header className="section-head">
        <h3 id="requirements-title">参与要求</h3>
        <span className="badge">{plan.scenario.inputKindLabel}</span>
      </header>
      <dl className="requirement-grid">
        {facts.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <ul>
        {contract.requirements.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  );
}

function MemberRow({ member, project, dispatch, editable }: { member: Member; project: Project; dispatch: Props["dispatch"]; editable: boolean }) {
  const usesNodes = project.plan.scenario.inputKind === "nodes";
  const tone = member.status === "confirmed" ? " status--complete" : member.status === "binding" ? "" : " status--running";
  const step = PARTNER_FLOW.indexOf(member.status);
  const spec = member.node ? computeOf(member.node.spec) : undefined;

  return (
    <li className="member">
      <div className="member-main">
        <strong>{member.org}</strong>
        {member.kind === "self" ? <span className="badge">本机构</span> : null}
        {member.kind === "own-node" ? <span className="badge">本机构节点</span> : null}
        {member.initiator ? <span className="badge">发起方</span> : null}
        {member.example ? <span className="badge badge--auto">示例</span> : null}
        {project.plan.pattern === "vertical-protocol" ? <span className="badge">{member.role}</span> : null}
        <span className={`status${tone}`}>{memberStatusLabel(member.status, usesNodes)}</span>
        {editable && member.kind !== "self" ? (
          <span className="member-actions">
            {member.kind === "partner" && !member.simulated && member.status !== "confirmed" ? (
              <button type="button" className="button button--secondary button--compact" onClick={() => dispatch({ type: "simulateMember", projectId: project.id, memberId: member.id })}>
                模拟对方处理
              </button>
            ) : null}
            <button type="button" className="remove-button" aria-label={`移除 ${member.org}`} onClick={() => dispatch({ type: "removeMember", projectId: project.id, memberId: member.id })}>
              移除
            </button>
          </span>
        ) : null}
      </div>
      {member.kind === "partner" && member.status !== "confirmed" ? (
        <ol className="member-steps" aria-label={`${member.org} 的进度`}>
          {PARTNER_FLOW.map((status, index) => (
            <li key={status} className={index < step ? "member-step--done" : index === step ? "member-step--current" : ""}>
              {index < step ? <Icon name="check" /> : null}
              {memberStatusLabel(status, usesNodes)}
            </li>
          ))}
        </ol>
      ) : null}
      {member.node || member.data ? (
        <p className="member-detail">
          {member.node ? <span>{member.node.name} · {member.node.location} · {spec?.label}</span> : null}
          {member.data ? <span>{member.data.name} · {member.data.detail}</span> : null}
        </p>
      ) : null}
    </li>
  );
}

function SelfBinding({ project, state, dispatch, memberId, submitLabel, own = false }: Props & { memberId: string; submitLabel: string; own?: boolean }) {
  const { plan } = project;
  const role = own ? (plan.pattern === "vertical-protocol" ? "特征方" : undefined) : project.members.find((member) => member.id === memberId)?.role;
  const eligible = new Set(eligibleNodes(state, project, own ? undefined : memberId).map((node) => node.id));
  const deployment = plan.selection.deployment;
  const delivery = nodeDelivery(deployment);
  return (
    <NodeBinding
      nodes={state.nodes}
      eligibleIds={eligible}
      requiredSpec={plan.requirements.compute?.id}
      newNode={{ label: `${deploymentOf(deployment)?.label ?? ""} · ${plan.requirements.compute?.label ?? ""}`, method: delivery.method, command: delivery.command }}
      datasets={eligibleDatasets(state, plan, role)}
      submitLabel={submitLabel}
      onSubmit={(node, datasetId) => dispatch({
        type: own ? "addOwnNode" : "bindSelf",
        projectId: project.id,
        memberId: own ? uid("own") : memberId,
        node,
        datasetId,
        newNodeId: uid("node"),
      })}
    />
  );
}

function InvitePanel({ project, dispatch }: { project: Project; dispatch: Props["dispatch"] }) {
  const [org, setOrg] = useState("");
  const progress = readiness(project);
  const inProgress = project.members.filter((member) => member.kind === "partner" && member.status !== "confirmed").length;
  const missing = Math.max(0, progress.min - progress.confirmed - inProgress);
  const examples = availableExampleOrgs(project);

  function invite(name: string, example: boolean) {
    dispatch({ type: "invite", projectId: project.id, memberId: uid("m"), org: name, simulated: example, example });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!org.trim()) return;
    invite(org, false);
    setOrg("");
  }

  return (
    <section aria-labelledby="invite-title">
      <header className="section-head"><h3 id="invite-title">邀请合作机构</h3></header>
      <form className="invite-form" onSubmit={submit}>
        <label className="field">
          <span>机构名称或邮箱</span>
          <input name="organization" autoComplete="organization" spellCheck={false} value={org} placeholder="例如 华东第一医院 或 partner@example.com…" onChange={(event) => setOrg(event.target.value)} />
        </label>
        <button type="submit" className="button button--secondary" disabled={!org.trim()}>发送邀请</button>
      </form>
      <p className="section-note">对方接受后绑定节点、授权数据并确认方案。演示环境不会真的发出邀请，可点"模拟对方处理"推进。</p>
      {examples.length ? (
        <div className="example-orgs">
          <span>示例机构</span>
          {examples.slice(0, 4).map((name) => (
            <button type="button" className="chip" key={name} onClick={() => invite(name, true)}>{name}</button>
          ))}
          {missing > 0 ? (
            <button
              type="button"
              className="button button--secondary button--compact"
              onClick={() => examples.slice(0, missing).forEach((name) => invite(name, true))}
            >
              补齐示例参与方（还差 {missing} 方）
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function OwnNodePanel({ project, state, dispatch }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="own-title">
      <header className="section-head">
        <h3 id="own-title">添加本机构其他节点</h3>
        {!open ? <button type="button" className="button button--secondary button--compact" onClick={() => setOpen(true)}>添加节点</button> : null}
      </header>
      <p className="section-note">组织内部联邦：集团的不同分支或机房各作为一方，数据仍然不出各自节点。</p>
      {open ? (
        <SelfBinding project={project} state={state} dispatch={(action) => { dispatch(action); setOpen(false); }} memberId="" submitLabel="添加为参与方" own />
      ) : null}
    </section>
  );
}

const UPLOAD_STATUS = { checking: "Agent 检查中…", passed: "检查通过", failed: "未通过" } as const;

function UploadPanel({ project, dispatch }: { project: Project; dispatch: Props["dispatch"] }) {
  const contract = dataContract(project.plan.requirements.dataType.id as DataTypeId);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).map((file) => ({ file, id: `upload-${file.name}-${file.size}-${file.lastModified}` }));
    dispatch({ type: "addUploads", projectId: project.id, files: list.map(({ file, id }) => ({ id, name: file.name, size: file.size })) });
    for (const { file, id } of list) {
      // 只在浏览器本地读取前 256KB 做结构检查，不上传、不保存文件内容。
      const sample = isTextFile(file.name) ? await file.slice(0, SAMPLE_BYTES).text() : undefined;
      const check = checkUpload(contract, { name: file.name, size: file.size, sample });
      window.setTimeout(() => dispatch({ type: "uploadChecked", projectId: project.id, id, check }), CHECK_DEMO_MS);
    }
  }

  return (
    <section aria-labelledby="upload-title">
      <header className="section-head"><h3 id="upload-title">上传本机构文件</h3></header>
      <p className="section-note">每份检查通过的文件算作一方；集团内多个分支可以各上传一份。</p>
      <label
        className="upload-zone"
        onDragOver={(event: DragEvent<HTMLLabelElement>) => event.preventDefault()}
        onDrop={(event: DragEvent<HTMLLabelElement>) => {
          event.preventDefault();
          void upload(event.dataTransfer.files);
        }}
      >
        <input
          type="file"
          multiple
          accept={contract.accept.join(",")}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            void upload(event.target.files);
            event.target.value = "";
          }}
        />
        <strong>拖入文件，或点击选择</strong>
        <span>{contract.accept.join(" / ")}</span>
        <small>上传后由 Agent 检查格式、字段和条数。文件只在浏览器本地读取前 256KB，不会上传或保存。</small>
      </label>

      {project.uploads.length ? (
        <ul className="upload-results">
          {project.uploads.map((item) => (
            <li className={`upload-result upload-result--${item.status}`} key={item.id}>
              <header>
                <strong>{item.name}</strong>
                <span aria-live="polite" className={`status${item.status === "passed" ? " status--complete" : item.status === "failed" ? " status--failed" : " status--running"}`}>
                  {UPLOAD_STATUS[item.status]}
                </span>
                <button type="button" className="remove-button" aria-label={`移除 ${item.name}`} onClick={() => dispatch({ type: "removeUpload", projectId: project.id, id: item.id })}>
                  移除
                </button>
              </header>
              {item.check ? (
                <>
                  <ul className="upload-checks">
                    {item.check.items.map((check) => (
                      <li key={check.label} className={check.ok ? "" : "upload-check--failed"}>
                        <span><Icon name={check.ok ? "check" : "x"} label={check.ok ? "通过" : "未通过"} /></span>
                        <b>{check.label}</b>
                        <span>{check.detail}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="agent-line"><span>Agent</span>{item.check.note}</p>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
