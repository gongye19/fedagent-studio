import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { completedTask } from "../../test/fixtures";
import { evaluationLabel, scoreDifference } from "../../domain/task";
import { ComparisonCase } from "./CaseComparisons";
import { trendData } from "./trend";

it("uses frozen group names and separates local gain from federation gain", () => {
  const task = completedTask({ evaluationLabels: ["无经验", "本地经验", "联邦经验"] });
  task.config.rounds = 3;
  task.members = [{ ...task.members[0], participantId: "a", answered: 10 }];
  task.rounds = [{ round: 1, correct: { a: 5 } }, { round: 2, correct: { a: 7 } }, { round: 3, correct: { a: 6 } }];
  expect(scoreDifference(task, 1, 2)).toBeCloseTo(.2);
  expect(scoreDifference(task, 2, 3)).toBeCloseTo(-.1);
  expect(trendData(task).labels).toEqual(["无经验", "本地经验", "联邦经验"]);
  expect(trendData(task).comparison).toBe(true);
  task.evaluationLabels = [];
  expect(evaluationLabel(task, 2)).toBe("第 2 轮");
  expect(trendData(task).comparison).toBe(false);
});

it("pairs the same case across groups and preserves failed and pending answers", () => {
  const task = completedTask({ evaluationLabels: ["无经验", "本地经验", "联邦经验"] });
  const base = { key: "1", site: task.members[0].participantId, itemId: "case-1", step: "diagnose", fields: [], input: "patient", reference: "reference", error: null };
  const html = renderToStaticMarkup(<ComparisonCase task={task} item={{ key: "row", site: base.site, itemId: base.itemId, cases: [
    { ...base, round: 1, outcome: "incorrect", prediction: "wrong" },
    { ...base, key: "2", round: 2, outcome: "passed", prediction: "right" },
  ] }} />);
  expect(html).toContain("wrong"); expect(html).toContain("right"); expect(html).toContain("尚未完成");
  expect(html).toContain("无经验"); expect(html).toContain("联邦经验");
  expect(html).not.toContain("第 3 轮");
});
