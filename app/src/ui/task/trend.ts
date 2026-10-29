import { accuracy, averageAccuracy, roundOf, type Task } from "../../domain/task";

export const TREND_COLORS = ["#2563eb", "#0891b2", "#9333ea", "#d97706", "#059669", "#e11d48", "#4f46e5", "#64748b"];

/** 保留尚未评测的空点与实际分母；不补零、不平滑、不改变宏平均。 */
export function trendData(task: Task) {
  const rounds = Array.from({ length: task.config.rounds }, (_, i) => i + 1);
  return {
    rounds,
    comparison: Boolean(task.evaluationLabels?.length),
    labels: rounds.map((r) => task.evaluationLabels?.[r - 1] ?? `第${r}轮`),
    series: [
      { id: "average", name: "整体平均", color: "#182338", values: rounds.map((r) => averageAccuracy(task, r)), counts: rounds.map(() => "各方等权平均") },
      ...task.members.map((member, i) => ({
        id: member.participantId, name: member.agentName || member.participant,
        color: TREND_COLORS[i % TREND_COLORS.length],
        values: rounds.map((r) => accuracy(task, member, r)),
        counts: rounds.map((r) => {
          const correct = roundOf(task, r)?.correct?.[member.participantId];
          return !member.answered ? "无评测标注" : correct === undefined ? "待评测" : `匹配 ${correct}/${member.answered}`;
        }),
      })),
    ],
  };
}
