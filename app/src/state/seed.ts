/**
 * 体验模式的初始数据：本机构的节点与数据、两个已有项目和一份收到的邀请。
 *
 * 全部通过领域函数生成（与用户操作走同一套规则），界面上的对方机构都标为"示例"。
 */
import { checkUpload, dataContract } from "../domain/inputs";
import { buildRunPlan } from "../domain/plan";
import {
  advanceMember,
  bindSelf,
  createProject,
  deliverProject,
  deliveryRecipients,
  inviteMember,
  startProjectRun,
  type Dataset,
  type Invitation,
  type Project,
  type WorkspaceNode,
} from "../domain/project";
import { finishStage, nextAutoStage, startStage, type Run } from "../domain/run";
import { EMPTY_SELECTION, applyScenario } from "../domain/selection";
import { stageWork } from "../domain/simulator";
import type { State } from "./store";

const NODES: WorkspaceNode[] = [
  { id: "node-sh-01", name: "上海机房-01", location: "on-prem", spec: "gpu-24", status: "online" },
  { id: "node-bj-02", name: "北京机房-02", location: "on-prem", spec: "cpu-compute", status: "online" },
  { id: "node-hz-01", name: "阿里云-杭州-01", location: "aliyun", spec: "gpu-16", status: "offline" },
];

const DATASETS: Dataset[] = [
  { id: "ds-qa", name: "客服问答指令集", type: "instruction", detail: "3,200 条 · chat 模板" },
  { id: "ds-aftersale", name: "售后工单指令集", type: "instruction", detail: "2,100 条 · chat 模板" },
  { id: "ds-image", name: "门诊影像数据", type: "image", detail: "1,240 张 · 已标注" },
  { id: "ds-credit", name: "客户信用表", type: "table", detail: "58,000 行 · 18 列" },
  { id: "ds-txn", name: "客户交易特征表", type: "vertical-table", detail: "52,000 用户 · 12 个特征 · 含 label 列", hasLabel: true },
  { id: "ds-member", name: "会员消费特征表", type: "vertical-table", detail: "64,000 用户 · 15 个特征", hasLabel: false },
];

function plan(selection: ReturnType<typeof applyScenario>) {
  const result = buildRunPlan(selection);
  if (!result) throw new Error("seed plan expected");
  return result;
}

function invitePartners(project: Project, orgs: string[], confirm: boolean): Project {
  let next = project;
  orgs.forEach((org, index) => {
    next = inviteMember(next, { id: `${project.id}-p${index}`, org, simulated: true, example: true });
    if (confirm) for (let step = 0; step < 4; step += 1) next = advanceMember(next, `${project.id}-p${index}`);
  });
  return next;
}

/** 按模拟器把一次运行从头跑到评测完成。 */
function runToEvaluation(run: Run): Run {
  let current = run;
  let stage = nextAutoStage(current);
  while (stage && stage !== "publish") {
    const started = startStage(current, stage);
    current = finishStage(started, stage, stageWork(stage, started.plan, started.participants));
    stage = nextAutoStage(current);
  }
  return current;
}

/** 已完成的统计分析项目：本机构上传一份汇总表，三个示例统计局参与。 */
function deliveredStatsProject(): Project {
  let project = createProject({
    id: "prj-population",
    name: "多省人口结构统计",
    plan: plan(applyScenario("federated-analytics")),
    createdAt: "2026-09-18T09:30:00+08:00",
  });
  project = invitePartners(project, ["云南省统计局", "安徽省统计局", "浙江省统计局"], true);
  const sample = ["region,age_group,count,sum_age", ...Array.from({ length: 118 }, (_, index) => `地区${index},60+,${800 + index},${52000 + index}`)].join("\n");
  const check = checkUpload(dataContract("summary-table"), { name: "本机构汇总表.csv", size: sample.length, sample });
  project = { ...project, uploads: [{ id: "upload-seed", name: "本机构汇总表.csv", size: sample.length, status: "passed", check }] };
  project = startProjectRun(project, "run-20260918-0930", "2026-09-18T09:42:00+08:00");
  if (project.run) project = { ...project, run: runToEvaluation(project.run) };
  return deliverProject(project, deliveryRecipients(project));
}

/** 组队中的大模型微调项目：本机构节点已绑定，一个示例机构已确认，另一个还在等待接受邀请。 */
function formingLoraProject(): Project {
  let project = createProject({
    id: "prj-lora",
    name: "客服大模型联合微调",
    plan: plan(applyScenario("horizontal-training")),
    createdAt: "2026-09-24T14:10:00+08:00",
  });
  project = bindSelf(project, `${project.id}-self`, NODES[0], DATASETS[0]);
  project = invitePartners(project, ["启明证券研究所"], true);
  return inviteMember(project, { id: `${project.id}-pending`, org: "衡平律师事务所", simulated: false, example: true });
}

function verticalInvitation(): Invitation {
  return {
    id: "inv-antifraud",
    from: "城南银行",
    projectName: "信用卡反欺诈联合建模",
    receivedAt: "2026-09-25T10:05:00+08:00",
    plan: plan(applyScenario("vertical-training")),
    role: "特征方",
    others: [{ org: "城南银行", role: "标签方" }],
    status: "pending",
  };
}

export function seedState(): State {
  return {
    version: 4,
    nodes: NODES.map((node) => ({ ...node })),
    datasets: DATASETS.map((dataset) => ({ ...dataset })),
    projects: [formingLoraProject(), deliveredStatsProject()],
    invitations: [verticalInvitation()],
    draft: EMPTY_SELECTION,
  };
}
