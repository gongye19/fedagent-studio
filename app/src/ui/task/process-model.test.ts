import { expect, it } from "vitest";
import type { ProcessEvent } from "../../api/process";
import { activitiesOf, activityState, summaryState } from "./process-model";

const event = (id: number, origin: string, status: "running" | "completed"): ProcessEvent => ({ id, origin, site: "a", round: 1, step: "x", unit: "one", at: `2026-10-28T00:00:0${id}Z`, event: { activity: "doctor", title: "问诊", status, summary: "", detail: "" } });
it("replaces an activity status without duplicating rows or mixing retries", () => {
  const result = activitiesOf([event(1, "first", "running"), event(2, "first", "completed"), event(3, "retry", "running")]);
  expect(result).toHaveLength(2); expect(result[0].startedAt).toBe("2026-10-28T00:00:01Z"); expect(result[0].event.status).toBe("completed");
});
it("stops spinners on pause, cancel, failure, abandoned retries and missing completion", () => {
  const a = activitiesOf([event(1, "one", "running")])[0];
  expect(activityState(a, "paused")).toBe("paused"); expect(activityState(a, "canceled")).toBe("canceled");
  expect(activityState(a, "completed")).toBe("interrupted");
  expect(activityState({ ...a, executionStatus: "superseded" }, "running")).toBe("failed");
  expect(activityState({ ...a, executionStatus: "canceled" }, "running")).toBe("canceled");
});

it("keeps a completed action truthful while the containing service run has failed", () => {
  const a = { ...activitiesOf([event(1, "one", "completed")])[0], executionStatus: "failed" };
  expect(activityState(a, "paused")).toBe("completed");
  expect(summaryState(a, "paused")).toBe("failed");
});
