import type { AgentEndpoint } from "../../api/agents";
import type { Algorithm } from "../catalog";
import {
  compatibleAgents,
  availableResource,
  usable,
  type Dataset,
  type Participant,
} from "../resources";
import type { AgentGroup, Draft } from "./types";

export function groupChoices(
  group: AgentGroup,
  draft: Draft,
  algorithm: Algorithm | null,
  agents: readonly AgentEndpoint[],
  datasets: readonly Dataset[],
  participants: readonly Participant[],
) {
  const available = compatibleAgents(agents, algorithm, draft.taskType);
  const agent = available.find((a) => a.id === group.agentId);
  return {
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
            availableResource(d) &&
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
