import { describe, expect, it } from "vitest";
import { checkJsonl, MAX_PROBLEMS } from "./validate";

describe("checkJsonl", () => {
  it("accepts rows with id and question; answer is optional", () => {
    const text = [
      JSON.stringify({ id: "q1", question: "1 + 1 = ?", answer: "2" }),
      "",
      JSON.stringify({ id: 2, question: "Prove that sqrt(2) is irrational." }),
    ].join("\n");
    const result = checkJsonl(text);
    expect(result).toMatchObject({ ok: true, count: 2, answered: 1, problemCount: 0 });
    expect(result.sample).toEqual({ question: "1 + 1 = ?", answer: "2" });
  });

  it("reports each bad line with its line number", () => {
    const text = [
      "{not json",
      JSON.stringify({ id: "a", question: "" }),
      JSON.stringify({ question: "no id" }),
      JSON.stringify({ id: "b", question: "ok", answer: { value: 1 } }),
      JSON.stringify({ id: "c", question: "ok" }),
      JSON.stringify({ id: "c", question: "again" }),
      "[1, 2]",
    ].join("\n");
    const result = checkJsonl(text);
    expect(result.ok).toBe(false);
    expect(result.count).toBe(1);
    expect(result.problemCount).toBe(6);
    expect(result.problems).toHaveLength(MAX_PROBLEMS);
    expect(result.problems.map((problem) => problem.line)).toEqual([1, 2, 3, 4, 6]);
    expect(result.problems[4].message).toBe("id 与第 5 行重复");
  });

  it("rejects an empty file", () => {
    const result = checkJsonl("\n\n");
    expect(result.ok).toBe(false);
    expect(result.problems[0].message).toBe("文件里没有题目");
  });
});

it("accepts UTF-8 BOM as the server does", () => {
  expect(checkJsonl('\uFEFF{"id":"1","question":"1+1?","answer":0}\n').ok).toBe(true);
});
