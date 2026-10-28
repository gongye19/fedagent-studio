import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { completedTask } from "../../test/fixtures";
import { TaskTable } from "../TaskTable";
import { MetricComparison } from "./MetricComparison";

it("keeps both zero results visible with the actual evaluation denominator", () => {
  const task = completedTask();
  const member = { ...task.members[0], problems: 5, answered: 1 };
  task.members = [member];
  task.rounds = [1, 2].map((round) => ({ ...task.rounds[0], round, correct: { [member.participantId]: 0 } }));
  const html = renderToStaticMarkup(<MetricComparison task={task} latest={2} />);
  expect(html.match(/0\.0%/g)).toHaveLength(2);
  expect(html.match(/匹配 0\/1/g)).toHaveLength(2);
  expect(html).toContain("选用 5 条 · 评测 1 条");
  expect(html).toContain("持平");
  expect(html).toContain("联邦前 · 第 1 轮");
  expect(html).toContain("联邦后 · 第 2 轮");
  task.rounds = [];
  expect(renderToStaticMarkup(<MetricComparison task={task} latest={1} />)).toContain("待评测");
  member.answered = 0;
  expect(renderToStaticMarkup(<MetricComparison task={task} latest={1} />)).toContain("无评测标注");
});

it("shows actual start time separately and never substitutes creation time", () => {
  const task = completedTask({ name: "我的任务", startedAt: null });
  let html = renderToStaticMarkup(<TaskTable tasks={[task]} onDelete={() => {}} />);
  expect(html).toContain("开始时间");
  expect(html).toContain("尚未开始");
  expect(html).not.toContain("创建时间");
  task.startedAt = "2026-10-28T03:25:00Z";
  html = renderToStaticMarkup(<TaskTable tasks={[task]} onDelete={() => {}} />);
  expect(html).toContain('dateTime="2026-10-28T03:25:00Z"');
  expect(html).not.toContain("尚未开始");
});
