import { expect, it } from "vitest";
import { algorithmOf } from "./catalog";
import { withDefaults } from "./config";
import { inResourceScope } from "./resources";
import { groupChoices } from "./task-config/agent-groups";
import { DATASETS, PARTICIPANTS } from "../test/fixtures";
import type { AgentEndpoint } from "../api/agents";

it("共享保留原归属；Agent先选、只列同方且已共享的数据，排除重复系统", () => {
  const agent: AgentEndpoint = {
    id: "agent-a",
    name: "A",
    ownerId: "peer-a",
    ownerName: "协作方A",
    resourceSpace: "public",
    shared: true,
    baseUrl: "https://a.test",
    hasKey: false,
    revision: 1,
    verifications: [{algorithm: "evomedclaw", taskType: "medical-diagnosis", datasetId: "verification-data", current: true,
      report: {id: "check-resource", status: "passed", results: [], createdAt: "2026-10-26T00:00:00Z", finishedAt: "2026-10-26T00:01:00Z"}}],
    capabilities: {
      protocol: "fedagent-agent/1",
      algorithms: {
        evomedclaw: { version: algorithmOf("evomedclaw").version, steps: algorithmOf("evomedclaw").stages.filter((s) => s.side === "participant").map((s) => s.id) },
      },
    },
  };
  const data = DATASETS.slice(0, 2).map((d, i) => ({
    ...d,
    ownerId: i === 0 ? "peer-a" : "peer-b",
    taskType: "medical-diagnosis",
  }));
  const group = {
    key: "one",
    agentId: "",
    datasetId: "",
    participantId: "",
  };
  const draft = withDefaults({
    scenario: "horizontal",
    algorithm: "evomedclaw",
    taskType: "medical-diagnosis",
    agentGroups: [group],
  });
  const choices = (agentId: string, ds = data) =>
    groupChoices(
      { ...group, agentId },
      draft,
      algorithmOf("evomedclaw"),
      [agent],
      ds,
      PARTICIPANTS,
    );
  expect(choices("").datasets).toEqual([]);
  expect(choices(agent.id).datasets.map((d) => d.id)).toEqual([data[0].id]);
  expect(
    choices(
      agent.id,
      data.map((d) => ({ ...d, shared: false })),
    ).datasets,
  ).toEqual([]);
  expect(
    groupChoices(
      group,
      draft,
      algorithmOf("evomedclaw"),
      [{ ...agent, capabilities: null }],
      data,
      PARTICIPANTS,
    ).agents,
  ).toEqual([]);
  const selected = {
    ...draft,
    agentGroups: [{ ...group, key: "another", agentId: agent.id }],
  };
  expect(
    groupChoices(
      group,
      selected,
      algorithmOf("evomedclaw"),
      [agent],
      data,
      PARTICIPANTS,
    ).agents,
  ).toEqual([]);
  const own = { ...agent, resourceSpace: "workspace", shared: true };
  expect(inResourceScope(own, "workspace")).toBe(true);
  expect(inResourceScope(own, "public")).toBe(true);
  expect(inResourceScope({ ...own, shared: false }, "public")).toBe(false);
});
