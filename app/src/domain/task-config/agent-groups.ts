import type { AgentEndpoint } from "../../api/agents";
import type { Algorithm } from "../catalog";
import {
  compatibleAgents,
  inResourceScope,
  usable,
  type Dataset,
  type Participant,
  type ResourceSpace,
} from "../resources";
import type { AgentGroup, Draft } from "./types";

export function groupSpace(
  group: AgentGroup,
  agents: readonly AgentEndpoint[],
): ResourceSpace {
  return (
    group.space ??
    (agents.find((a) => a.id === group.agentId)?.resourceSpace === "public"
      ? "public"
      : "workspace")
  );
}

export function groupChoices(
  group: AgentGroup,
  draft: Draft,
  algorithm: Algorithm | null,
  agents: readonly AgentEndpoint[],
  datasets: readonly Dataset[],
  participants: readonly Participant[],
) {
  const space = groupSpace(group, agents);
  const available = compatibleAgents(agents, algorithm).filter((a) =>
    inResourceScope(a, space),
  );
  const agent = available.find((a) => a.id === group.agentId);
  return {
    space,
    agents: available.filter(
      (a) =>
        a.id === group.agentId ||
        !draft.agentGroups.some(
          (g) => g.key !== group.key && g.agentId === a.id,
        ),
    ),
    agent,
    datasets: agent
      ? datasets.filter(
          (d) =>
            inResourceScope(d, space) &&
            d.ownerId === agent.ownerId &&
            d.taskType === draft.taskType &&
            usable(d, participants) &&
            participants.find((p) => p.id === d.participantId)?.hosting ===
              "platform" &&
            !draft.agentGroups.some(
              (g) => g.key !== group.key && g.participantId === d.participantId,
            ),
        )
      : [],
  };
}
