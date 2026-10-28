import { expect, it } from "vitest";
import { checkState } from "./check-state";
import type { components } from "../../api/schema";
const failed: components["schemas"]["TaskCheckOut"] = { id: "old", status: "failed", results: [{ resource: "LLM", field: "models", status: "failed", message: "旧错误" }], createdAt: "2026-10-29T00:00:00Z", finishedAt: null };
it("keeps checking through submit and the first report read without flashing an old error", () => {
  expect(checkState(true, true, false, failed)).toEqual({ running: true, report: undefined });
  expect(checkState(false, true, true)).toEqual({ running: true, report: undefined });
  expect(checkState(false, true, false, { ...failed, status: "running", results: [] }).running).toBe(true);
  const passed = { ...failed, status: "passed" as const, results: [] };
  expect(checkState(false, true, false, passed)).toEqual({ running: false, report: passed });
});
it("only shows actual terminal failures for the current configuration", () => {
  expect(checkState(false, false, false, failed)).toEqual({ running: false, report: undefined });
  expect(checkState(false, true, false, failed)).toEqual({ running: false, report: failed });
});
