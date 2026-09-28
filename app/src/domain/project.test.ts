import { describe, expect, it } from "vitest";
import { checkUpload, dataContract } from "./inputs";
import { buildRunPlan } from "./plan";
import {
  PARTNER_FLOW,
  SELF_ORG,
  addOwnNode,
  addUploads,
  advanceMember,
  availableExampleOrgs,
  bindSelf,
  createProject,
  deliveryRecipients,
  inviteMember,
  markNodeOnline,
  projectFromInvitation,
  projectStatus,
  readiness,
  removeMember,
  runParticipants,
  startProjectRun,
  uploadChecked,
  type Dataset,
  type Invitation,
  type Project,
  type WorkspaceNode,
} from "./project";
import { applyScenario, choose, type Selection } from "./selection";
import type { ScenarioId } from "./taxonomy";

const gpuNode: WorkspaceNode = { id: "n1", name: "上海机房-01", location: "on-prem", spec: "gpu-24", status: "online" };
const cpuNode: WorkspaceNode = { id: "n2", name: "北京机房-02", location: "on-prem", spec: "cpu-compute", status: "online" };
const newNode: WorkspaceNode = { id: "n3", name: "阿里云-01", location: "aliyun", spec: "gpu-24", status: "provisioning" };
const qa: Dataset = { id: "d1", name: "客服问答指令集", type: "instruction", detail: "3,200 条" };
const txn: Dataset = { id: "d2", name: "客户交易特征表", type: "vertical-table", detail: "52,000 用户" };

function project(id: ScenarioId, adjust: (selection: Selection) => Selection = (selection) => selection): Project {
  const plan = buildRunPlan(adjust(applyScenario(id)));
  if (!plan) throw new Error("plan expected");
  return createProject({ id: "p", name: "测试项目", plan, createdAt: "2026-09-28T10:00:00+08:00" });
}

function confirmPartner(current: Project, org: string, index: number): Project {
  let next = inviteMember(current, { id: `m${index}`, org, simulated: true, example: true });
  for (let step = 1; step < PARTNER_FLOW.length; step += 1) next = advanceMember(next, `m${index}`);
  return next;
}

describe("forming a project", () => {
  it("starts node projects with our own member waiting for a node", () => {
    const training = project("horizontal-training");
    expect(training.role).toBe("initiator");
    expect(training.members).toEqual([expect.objectContaining({ org: SELF_ORG, kind: "self", status: "binding", role: "参与方" })]);
    expect(readiness(training).blockers).toContain("本机构尚未绑定节点和数据");
    expect(projectStatus(training)).toBe("forming");
    expect(project("vertical-training").members[0].role).toBe("标签方");
    expect(project("agent-memory").members).toEqual([]);
  });

  it("moves an invited partner through accept, node, data and confirmation", () => {
    let training = inviteMember(project("horizontal-training"), { id: "m1", org: "华东第一医院", simulated: true });
    const seen = [training.members[1].status];
    for (let step = 1; step < PARTNER_FLOW.length; step += 1) {
      training = advanceMember(training, "m1");
      seen.push(training.members[1].status);
    }
    expect(seen).toEqual(["invited", "accepted", "ready", "authorized", "confirmed"]);
    expect(training.members[1].node?.spec).toBe("gpu-24");
    expect(training.members[1].data?.name).toBe("指令数据 JSONL");
    expect(advanceMember(training, "m1")).toBe(training);
  });

  it("ignores duplicate or empty invitations", () => {
    const training = inviteMember(project("horizontal-training"), { id: "m1", org: "华东第一医院", simulated: false });
    expect(inviteMember(training, { id: "m2", org: "华东第一医院", simulated: false })).toBe(training);
    expect(inviteMember(training, { id: "m3", org: "  ", simulated: false })).toBe(training);
    expect(availableExampleOrgs(training)).not.toContain("华东第一医院");
  });

  it("confirms our member once a node is bound, or after a delivered node comes online", () => {
    const training = project("horizontal-training");
    expect(bindSelf(training, "p-self", gpuNode, qa).members[0].status).toBe("confirmed");
    const delivering = bindSelf(training, "p-self", newNode, qa);
    expect(delivering.members[0].status).toBe("provisioning");
    expect(readiness(delivering).blockers).toContain("本机构节点正在交付");
    expect(markNodeOnline(delivering, "n3").members[0].status).toBe("confirmed");
  });

  it("adds another own node as a separate party for organization-internal federation", () => {
    const training = addOwnNode(bindSelf(project("horizontal-training"), "p-self", gpuNode, qa), "own1", newNode, qa);
    expect(training.members[1]).toEqual(expect.objectContaining({ org: `${SELF_ORG} · 阿里云-01`, kind: "own-node", status: "provisioning" }));
    expect(addOwnNode(training, "own2", newNode, qa)).toBe(training);
  });

  it("can start once enough parties confirm, leaving unfinished ones out of the run", () => {
    let training = bindSelf(project("horizontal-training"), "p-self", gpuNode, qa);
    training = confirmPartner(training, "华东第一医院", 1);
    expect(readiness(training)).toMatchObject({ confirmed: 2, min: 3, ready: false });
    training = confirmPartner(training, "滨江人民医院", 2);
    training = inviteMember(training, { id: "late", org: "迟到的医院", simulated: false });
    expect(readiness(training)).toMatchObject({ confirmed: 3, ready: true, pending: 1 });
    expect(projectStatus(training)).toBe("ready");

    const started = startProjectRun(training, "run-1", "now");
    expect(started.run?.participants.map((participant) => participant.name)).toEqual([SELF_ORG, "华东第一医院", "滨江人民医院"]);
    expect(projectStatus(started)).toBe("running");
    expect(removeMember(started, "late")).toBe(started);
  });

  it("counts each passed upload of ours as one party in file projects", () => {
    let memory = project("agent-memory", (selection) => choose(selection, "partyScale", "2"));
    memory = confirmPartner(memory, "星图研究院", 1);
    const rows = Array.from({ length: 6 }, (_, index) => JSON.stringify({ content: `经验 ${index}` })).join("\n");
    memory = addUploads(memory, [{ id: "u1", name: "记忆.jsonl", size: rows.length }]);
    expect(readiness(memory).blockers).toContain("有 1 份文件正在检查");
    memory = uploadChecked(memory, "u1", checkUpload(dataContract("memory-jsonl"), { name: "记忆.jsonl", size: rows.length, sample: rows }));
    expect(readiness(memory)).toMatchObject({ confirmed: 2, ready: true });
    expect(runParticipants(memory).map((participant) => participant.source)).toEqual(["partner", "upload"]);
    expect(addUploads(project("horizontal-training"), [{ id: "u2", name: "x.csv", size: 1 }]).uploads).toEqual([]);
  });

  it("resolves delivery recipients from the configured scope", () => {
    let training = bindSelf(project("horizontal-training", (selection) => choose(selection, "deliveryScope", "initiator")), "p-self", gpuNode, qa);
    training = confirmPartner(confirmPartner(training, "A 医院", 1), "B 医院", 2);
    expect(deliveryRecipients(training)).toEqual([SELF_ORG]);

    let all = bindSelf(project("horizontal-training"), "p-self", gpuNode, qa);
    all = confirmPartner(confirmPartner(all, "A 医院", 1), "B 医院", 2);
    expect(deliveryRecipients(all)).toEqual([SELF_ORG, "A 医院", "B 医院"]);

    let selected = bindSelf(project("horizontal-training", (selection) => choose(selection, "deliveryScope", "selected")), "p-self", gpuNode, qa);
    selected = confirmPartner(confirmPartner(selected, "A 医院", 1), "B 医院", 2);
    expect(deliveryRecipients(selected, ["B 医院", "不存在的机构"])).toEqual([SELF_ORG, "B 医院"]);
  });
});

describe("joining a project by invitation", () => {
  const plan = buildRunPlan(applyScenario("vertical-training"));
  if (!plan) throw new Error("plan expected");
  const invitation: Invitation = {
    id: "inv",
    from: "城南银行",
    projectName: "反欺诈联合建模",
    receivedAt: "now",
    plan,
    role: "特征方",
    others: [{ org: "城南银行", role: "标签方" }],
    status: "pending",
  };

  it("creates a participant-side project with the initiator already confirmed", () => {
    const joined = projectFromInvitation(invitation, { id: "j", node: cpuNode, dataset: txn, createdAt: "now" });
    expect(joined.role).toBe("participant");
    expect(joined.initiatorOrg).toBe("城南银行");
    expect(joined.members.map((member) => [member.org, member.role, member.status])).toEqual([
      ["城南银行", "标签方", "confirmed"],
      [SELF_ORG, "特征方", "confirmed"],
    ]);
    expect(readiness(joined).ready).toBe(true);
    expect(projectStatus(joined)).toBe("waiting");
  });
});
