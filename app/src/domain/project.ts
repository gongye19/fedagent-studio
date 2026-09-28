/**
 * 联邦项目：发起 + 邀请（跨机构）和组织内部多节点两种组队方式共用一个模型。
 *
 * - 发起方选好 7 个维度的配置后创建项目，配置随即锁定；修改配置需要新建项目。
 * - 参与方分三类：本机构（发起方自己的节点）、本机构其他节点（组织内部联邦）、受邀机构。
 * - 受邀机构依次经过：已邀请 → 已接受 → 节点就绪 / 文件已提交 → 数据已授权 / 检查通过 → 已确认方案。
 * - 已确认的参与方达到最少数量、且没有进行中的检查时，发起方才能开始运行。
 * 这里只有纯函数；计时和派发在 state/ 里。
 */
import { EXAMPLE_LOCATIONS, EXAMPLE_PARTNERS } from "./demo";
import { dataContract, type UploadCheck } from "./inputs";
import type { FrontendRunPlan } from "./plan";
import { createRun, publishRun, stageOf, type Participant, type Run } from "./run";
import { artifactFor } from "./simulator";
import { computeOf, deploymentOf, type ComputeId, type DataTypeId, type DeploymentId } from "./taxonomy";

export const SELF_ORG = "本机构";

/* 工作区：本机构的节点和登记的数据（只登记描述，数据不离开节点）。 */

export type NodeStatus = "online" | "offline" | "provisioning";

export type WorkspaceNode = {
  id: string;
  name: string;
  location: DeploymentId;
  spec: ComputeId;
  status: NodeStatus;
};

export type Dataset = {
  id: string;
  name: string;
  type: DataTypeId;
  detail: string;
  /** 纵向特征表是否含标签列：标签方优先用含标签的表，特征方优先用不含的。 */
  hasLabel?: boolean;
};

/* 参与方。 */

export type MemberKind = "self" | "own-node" | "partner";

export type MemberStatus = "binding" | "provisioning" | "invited" | "accepted" | "ready" | "authorized" | "confirmed";

/** 受邀机构的状态顺序。 */
export const PARTNER_FLOW: readonly MemberStatus[] = ["invited", "accepted", "ready", "authorized", "confirmed"];

export function memberStatusLabel(status: MemberStatus, usesNodes: boolean): string {
  switch (status) {
    case "binding":
      return "待绑定节点";
    case "provisioning":
      return "节点交付中";
    case "invited":
      return "已邀请";
    case "accepted":
      return "已接受";
    case "ready":
      return usesNodes ? "节点就绪" : "文件已提交";
    case "authorized":
      return usesNodes ? "数据已授权" : "检查通过";
    case "confirmed":
      return "已确认方案";
  }
}

export type MemberNode = { id?: string; name: string; location: string; spec: ComputeId };

export type Member = {
  id: string;
  org: string;
  kind: MemberKind;
  /** 模拟的对方机构：由模拟器自动推进状态。 */
  simulated: boolean;
  /** 项目发起方（参与方视角下的对方机构）。 */
  initiator?: boolean;
  /** 界面上标为"示例"的机构。 */
  example?: boolean;
  status: MemberStatus;
  role: string;
  node?: MemberNode;
  data?: { name: string; detail: string };
};

export type Upload = {
  id: string;
  name: string;
  size: number;
  status: "checking" | "passed" | "failed";
  check: UploadCheck | null;
};

export type ProjectRole = "initiator" | "participant";

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  role: ProjectRole;
  initiatorOrg: string;
  /** 冻结的运行计划，含 7 个维度的选择。 */
  plan: FrontendRunPlan;
  members: Member[];
  /** 文件类场景中本机构上传的文件，每份检查通过的文件算作一方。 */
  uploads: Upload[];
  run: Run | null;
};

const usesNodes = (project: Project) => project.plan.scenario.inputKind === "nodes";

export function isVertical(plan: FrontendRunPlan): boolean {
  return plan.pattern === "vertical-protocol";
}

function partnerRole(plan: FrontendRunPlan): string {
  return isVertical(plan) ? "特征方" : "参与方";
}

export function createProject({ id, name, plan, createdAt }: { id: string; name: string; plan: FrontendRunPlan; createdAt: string }): Project {
  const members: Member[] = plan.scenario.inputKind === "nodes"
    ? [{ id: `${id}-self`, org: SELF_ORG, kind: "self", simulated: false, status: "binding", role: isVertical(plan) ? "标签方" : "参与方" }]
    : [];
  return { id, name, createdAt, role: "initiator", initiatorOrg: SELF_ORG, plan, members, uploads: [], run: null };
}

/** 模拟的对方机构在就绪时上报的节点和数据摘要。 */
export function simulatedDetails(plan: FrontendRunPlan, org: string, index: number, role?: string): Pick<Member, "node" | "data"> {
  const pool = EXAMPLE_PARTNERS[plan.requirements.dataType.id as DataTypeId];
  const detail = pool.details[index % pool.details.length];
  const provides = role === "标签方" ? "特征表 + 标签列" : pool.provides;
  if (plan.scenario.inputKind === "files") {
    return { data: { name: `${org} · ${dataContract(plan.requirements.dataType.id as DataTypeId).title}`, detail: `${detail} · Agent 检查通过` } };
  }
  const location = deploymentOf(EXAMPLE_LOCATIONS[index % EXAMPLE_LOCATIONS.length])?.label ?? "私有机房";
  return {
    node: { name: `${org} 节点`, location, spec: (plan.requirements.compute?.id ?? "cpu-general") as ComputeId },
    data: { name: provides, detail },
  };
}

export function inviteMember(project: Project, { id, org, simulated, example = false }: { id: string; org: string; simulated: boolean; example?: boolean }): Project {
  const name = org.trim();
  if (!name || project.run || project.members.some((member) => member.org === name)) return project;
  const member: Member = { id, org: name, kind: "partner", simulated, example, status: "invited", role: partnerRole(project.plan) };
  return { ...project, members: [...project.members, member] };
}

/** 示例机构池里还没加入本项目的机构。 */
export function availableExampleOrgs(project: Project): string[] {
  const pool = EXAMPLE_PARTNERS[project.plan.requirements.dataType.id as DataTypeId].orgs;
  return pool.filter((org) => !project.members.some((member) => member.org === org));
}

/** 受邀机构向前推进一步；到"节点就绪 / 文件已提交"时带上模拟的节点和数据摘要。 */
export function advanceMember(project: Project, memberId: string): Project {
  const index = project.members.findIndex((member) => member.id === memberId);
  const member = project.members[index];
  if (!member || member.kind !== "partner") return project;
  const step = PARTNER_FLOW.indexOf(member.status);
  if (step < 0 || step === PARTNER_FLOW.length - 1) return project;
  const status = PARTNER_FLOW[step + 1];
  const partnerIndex = project.members.filter((item) => item.kind === "partner").indexOf(member);
  const details = status === "ready" ? simulatedDetails(project.plan, member.org, partnerIndex) : {};
  const members = project.members.map((item) => (item.id === memberId ? { ...item, ...details, status } : item));
  return { ...project, members };
}

/** 让一个真实邀请的机构也由模拟器推进（前端演示用）。 */
export function simulateMember(project: Project, memberId: string): Project {
  return { ...project, members: project.members.map((member) => (member.id === memberId ? { ...member, simulated: true } : member)) };
}

const snapshot = (node: WorkspaceNode): MemberNode => ({
  id: node.id,
  name: node.name,
  location: deploymentOf(node.location)?.label ?? node.location,
  spec: node.spec,
});

/** 本机构绑定节点和数据；节点还在交付中时，等节点上线后自动确认。 */
export function bindSelf(project: Project, memberId: string, node: WorkspaceNode, dataset: Dataset): Project {
  if (project.run) return project;
  const members = project.members.map((member) => (
    member.id === memberId && (member.kind === "self" || member.kind === "own-node")
      ? {
        ...member,
        node: snapshot(node),
        data: { name: dataset.name, detail: dataset.detail },
        status: node.status === "online" ? "confirmed" as const : "provisioning" as const,
      }
      : member
  ));
  return { ...project, members };
}

/** 组织内部联邦：把本机构的另一个节点作为一方加入。 */
export function addOwnNode(project: Project, id: string, node: WorkspaceNode, dataset: Dataset): Project {
  if (project.run || project.members.some((member) => member.node?.id === node.id)) return project;
  const member: Member = {
    id,
    org: `${SELF_ORG} · ${node.name}`,
    kind: "own-node",
    simulated: false,
    status: node.status === "online" ? "confirmed" : "provisioning",
    role: partnerRole(project.plan),
    node: snapshot(node),
    data: { name: dataset.name, detail: dataset.detail },
  };
  return { ...project, members: [...project.members, member] };
}

/** 节点交付完成后，使用它的参与方自动确认。 */
export function markNodeOnline(project: Project, nodeId: string): Project {
  if (!project.members.some((member) => member.node?.id === nodeId && member.status === "provisioning")) return project;
  return {
    ...project,
    members: project.members.map((member) => (
      member.node?.id === nodeId && member.status === "provisioning" ? { ...member, status: "confirmed" } : member
    )),
  };
}

export function removeMember(project: Project, memberId: string): Project {
  if (project.run) return project;
  return { ...project, members: project.members.filter((member) => member.id !== memberId || member.kind === "self" || member.initiator) };
}

/* 本机构上传的文件（文件类场景）。 */

export function addUploads(project: Project, files: { id: string; name: string; size: number }[]): Project {
  if (project.run || usesNodes(project)) return project;
  const fresh = files
    .filter((file) => !project.uploads.some((upload) => upload.id === file.id))
    .map((file): Upload => ({ ...file, status: "checking", check: null }));
  return { ...project, uploads: [...project.uploads, ...fresh] };
}

export function uploadChecked(project: Project, id: string, check: UploadCheck): Project {
  return {
    ...project,
    uploads: project.uploads.map((upload) => (
      upload.id === id ? { ...upload, status: check.passed ? "passed" : "failed", check } : upload
    )),
  };
}

export function removeUpload(project: Project, id: string): Project {
  return project.run ? project : { ...project, uploads: project.uploads.filter((upload) => upload.id !== id) };
}

/* 组队进度与开始条件。 */

export type Readiness = {
  confirmed: number;
  min: number;
  pending: number;
  blockers: string[];
  ready: boolean;
};

export function readiness(project: Project): Readiness {
  const min = project.plan.requirements.minParties;
  const confirmedMembers = project.members.filter((member) => member.status === "confirmed").length;
  const passedUploads = project.uploads.filter((upload) => upload.status === "passed").length;
  const confirmed = confirmedMembers + passedUploads;
  const pending = project.members.filter((member) => member.status !== "confirmed").length;
  const checking = project.uploads.filter((upload) => upload.status === "checking").length;
  const failed = project.uploads.filter((upload) => upload.status === "failed").length;

  const blockers: string[] = [];
  const self = project.members.find((member) => member.kind === "self");
  if (self?.status === "binding") blockers.push("本机构尚未绑定节点和数据");
  if (self?.status === "provisioning") blockers.push("本机构节点正在交付");
  if (confirmed < min) blockers.push(`还差 ${min - confirmed} 方确认`);
  if (checking) blockers.push(`有 ${checking} 份文件正在检查`);
  if (failed) blockers.push(`有 ${failed} 份文件未通过检查，请修改后重新上传或移除`);
  return { confirmed, min, pending, blockers, ready: blockers.length === 0 };
}

/** 本次运行的参与方：已确认的成员 + 检查通过的本机构文件。未确认的成员不参加。 */
export function runParticipants(project: Project): Participant[] {
  if (project.run) return project.run.participants;
  const contract = dataContract(project.plan.requirements.dataType.id as DataTypeId);
  const members = project.members
    .filter((member) => member.status === "confirmed")
    .map((member): Participant => ({
      id: member.id,
      name: member.org,
      org: member.kind === "partner" ? member.org : SELF_ORG,
      role: member.role,
      provides: member.data?.name ?? contract.title,
      detail: [member.node ? `${member.node.name} · ${computeOf(member.node.spec)?.label ?? member.node.spec}` : null, member.data?.detail]
        .filter(Boolean)
        .join(" · "),
      source: member.kind === "self" ? "self" : member.kind,
      spec: member.node?.spec,
    }));
  const uploads = project.uploads
    .filter((upload) => upload.status === "passed")
    .map((upload): Participant => ({
      id: upload.id,
      name: `${SELF_ORG} · ${upload.name}`,
      org: SELF_ORG,
      role: "参与方",
      provides: contract.title,
      detail: upload.check?.records !== null && upload.check?.records !== undefined ? `${upload.check.records} 条 · Agent 检查通过` : "Agent 检查通过",
      source: "upload",
    }));
  return [...members, ...uploads];
}

export function startProjectRun(project: Project, runId: string, createdAt: string): Project {
  if (project.run || !readiness(project).ready) return project;
  return { ...project, run: createRun(runId, project.plan, runParticipants(project), createdAt) };
}

/** 参加运行的机构（按机构去重，本机构的多个节点或文件只算一个交付对象）。 */
export function participantOrgs(project: Project): string[] {
  const orgs = (project.run?.participants ?? runParticipants(project)).map((participant) => participant.org);
  return [...new Set([project.initiatorOrg, ...orgs])];
}

/** 交付对象：按配置的交付范围；"指定参与方"时由发起方勾选。 */
export function deliveryRecipients(project: Project, selected?: string[]): string[] {
  const everyone = participantOrgs(project);
  switch (project.plan.deliveryScope.id) {
    case "initiator":
      return [project.initiatorOrg];
    case "selected":
      return [...new Set([project.initiatorOrg, ...(selected ?? []).filter((name) => everyone.includes(name))])];
    default:
      return everyone;
  }
}

export function deliverProject(project: Project, recipients: string[]): Project {
  if (!project.run) return project;
  const artifact = artifactFor(project.plan, project.run.participants, project.run.id, recipients);
  return { ...project, run: publishRun(project.run, artifact) };
}

export type ProjectStatus = "forming" | "ready" | "waiting" | "running" | "awaiting-delivery" | "delivered" | "failed";

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  forming: "组队中",
  ready: "可开始",
  waiting: "等待发起方启动",
  running: "运行中",
  "awaiting-delivery": "待交付",
  delivered: "已交付",
  failed: "失败",
};

export function projectStatus(project: Project): ProjectStatus {
  const { run } = project;
  if (!run) {
    if (project.role === "participant") return "waiting";
    return readiness(project).ready ? "ready" : "forming";
  }
  if (run.error) return "failed";
  if (stageOf(run, "publish").status === "done") return "delivered";
  if (stageOf(run, "evaluate").status === "done") return "awaiting-delivery";
  return "running";
}

/* 收到的邀请：本机构作为受邀方。 */

export type Invitation = {
  id: string;
  from: string;
  projectName: string;
  receivedAt: string;
  plan: FrontendRunPlan;
  /** 本机构在项目中的角色。 */
  role: string;
  /** 已在项目中的其他机构（含发起方）。 */
  others: { org: string; role: string }[];
  status: "pending" | "accepted" | "declined";
  projectId?: string;
};

/** 接受邀请：生成本机构视角的项目，发起方和其他机构已确认，本机构绑定节点和数据。 */
export function projectFromInvitation(invitation: Invitation, { id, node, dataset, createdAt }: { id: string; node: WorkspaceNode; dataset: Dataset; createdAt: string }): Project {
  const others: Member[] = invitation.others.map((other, index) => ({
    id: `${id}-m${index}`,
    org: other.org,
    kind: "partner",
    simulated: true,
    initiator: other.org === invitation.from,
    example: true,
    status: "confirmed",
    role: other.role,
    ...simulatedDetails(invitation.plan, other.org, index, other.role),
  }));
  const self: Member = { id: `${id}-self`, org: SELF_ORG, kind: "self", simulated: false, status: "binding", role: invitation.role };
  const project: Project = {
    id,
    name: invitation.projectName,
    createdAt,
    role: "participant",
    initiatorOrg: invitation.from,
    plan: invitation.plan,
    members: [...others, self],
    uploads: [],
    run: null,
  };
  return bindSelf(project, self.id, node, dataset);
}
