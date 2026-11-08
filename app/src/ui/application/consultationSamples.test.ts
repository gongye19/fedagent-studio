import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../api/consultation";
import { SAMPLE_QUESTIONS, nextSampleDetail } from "./consultationSamples";

const turn = (content: string): ChatMessage[] => [
  { role: "user", content },
  { role: "assistant", content: "请补充检查资料。" },
];

describe("问诊样例资料", () => {
  it("按顺序提供早产儿样例的化验和超声资料", () => {
    const history = turn(SAMPLE_QUESTIONS[0].text);
    const labs = nextSampleDetail(history)!;
    expect(labs.label).toBe("补充化验结果");

    const afterLabs = [...history, ...turn(labs.text)];
    const ultrasound = nextSampleDetail(afterLabs)!;
    expect(ultrasound.label).toBe("补充颅脑超声");
    expect(nextSampleDetail([...afterLabs, ...turn(ultrasound.text)])).toBeUndefined();
  });

  it("其他病例或自行改写的对话不带入早产儿资料", () => {
    expect(nextSampleDetail([])).toBeUndefined();
    expect(nextSampleDetail(turn(SAMPLE_QUESTIONS[1].text))).toBeUndefined();
    expect(nextSampleDetail(turn(`${SAMPLE_QUESTIONS[0].text} Different patient.`))).toBeUndefined();
    expect(nextSampleDetail([...turn(SAMPLE_QUESTIONS[0].text), ...turn("还有什么需要注意？")])).toBeUndefined();
  });
});
