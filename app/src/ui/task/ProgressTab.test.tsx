import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { completedTask } from "../../test/fixtures";
import { ProgressTab } from "./ProgressTab";
import { CaseItem } from "./CaseResults";

it("uses real progress with animation only while running and removes communication/nested process UI", () => {
  const task = completedTask();
  let html = renderToStaticMarkup(<ProgressTab task={task} />);
  expect(html).toContain("100%");
  expect(html).not.toContain("execution-progress--active");
  expect(html).not.toContain("通讯"); expect(html).not.toContain("执行过程");
  task.status = "paused"; task.cursor = { round: 1, stage: "solve", done: {}, ticks: 0 };
  html = renderToStaticMarkup(<ProgressTab task={task} />);
  expect(html).toContain("已暂停"); expect(html).not.toContain("check-status-spinner"); expect(html).not.toContain("100%");
  task.status = "running";
  expect(renderToStaticMarkup(<ProgressTab task={task} />)).toContain("execution-progress--active");
});
it("locates incorrect answers at grading without claiming the execution step failed", () => {
  const task = completedTask();
  const item = { key: "one", fields: [], round: 1, site: task.members[0].participantId, itemId: "one", step: "solve", outcome: "incorrect" as const, prediction: "<script>unsafe</script>", reference: "2" };
  let html = renderToStaticMarkup(<CaseItem item={item} task={task} />);
  expect(html).toContain("答案未匹配"); expect(html).toContain("解题完成"); expect(html).not.toContain("解题失败"); expect(html).not.toContain("<script>");
  html = renderToStaticMarkup(<CaseItem item={{ ...item, outcome: "error", error: "连接超时" }} task={task} />);
  expect(html).toContain("解题失败"); expect(html).toContain("未完成评测"); expect(html).not.toContain("答案未匹配");
});
