/** 统一线宽的小图标，替代 ✓ ✕ ! 这类字符。 */
export type IconName = "check" | "x" | "alert";

const PATHS: Record<IconName, string> = {
  check: "M3.5 8.5 6.5 11.5 12.5 4.5",
  x: "M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5",
  alert: "M8 3.5V9M8 11.75V12",
};

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    <svg
      className={`icon icon--${name}`}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
