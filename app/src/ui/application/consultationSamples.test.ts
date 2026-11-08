import { describe, expect, it } from "vitest";
import type { ChatMessage, ConsultationSample } from "../../api/consultation";
import { sampleProgress } from "./consultationSamples";

const turn = (content: string): ChatMessage[] => [
  { role: "user", content },
  { role: "assistant", content: "请补充检查资料。" },
];

const samples: ConsultationSample[] = [
  { packageName: "EvoMedClaw", turns: [
    { label: "早产儿惊厥", text: "早产儿的主要症状。" },
    { label: "补充化验结果", text: "这是化验结果。" },
    { label: "补充颅脑超声", text: "这是超声报告。" },
  ] },
  { packageName: "FoT", turns: [
    { label: "多尿、嗜盐", text: "孩子最近总是口渴。" },
    { label: "补充病史和体检", text: "这是既往病史。" },
    { label: "补充电解质结果", text: "这是血电解质结果。" },
  ] },
];
const progress = (messages: ChatMessage[]) => sampleProgress(messages, samples);

describe("问诊样例资料", () => {
  it("按顺序提供早产儿样例的化验和超声资料", () => {
    const history = turn(samples[0].turns[0].text);
    const labs = progress(history)!.next!;
    expect(labs.label).toBe("补充化验结果");

    const afterLabs = [...history, ...turn(labs.text)];
    const ultrasound = progress(afterLabs)!.next!;
    expect(ultrasound.label).toBe("补充颅脑超声");
    expect(progress([...afterLabs, ...turn(ultrasound.text)])).toEqual({ sent: 3, total: 3, next: undefined });
  });

  it("多尿样例在补充病史和电解质后才完成", () => {
    const history = turn(samples[1].turns[0].text);
    const exam = progress(history)!.next!;
    expect(exam.label).toBe("补充病史和体检");

    const afterExam = [...history, ...turn(exam.text)];
    const labs = progress(afterExam)!.next!;
    expect(labs.label).toBe("补充电解质结果");
    expect(progress([...afterExam, ...turn(labs.text)])).toEqual({ sent: 3, total: 3, next: undefined });
    expect(progress([...history, ...turn(labs.text)])).toBeUndefined();
  });

  it("自行改写的对话不带入预设资料", () => {
    expect(progress([])).toBeUndefined();
    expect(progress(turn(`${samples[0].turns[0].text} 另一位患者。`))).toBeUndefined();
    expect(progress([...turn(samples[0].turns[0].text), ...turn("还有什么需要注意？")])).toBeUndefined();
  });
});
