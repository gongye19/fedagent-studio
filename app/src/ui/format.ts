const DATE = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE.format(date);
}

const NUMBER = new Intl.NumberFormat("zh-CN");

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

export function formatPercent(value: number | null, digits = 1): string {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

/** 两个比例之差，以百分点表示；compact 只给数字，单位写在表头。 */
export function formatDelta(value: number | null, options: { compact?: boolean } = {}): string {
  if (value === null) return "—";
  const points = value * 100;
  if (Math.abs(points) < 0.05) return "持平";
  const number = `${points > 0 ? "+" : "−"}${Math.abs(points).toFixed(1)}`;
  return options.compact ? number : `${number} 个百分点`;
}

export function formatTokens(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`;
  if (value >= 10_000) return `${formatNumber(Math.round(value / 10_000))} 万`;
  return formatNumber(Math.round(value));
}

export function formatDuration(seconds: number): string {
  if (seconds < 90) return `约 ${Math.max(1, Math.round(seconds))} 秒`;
  const minutes = seconds / 60;
  if (minutes < 90) return `约 ${Math.round(minutes)} 分钟`;
  return `约 ${(minutes / 60).toFixed(1)} 小时`;
}

export function formatYuan(value: number | null): string {
  if (value === null) return "—";
  return value < 1 ? `约 ¥${value.toFixed(2)}` : `约 ¥${formatNumber(Math.round(value))}`;
}
