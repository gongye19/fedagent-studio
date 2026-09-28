import { describe, expect, it } from "vitest";
import { SELF_ORG, projectStatus, readiness } from "../domain/project";
import { stageOf } from "../domain/run";
import { EMPTY_SELECTION } from "../domain/selection";
import { parseHash } from "./route";
import { sanitize } from "./persistence";
import { seedState } from "./seed";
import { pendingEvents } from "./simulation";
import { NEW_NODE, eligibleNodes, projectOf, reducer, type Action, type State } from "./store";

const apply = (state: State, actions: Action[]) => actions.reduce(reducer, state);

/** 把所有模拟事件立即执行，直到没有新事件（上限防止死循环）。 */
function settle(state: State, limit = 200): State {
  let current = state;
  for (let index = 0; index < limit; index += 1) {
    const [event] = pendingEvents(current);
    if (!event) return current;
    current = reducer(current, event.action());
  }
  return current;
}

const created = (state: State) => state.projects[0];

describe("seeded demo", () => {
  it("provides nodes, data, a forming project, a delivered project and an invitation", () => {
    const state = seedState();
    expect(state.nodes.map((node) => node.status)).toEqual(["online", "online", "offline"]);
    expect(state.projects.map((project) => projectStatus(project))).toEqual(["forming", "delivered"]);
    expect(readiness(state.projects[0])).toMatchObject({ confirmed: 2, min: 3 });
    expect(state.invitations[0]).toMatchObject({ from: "城南银行", status: "pending", role: "特征方" });
    expect(stageOf(state.projects[1].run!, "publish").status).toBe("done");
  });
});

describe("creating and running a project", () => {
  const configured = apply(seedState(), [
    { type: "choose", item: "scenario", value: "horizontal-training" },
    { type: "choose", item: "rounds", value: "20" },
    { type: "createProject", id: "prj-new", name: "  ", createdAt: "2026-09-28T10:00:00+08:00" },
  ]);

  it("freezes the draft into a project and clears the draft", () => {
    expect(created(configured)).toMatchObject({ id: "prj-new", name: "横向联邦训练", role: "initiator" });
    expect(created(configured).plan.rounds.value).toBe(20);
    expect(configured.draft).toEqual(EMPTY_SELECTION);
  });

  it("only offers our online nodes that meet the required spec", () => {
    expect(eligibleNodes(configured, created(configured)).map((node) => node.id)).toEqual(["node-sh-01"]);
  });

  it("delivers a new node, confirms us once it is online, and runs after partners confirm", () => {
    let state = apply(configured, [
      { type: "bindSelf", projectId: "prj-new", memberId: "prj-new-self", node: NEW_NODE, datasetId: "ds-qa", newNodeId: "node-new" },
      { type: "invite", projectId: "prj-new", memberId: "m1", org: "华东第一医院", simulated: true, example: true },
      { type: "invite", projectId: "prj-new", memberId: "m2", org: "衡平律师事务所", simulated: false },
    ]);
    expect(state.nodes.find((node) => node.id === "node-new")).toMatchObject({ name: "阿里云-02", spec: "gpu-24", status: "provisioning" });
    expect(created(state).members[0].status).toBe("provisioning");

    state = settle(state);
    expect(created(state).members.map((member) => member.status)).toEqual(["confirmed", "confirmed", "invited"]);
    expect(reducer(state, { type: "startRun", projectId: "prj-new", runId: "run-x", createdAt: "now" })).toBe(state);

    state = settle(reducer(state, { type: "simulateMember", projectId: "prj-new", memberId: "m2" }));
    expect(readiness(created(state)).ready).toBe(true);

    state = settle(reducer(state, { type: "startRun", projectId: "prj-new", runId: "run-x", createdAt: "now" }));
    expect(projectStatus(created(state))).toBe("awaiting-delivery");
    state = reducer(state, { type: "deliver", projectId: "prj-new", recipients: [SELF_ORG, "华东第一医院"] });
    expect(projectStatus(created(state))).toBe("delivered");
  });

  it("adds another own node for organization-internal federation", () => {
    const state = settle(apply(configured, [
      { type: "bindSelf", projectId: "prj-new", memberId: "prj-new-self", node: "node-sh-01", datasetId: "ds-qa", newNodeId: "unused" },
      { type: "addOwnNode", projectId: "prj-new", memberId: "own", node: NEW_NODE, datasetId: "ds-aftersale", newNodeId: "node-own" },
    ]));
    expect(created(state).members.map((member) => [member.kind, member.status])).toEqual([["self", "confirmed"], ["own-node", "confirmed"]]);
  });

  it("refuses to bind an offline or under-spec node", () => {
    expect(reducer(configured, { type: "bindSelf", projectId: "prj-new", memberId: "prj-new-self", node: "node-bj-02", datasetId: "ds-qa", newNodeId: "x" })).toBe(configured);
    expect(reducer(configured, { type: "bindSelf", projectId: "prj-new", memberId: "prj-new-self", node: "node-hz-01", datasetId: "ds-qa", newNodeId: "x" })).toBe(configured);
  });
});

describe("invitations", () => {
  it("accepting creates a participant project that the initiator starts and delivers", () => {
    let state = reducer(seedState(), {
      type: "acceptInvitation",
      invitationId: "inv-antifraud",
      projectId: "prj-joined",
      node: "node-bj-02",
      datasetId: "ds-member",
      newNodeId: "unused",
      createdAt: "now",
    });
    expect(state.invitations[0]).toMatchObject({ status: "accepted", projectId: "prj-joined" });
    expect(projectStatus(projectOf(state, "prj-joined")!)).toBe("waiting");

    state = settle(state);
    const joined = projectOf(state, "prj-joined")!;
    expect(projectStatus(joined)).toBe("delivered");
    expect(joined.run?.artifact?.recipients).toEqual(["城南银行", SELF_ORG]);
  });

  it("can decline a pending invitation", () => {
    const state = reducer(seedState(), { type: "declineInvitation", invitationId: "inv-antifraud" });
    expect(state.invitations[0].status).toBe("declined");
  });
});

describe("routing and persistence", () => {
  it("parses hash routes", () => {
    expect(parseHash("")).toEqual({ page: "workbench" });
    expect(parseHash("#/new")).toEqual({ page: "new" });
    expect(parseHash("#/projects/prj-lora")).toEqual({ page: "project", id: "prj-lora" });
    expect(parseHash("#/invites/inv-antifraud")).toEqual({ page: "invitation", id: "inv-antifraud" });
  });

  it("drops uploads that were still being checked when the page was closed", () => {
    const state = seedState();
    const project = { ...state.projects[1], uploads: [...state.projects[1].uploads, { id: "u", name: "x.csv", size: 1, status: "checking" as const, check: null }] };
    const restored = sanitize({ ...state, projects: [state.projects[0], project] });
    expect(restored.projects[1].uploads.map((upload) => upload.status)).toEqual(["passed"]);
  });
});
