import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { completedTask } from "../../test/fixtures";
import { TaskTable } from "../TaskTable";
import { trendData } from "./trend";

it("preserves zero, missing rounds and actual denominators in unsmoothed round data", () => {
  const task = completedTask();
  const member = { ...task.members[0], problems: 5, answered: 1 };
  task.members = [member]; task.config.rounds = 3;
  task.rounds = [1, 2].map((round) => ({ ...task.rounds[0], round, correct: { [member.participantId]: 0 } }));
  const data = trendData(task);
  expect(data.series[1].values).toEqual([0, 0, null]);
  expect(data.series[1].counts).toEqual(["匹配 0/1", "匹配 0/1", "待评测"]);
  member.answered = 0;
  expect(trendData(task).series[1].values).toEqual([null, null, null]);
  expect(trendData(task).series[1].counts[0]).toBe("无评测标注");
});

it("retains equally weighted site average instead of pooling unequal sample counts", () => {
  const task = completedTask();
  task.members = [{ ...task.members[0], participantId: "a", answered: 1 }, { ...task.members[0], participantId: "b", answered: 4 }];
  task.rounds = [{ round: 1, correct: { a: 0, b: 4 } }];
  expect(trendData(task).series[0].values[0]).toBe(.5);
});

it("shows actual start time separately and never substitutes creation time", () => {
  const task = completedTask({ name: "我的任务", startedAt: null });
  let html = renderToStaticMarkup(<TaskTable tasks={[task]} onDelete={() => {}} />);
  expect(html).toContain("开始时间"); expect(html).toContain("尚未开始"); expect(html).not.toContain("创建时间");
  task.startedAt = "2026-10-28T03:25:00Z";
  html = renderToStaticMarkup(<TaskTable tasks={[task]} onDelete={() => {}} />);
  expect(html).toContain('dateTime="2026-10-28T03:25:00Z"'); expect(html).not.toContain("尚未开始");
});

it("keeps the frozen grading rule and only shows a model for model-based grading", async () => {
  const { ConfigTab } = await import("./ConfigTab"); const { withDefaults } = await import("../../domain/config"); const { ENDPOINTS } = await import("../../test/fixtures");
  const task = completedTask();
  task.config = { ...task.config, algorithm: "evomedclaw", taskType: "medical-diagnosis", execution: "agent", grader: "diagnosis-clinical", serverModel: "fake:fake" };
  const state = { tasks: [task], participants: [], datasets: [], endpoints: ENDPOINTS, agents: [], published: [], draft: withDefaults({}) };
  let html = renderToStaticMarkup(<ConfigTab task={task} state={state} />);
  expect(html).toContain("评测模型"); expect(html).toContain("原版诊断判分");
  task.config = { ...task.config, grader: "diagnosis-exact", serverModel: "" };
  html = renderToStaticMarkup(<ConfigTab task={task} state={state} />);
  expect(html).not.toContain("评测模型"); expect(html).toContain("诊断名称匹配");
});
