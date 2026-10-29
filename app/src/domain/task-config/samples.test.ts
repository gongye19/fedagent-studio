import { expect, it } from "vitest";
import { DATASETS } from "../../test/fixtures";
import { toConfig, withDefaults } from "../config";
import { trialSampleBounds, trialSampleIssue } from "./samples";

it("allows an empty edit without submitting an old sample count, then accepts replacement", () => {
  const draft = withDefaults({ scenario: "horizontal", algorithm: "fot", taskType: "math-reasoning", trialCap: "" });
  expect(trialSampleIssue(draft, DATASETS)).toContain("请输入");
  expect(toConfig(draft)).toBeNull();
  draft.trialCap = 12;
  expect(toConfig(draft)?.trialCap).toBe(12);
  draft.mode = "full"; draft.trialCap = "";
  expect(trialSampleIssue(draft, DATASETS)).toBeNull();
  expect(toConfig(draft)).not.toBeNull();
});

it("uses the smallest selected dataset as the limit for both data and Agent selections", () => {
  const datasets = DATASETS.slice(0, 2).map((d, i) => ({ ...d, count: [30, 8][i] }));
  const participants = datasets.map((d) => ({ participantId: d.participantId, datasetId: d.id }));
  const draft = withDefaults({ algorithm: "fot", participants, trialCap: 9 });
  expect(trialSampleBounds(draft, datasets)).toEqual({ min: 1, max: 8 });
  expect(trialSampleIssue(draft, datasets)).toContain("最多 8 条");
  draft.trialCap = 8;
  expect(trialSampleIssue(draft, datasets)).toBeNull();
  draft.execution = "agent";
  draft.participants = [];
  draft.agentGroups = participants.map((p) => ({ ...p, key: p.datasetId, agentId: "a" }));
  expect(trialSampleBounds(draft, datasets).max).toBe(8);
  draft.agentGroups = [];
  expect(trialSampleBounds(draft, datasets).max).toBeNull();
});
