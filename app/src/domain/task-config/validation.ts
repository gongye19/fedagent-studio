import type { AgentEndpoint } from "../../api/agents";
import { groupChoices } from "./agent-groups";
import { algorithmOf, scenarioOf, type Algorithm } from "../catalog";
import {
  endpointOf,
  isConfigured,
  availableResource,
  modelLabel,
  type Dataset,
  type Endpoint,
  type Participant,
} from "../resources";
import type { Draft, Issue } from "./types";
import { joinable } from "./selection";
import { activeOverrides } from "./serialization";
import { trialSampleIssue } from "./samples";

/** 未知插件字段也要显示错误，不能靠类型断言把问题静默丢掉。 */
export function configIssue(issue: { field: string; message: string }): Issue {
  switch (issue.field) {
    case "scenario":
    case "taskType":
    case "algorithm":
    case "participants":
    case "models":
    case "rounds":
    case "trialCap":
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
  return client === server ? client : `运行 ${client}；汇总 ${server}`;
}

/** 草稿能否创建任务；返回全部未满足的条件，按页面顺序排列。 */
export function draftIssues(
  draft: Draft,
  datasets: readonly Dataset[],
  participants: readonly Participant[],
  endpoints: readonly Endpoint[],
  agents?: readonly AgentEndpoint[],
): Issue[] {
  const issues: Issue[] = [];
  if (!draft.taskType) {
    issues.push({ field: "taskType", message: "选择应用" });
    return issues;
  }
  if (!draft.algorithm) {
    issues.push({ field: "algorithm", message: "选择算法" });
    return issues;
  }
  if (!draft.scenario || scenarioOf(draft.scenario).status !== "available") {
    issues.push({ field: "algorithm", message: "这个算法所属场景尚未可用，请重新选择算法" });
    return issues;
  }
  const algorithm = algorithmOf(draft.algorithm);
  const sampleIssue = trialSampleIssue(draft, datasets);
  if (sampleIssue) issues.push({ field: "trialCap", message: sampleIssue });
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
      message: "该算法需要选择 Agent 接口",
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
        ? `至少选择 ${algorithm.minParticipants} 组可用资源`
        : `至少选择 ${algorithm.minParticipants} 个可用的数据来源`,
    });
  }
  const chosen = joinable(draft, datasets, participants);
  const overrides = activeOverrides(draft);
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
    ...(algorithm.requirements.serverModel
      ? [draft.serverModel]
      : []),
  ];
  if (draft.execution === "agent") {
    for (const [index, group] of draft.agentGroups.entries()) {
      if (agents) {
        const choices = groupChoices(
          group,
          draft,
          algorithm,
          agents,
          datasets,
          participants,
        );
        if (
          (group.agentId && !choices.agent) ||
          (group.datasetId &&
            !choices.datasets.some((d) => d.id === group.datasetId))
        )
          issues.push({
            field: "participants",
            message: `第 ${index + 1} 组资源已失效或取消共享，请重新选择`,
          });
      }
      if (!group.agentId || !group.datasetId)
        issues.push({
          field: "participants",
          message: `请补齐资源 ${index + 1} 的${!group.agentId ? " Agent 接口" : "病例数据"}`,
        });
    }
    const ids = draft.agentGroups.map((g) => g.agentId).filter(Boolean);
    if (new Set(ids).size !== ids.length)
      issues.push({
        field: "models",
        message: "每个参与系统需使用不同的 Agent 接口",
      });
  }
  if (refs.some((ref) => !ref)) {
    issues.push({ field: "models", message: "请选择所需的模型接口" });
  }
  if (
    refs.filter(Boolean).some((ref) => {
      const endpoint = endpointOf(ref, endpoints);
      return (
        !endpoint || !isConfigured(endpoint) || !endpoint.verified || !availableResource(endpoint)
      );
    })
  ) {
    issues.push({
      field: "models",
      message: "所选的模型接口不可用，请到 LLM 接口页完成接入验证后重新选择",
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
