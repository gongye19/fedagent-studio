import { algorithmOf, scenarioOf, type Algorithm } from "../catalog";
import {
  endpointOf,
  modelLabel,
  type Dataset,
  type Endpoint,
  type Participant,
} from "../resources";
import type { Draft, Issue } from "./types";
import { joinable } from "./selection";
import { activeOverrides } from "./serialization";

/** 未知插件字段也要显示错误，不能靠类型断言把问题静默丢掉。 */
export function configIssue(issue: { field: string; message: string }): Issue {
  switch (issue.field) {
    case "scenario":
    case "taskType":
    case "algorithm":
    case "participants":
    case "models":
    case "rounds":
    case "params":
    case "check":
      return { field: issue.field, message: issue.message };
    default:
      return { field: "params", message: issue.message };
  }
}

export function taskModelSummary(
  draft: Draft,
  endpoints: readonly Endpoint[],
  algorithm: Algorithm,
): string {
  const client =
    draft.execution === "agent"
      ? "自有 Agent"
      : modelLabel(draft.clientModel, endpoints);
  if (!algorithm.requirements.serverModel) return client;
  const server = modelLabel(draft.serverModel, endpoints);
  return client === server ? client : `参与方 ${client}；服务端 ${server}`;
}

/** 草稿能否创建任务；返回全部未满足的条件，按页面顺序排列。 */
export function draftIssues(
  draft: Draft,
  datasets: readonly Dataset[],
  participants: readonly Participant[],
  endpoints: readonly Endpoint[],
): Issue[] {
  const issues: Issue[] = [];
  if (!draft.scenario) {
    issues.push({ field: "scenario", message: "选择场景" });
    return issues;
  }
  if (scenarioOf(draft.scenario).status !== "available") {
    issues.push({ field: "scenario", message: "这个场景的算法还在规划中" });
    return issues;
  }
  if (!draft.algorithm) {
    issues.push({ field: "algorithm", message: "选择算法" });
    return issues;
  }
  if (!draft.taskType) {
    issues.push({ field: "taskType", message: "选择任务类型" });
    return issues;
  }
  const algorithm = algorithmOf(draft.algorithm);
  if (
    draft.execution === "agent" &&
    !algorithm.requirements.executionModes.includes("agent")
  ) {
    issues.push({
      field: "models",
      message: "该算法使用数据与 LLM，由平台执行流程，无需 Agent 接口",
    });
  }
  if (algorithm.requirements.agentRequired && draft.execution !== "agent") {
    issues.push({
      field: "models",
      message: "该算法需要选择自己的 Agent 接口",
    });
  }
  if (
    algorithm.scenario !== draft.scenario ||
    !algorithm.accepts.includes(draft.taskType)
  ) {
    issues.push({ field: "algorithm", message: "所选算法不支持这种任务类型" });
    return issues;
  }
  if (
    joinable(draft, datasets, participants).length < algorithm.minParticipants
  ) {
    issues.push({
      field: "participants",
      message: algorithm.requirements.agentRequired
        ? `至少选择 ${algorithm.minParticipants} 组数据与 Agent 接入`
        : `至少选择 ${algorithm.minParticipants} 个可用的数据来源`,
    });
  }
  const chosen = joinable(draft, datasets, participants);
  const overrides = activeOverrides(draft);
  if (
    draft.mode === "full" &&
    chosen.length &&
    !chosen.some(
      (p) =>
        datasets.find((d) => d.id === p.datasetId)?.resourceSpace ===
        "workspace",
    )
  ) {
    issues.push({
      field: "participants",
      message: "正式任务至少需要一份我的数据；公用数据可以先用于试跑",
    });
  }
  const refs = [
    ...(algorithm.requirements.participantModel && draft.execution !== "agent"
      ? chosen
          .filter(
            (p) =>
              participants.find((owner) => owner.id === p.participantId)
                ?.hosting === "platform",
          )
          .map((p) => overrides[p.participantId] || draft.clientModel)
      : []),
    ...(algorithm.stages.some((stage) => stage.side === "server" && stage.model)
      ? [draft.serverModel]
      : []),
  ];
  if (draft.execution === "agent") {
    for (const p of chosen) {
      const d = datasets.find((d) => d.id === p.datasetId);
      if (
        !(algorithm.requirements.agentRequired
          ? d?.agentId
          : draft.agentOverrides?.[p.participantId] ||
            d?.agentId ||
            draft.agentId)
      )
        issues.push({
          field: "models",
          message: `请为“${d?.name ?? "所选数据"}”绑定 Agent 接口`,
        });
    }
  }
  if (refs.some((ref) => !endpointOf(ref, endpoints))) {
    issues.push({
      field: "models",
      message: "所选的模型接口已不存在，请重新选择",
    });
  }
  if (
    draft.rounds < algorithm.minRounds ||
    draft.rounds > algorithm.maxRounds
  ) {
    issues.push({
      field: "rounds",
      message: `轮次在 ${algorithm.minRounds}–${algorithm.maxRounds} 之间`,
    });
  }
  return issues;
}
