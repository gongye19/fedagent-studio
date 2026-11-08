import type { ChatMessage } from "../../api/consultation";

const PRETERM_SAMPLE = [
  {
    label: "早产儿惊厥",
    text: "医生，宝宝胎龄 31 周早产，出生才 3 天，出生体重 1100 克。我产前有绒毛膜羊膜炎。宝宝这 18 小时越来越嗜睡，刚刚全身僵直抽搐了约 25 秒，前囟发紧、肌张力偏低，呼吸也不规则。请问该看哪个科，优先考虑什么？",
  },
  {
    label: "补充化验结果",
    text: "化验显示 C 反应蛋白升高，白细胞略高，血红蛋白正常。还没做头部影像，下一步最需要查什么？",
  },
  {
    label: "补充颅脑超声",
    text: "刚做了颅脑超声，报告说脑室内有出血。结合前面的情况，现在最可能是什么？",
  },
];

const BARTTER_SAMPLE = {
  label: "9 岁男孩多尿、嗜盐",
  text: "医生，我儿子 9 岁，近几个月总觉得没力气，喝水和小便都比以前多，还特别爱吃咸的。他从小容易便秘，身高体重也比同龄孩子低。想问应该挂什么科，先考虑什么原因？",
};

const SAMPLE_CASES = [
  { turns: PRETERM_SAMPLE, packageName: "EvoMedClaw" },
  { turns: [BARTTER_SAMPLE], packageName: "FoT" },
];

export const SAMPLE_QUESTIONS = SAMPLE_CASES.map(({ turns, packageName }) => ({ ...turns[0], packageName }));

export function sampleProgress(messages: readonly ChatMessage[]) {
  const userTurns = messages.filter(({ role }) => role === "user");
  if (!userTurns.length) return undefined;
  const sample = SAMPLE_CASES.find(({ turns }) => userTurns.every(({ content }, index) => content === turns[index]?.text));
  if (!sample) return undefined;
  return { sent: userTurns.length, total: sample.turns.length, next: sample.turns.at(userTurns.length) };
}
