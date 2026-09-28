// 页面状态：本机构的节点与数据、项目、收到的邀请，以及新建项目的配置草稿。
// 项目创建后配置冻结；运行开始后参与方冻结。所有规则在 domain/，这里只负责组合和查找。

import {
  addOwnNode,
  addUploads,
  advanceMember,
  bindSelf,
  createProject,
  deliverProject,
  inviteMember,
  markNodeOnline,
  projectFromInvitation,
  removeMember,
  removeUpload,
  simulateMember,
  startProjectRun,
  uploadChecked,
  type Dataset,
  type Invitation,
  type Project,
  type WorkspaceNode,
} from "../domain/project";
import type { UploadCheck } from "../domain/inputs";
import { buildRunPlan } from "../domain/plan";
import { finishStage, startStage, type StageId, type StageResult } from "../domain/run";
import { EMPTY_SELECTION, choose, type ItemId, type Selection } from "../domain/selection";
import { deploymentOf, meetsSpec, type ComputeId, type DeploymentId } from "../domain/taxonomy";
import { seedState } from "./seed";

export const STATE_VERSION = 4;

export type State = {
  version: typeof STATE_VERSION;
  nodes: WorkspaceNode[];
  datasets: Dataset[];
  projects: Project[];
  invitations: Invitation[];
  /** 新建项目页的配置草稿。 */
  draft: Selection;
};

/** 绑定节点时选"new"表示按配置交付一个新节点。 */
export type NodeChoice = string;
export const NEW_NODE = "new";

export type Action =
  | { type: "choose"; item: ItemId; value: string }
  | { type: "resetDraft" }
  | { type: "createProject"; id: string; name: string; createdAt: string }
  | { type: "bindSelf"; projectId: string; memberId: string; node: NodeChoice; datasetId: string; newNodeId: string }
  | { type: "addOwnNode"; projectId: string; memberId: string; node: NodeChoice; datasetId: string; newNodeId: string }
  | { type: "invite"; projectId: string; memberId: string; org: string; simulated: boolean; example?: boolean }
  | { type: "advanceMember"; projectId: string; memberId: string }
  | { type: "simulateMember"; projectId: string; memberId: string }
  | { type: "removeMember"; projectId: string; memberId: string }
  | { type: "nodeOnline"; nodeId: string }
  | { type: "addUploads"; projectId: string; files: { id: string; name: string; size: number }[] }
  | { type: "uploadChecked"; projectId: string; id: string; check: UploadCheck }
  | { type: "removeUpload"; projectId: string; id: string }
  | { type: "startRun"; projectId: string; runId: string; createdAt: string }
  | { type: "stageStart"; projectId: string; stage: StageId }
  | { type: "stageFinish"; projectId: string; stage: StageId; result: StageResult }
  | { type: "deliver"; projectId: string; recipients: string[] }
  | { type: "acceptInvitation"; invitationId: string; projectId: string; node: NodeChoice; datasetId: string; newNodeId: string; createdAt: string }
  | { type: "declineInvitation"; invitationId: string }
  | { type: "resetDemo" };

export const initialState: State = seedState();

export function projectOf(state: State, id: string): Project | undefined {
  return state.projects.find((project) => project.id === id);
}

function updateProject(state: State, id: string, change: (project: Project) => Project): State {
  let changed = false;
  const projects = state.projects.map((project) => {
    if (project.id !== id) return project;
    const next = change(project);
    changed = next !== project;
    return next;
  });
  return changed ? { ...state, projects } : state;
}

/** 可以绑定到项目的本机构节点：在线且满足最低算力，且没有被本项目的其他成员占用。 */
export function eligibleNodes(state: State, project: Pick<Project, "plan" | "members">, excludeMemberId?: string): WorkspaceNode[] {
  const used = new Set(project.members.filter((member) => member.id !== excludeMemberId).map((member) => member.node?.id));
  return state.nodes.filter((node) => (
    node.status === "online" && !used.has(node.id) && meetsSpec(node.spec, project.plan.requirements.compute?.id)
  ));
}

/** 数据类型相符的本机构数据；纵向时按角色把更合适的表排在前面。 */
export function eligibleDatasets(state: State, plan: Project["plan"], role?: string): Dataset[] {
  const matching = state.datasets.filter((dataset) => dataset.type === plan.requirements.dataType.id);
  if (role !== "标签方" && role !== "特征方") return matching;
  const wantsLabel = role === "标签方";
  return [...matching].sort((a, b) => Number(Boolean(b.hasLabel) === wantsLabel) - Number(Boolean(a.hasLabel) === wantsLabel));
}

/** 按计划交付一个新节点（公有云创建实例 / 私有机房安装包），初始状态为交付中。 */
function deliverNode(state: State, id: string, spec: ComputeId, location: DeploymentId): { state: State; node: WorkspaceNode } {
  const label = deploymentOf(location)?.label ?? "节点";
  const index = state.nodes.filter((node) => node.location === location).length + 1;
  const node: WorkspaceNode = { id, name: `${label}-${String(index).padStart(2, "0")}`, location, spec, status: "provisioning" };
  return { state: { ...state, nodes: [...state.nodes, node] }, node };
}

function resolveNode(state: State, choice: NodeChoice, newNodeId: string, spec: ComputeId, location: DeploymentId) {
  if (choice === NEW_NODE) return deliverNode(state, newNodeId, spec, location);
  const node = state.nodes.find((item) => item.id === choice);
  return node && node.status === "online" && meetsSpec(node.spec, spec) ? { state, node } : null;
}

function withNode(
  state: State,
  projectId: string,
  action: { node: NodeChoice; datasetId: string; newNodeId: string },
  apply: (project: Project, node: WorkspaceNode, dataset: Dataset) => Project,
): State {
  const project = projectOf(state, projectId);
  const dataset = state.datasets.find((item) => item.id === action.datasetId);
  if (!project || project.run || !dataset) return state;
  const spec = (project.plan.requirements.compute?.id ?? "cpu-general") as ComputeId;
  const location = (project.plan.selection.deployment ?? "aliyun") as DeploymentId;
  const resolved = resolveNode(state, action.node, action.newNodeId, spec, location);
  if (!resolved) return state;
  return updateProject(resolved.state, projectId, (current) => apply(current, resolved.node, dataset));
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "choose":
      return { ...state, draft: choose(state.draft, action.item, action.value) };

    case "resetDraft":
      return { ...state, draft: EMPTY_SELECTION };

    case "createProject": {
      const plan = buildRunPlan(state.draft);
      if (!plan) return state;
      const project = createProject({ id: action.id, name: action.name.trim() || plan.scenario.label, plan, createdAt: action.createdAt });
      return { ...state, projects: [project, ...state.projects], draft: EMPTY_SELECTION };
    }

    case "bindSelf":
      return withNode(state, action.projectId, action, (project, node, dataset) => bindSelf(project, action.memberId, node, dataset));

    case "addOwnNode":
      return withNode(state, action.projectId, action, (project, node, dataset) => addOwnNode(project, action.memberId, node, dataset));

    case "invite":
      return updateProject(state, action.projectId, (project) => inviteMember(project, {
        id: action.memberId,
        org: action.org,
        simulated: action.simulated,
        example: action.example,
      }));

    case "advanceMember":
      return updateProject(state, action.projectId, (project) => advanceMember(project, action.memberId));

    case "simulateMember":
      return updateProject(state, action.projectId, (project) => simulateMember(project, action.memberId));

    case "removeMember":
      return updateProject(state, action.projectId, (project) => removeMember(project, action.memberId));

    case "nodeOnline": {
      if (!state.nodes.some((node) => node.id === action.nodeId && node.status === "provisioning")) return state;
      return {
        ...state,
        nodes: state.nodes.map((node) => (node.id === action.nodeId ? { ...node, status: "online" } : node)),
        projects: state.projects.map((project) => markNodeOnline(project, action.nodeId)),
      };
    }

    case "addUploads":
      return updateProject(state, action.projectId, (project) => addUploads(project, action.files));

    case "uploadChecked":
      return updateProject(state, action.projectId, (project) => uploadChecked(project, action.id, action.check));

    case "removeUpload":
      return updateProject(state, action.projectId, (project) => removeUpload(project, action.id));

    case "startRun":
      return updateProject(state, action.projectId, (project) => startProjectRun(project, action.runId, action.createdAt));

    case "stageStart":
      return updateProject(state, action.projectId, (project) => (
        project.run ? { ...project, run: startStage(project.run, action.stage) } : project
      ));

    case "stageFinish":
      return updateProject(state, action.projectId, (project) => (
        project.run ? { ...project, run: finishStage(project.run, action.stage, action.result) } : project
      ));

    case "deliver":
      return updateProject(state, action.projectId, (project) => deliverProject(project, action.recipients));

    case "acceptInvitation": {
      const invitation = state.invitations.find((item) => item.id === action.invitationId);
      const dataset = state.datasets.find((item) => item.id === action.datasetId);
      if (!invitation || invitation.status !== "pending" || !dataset) return state;
      const spec = (invitation.plan.requirements.compute?.id ?? "cpu-general") as ComputeId;
      const resolved = resolveNode(state, action.node, action.newNodeId, spec, "aliyun");
      if (!resolved) return state;
      const project = projectFromInvitation(invitation, { id: action.projectId, node: resolved.node, dataset, createdAt: action.createdAt });
      return {
        ...resolved.state,
        projects: [project, ...resolved.state.projects],
        invitations: resolved.state.invitations.map((item) => (
          item.id === invitation.id ? { ...item, status: "accepted", projectId: project.id } : item
        )),
      };
    }

    case "declineInvitation":
      return {
        ...state,
        invitations: state.invitations.map((item) => (
          item.id === action.invitationId && item.status === "pending" ? { ...item, status: "declined" } : item
        )),
      };

    case "resetDemo":
      return seedState();

    default:
      return state;
  }
}
