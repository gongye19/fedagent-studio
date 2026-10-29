import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { completedTask } from "../../test/fixtures";
import { ProgressTab } from "./ProgressTab";
import { CaseItem } from "./CaseResults";

it("shows stages vertically with history, without pseudo percentages or ambiguous unit ratios", () => {
  const task = completedTask({ status: "running", cursor: { round: 2, stage: "extract", done: { "p-a": 4, "p-b": 5 }, ticks: 0 } });
  task.members = task.members.map((m) => ({ ...m, problems: 5 }));
  const html = renderToStaticMarkup(<ProgressTab task={task} />);
  expect(html).toContain('aria-label="第 1 轮步骤"');
  expect(html).toContain('aria-label="第 2 轮步骤"');
  expect(html.indexOf("第 1 轮")).toBeLessThan(html.indexOf("第 2 轮"));
  expect(html).toContain("进行中"); expect(html).toContain("未完成"); expect(html).toContain("已完成");
  expect(html).not.toContain("progressbar"); expect(html).not.toContain("%"); expect(html).not.toContain("4 / 5");
  expect(html).not.toContain("通讯"); expect(html).not.toContain("execution-percent");
  expect(html.match(/check-status-spinner/g)).toHaveLength(1);
});
it("does not present batch counters as sample progress, and stops animation after stopping", () => {
  const task = completedTask({ status: "running", cursor: { round: 1, stage: "collect", done: {}, ticks: 0 } });
  for (const status of ["paused", "canceled", "queued", "completed"] as const) {
    task.status = status;
    if (status === "completed") task.cursor = null;
    const html = renderToStaticMarkup(<ProgressTab task={task} />);
    expect(html).not.toContain("check-status-spinner"); expect(html).not.toContain("0 / 1"); expect(html).not.toContain("progressbar");
  }
});
it("locates incorrect answers at grading without claiming the execution step failed", () => {
  const task = completedTask();
  const item = { key: "one", fields: [], round: 1, site: task.members[0].participantId, itemId: "one", step: "solve", outcome: "incorrect" as const, prediction: "<script>unsafe</script>", reference: "2" };
  let html = renderToStaticMarkup(<CaseItem item={item} task={task} />);
  expect(html).toContain("答案未匹配"); expect(html).toContain("解题完成"); expect(html).not.toContain("解题失败"); expect(html).not.toContain("<script>");
  html = renderToStaticMarkup(<CaseItem item={{ ...item, outcome: "error", error: "连接超时" }} task={task} />);
  expect(html).toContain("解题失败"); expect(html).toContain("未完成评测"); expect(html).not.toContain("答案未匹配");
});
