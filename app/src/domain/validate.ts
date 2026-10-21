/**
 * 数据集文件检查（JSONL，每行一条样本），用于问答形式的任务类型（目前是数学推理）。
 * 在浏览器里真实执行：只读文件内容做检查，不上传。
 *
 * 字段要求与 FoT 复现器一致：id、question 必填，answer 可选（只用于评分）。
 * 其他字段（例如复现包里的 agent）保留但不使用。以后登记别的任务类型时，按它的数据格式另写检查。
 */

export type JsonlProblem = { line: number; message: string };

export type JsonlCheck = {
  ok: boolean;
  /** 合格的题目数。 */
  count: number;
  /** 其中带标准答案的题目数。 */
  answered: number;
  problems: JsonlProblem[];
  /** 问题总数（problems 只保留前 MAX_PROBLEMS 条）。 */
  problemCount: number;
  sample?: { question?: string; answer?: string | null; fields?: { label: string; text: string }[] } | null;
};

export const MAX_PROBLEMS = 5;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

function isAnswer(value: unknown): value is string | number {
  return (typeof value === "string" && value.trim() !== "") || (typeof value === "number" && Number.isFinite(value));
}

export function checkJsonl(text: string): JsonlCheck {
  const problems: JsonlProblem[] = [];
  let problemCount = 0;
  const report = (line: number, message: string) => {
    problemCount += 1;
    if (problems.length < MAX_PROBLEMS) problems.push({ line, message });
  };

  const seen = new Map<string, number>();
  let count = 0;
  let answered = 0;
  let sample: JsonlCheck["sample"];

  text.replace(/^\uFEFF/, "").split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;
    let row: unknown;
    try {
      row = JSON.parse(raw);
    } catch {
      report(line, "不是合法的 JSON，检查引号和逗号");
      return;
    }
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      report(line, "每行应是一个 JSON 对象");
      return;
    }
    const record = row as Record<string, unknown>;
    const id = record.id;
    if (!(typeof id === "string" && id.trim()) && !(typeof id === "number" && Number.isFinite(id))) {
      report(line, "缺少 id");
      return;
    }
    if (typeof record.question !== "string" || !record.question.trim()) {
      report(line, "缺少 question，或 question 不是文本");
      return;
    }
    if (record.answer !== undefined && record.answer !== null && !isAnswer(record.answer)) {
      report(line, "answer 应是文本或数字");
      return;
    }
    const key = String(id);
    const first = seen.get(key);
    if (first !== undefined) {
      report(line, `id 与第 ${first} 行重复`);
      return;
    }
    seen.set(key, line);
    count += 1;
    const hasAnswer = isAnswer(record.answer);
    if (hasAnswer) answered += 1;
    if (!sample) sample = { question: record.question.trim(), answer: hasAnswer ? String(record.answer) : undefined };
  });

  if (count === 0 && problemCount === 0) report(0, "文件里没有题目");
  return { ok: problemCount === 0 && count > 0, count, answered, problems, problemCount, sample };
}

export function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
