const DATE = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE.format(date);
}

const NUMBER = new Intl.NumberFormat("zh-CN");

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}
