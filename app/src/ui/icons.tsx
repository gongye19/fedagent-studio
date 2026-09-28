/** 统一线宽的小图标，替代 ✓ ✕ ! 这类字符。 */
export type IconName = "check" | "x" | "alert" | "chevron" | "plus" | "minus" | "arrow" | "download" | "pause" | "play" | "stop" | "copy" | "upload";

const PATHS: Record<IconName, string> = {
  check: "M3.5 8.5 6.5 11.5 12.5 4.5",
  x: "M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5",
  alert: "M8 3.5V9M8 11.75V12",
  chevron: "M6 3.5 10.5 8 6 12.5",
  plus: "M8 3.5V12.5M3.5 8H12.5",
  minus: "M3.5 8H12.5",
  arrow: "M3 8H13M9.5 4.5 13 8 9.5 11.5",
  download: "M8 2.5V10M4.75 7 8 10.25 11.25 7M3 13H13",
  pause: "M5.5 3.5V12.5M10.5 3.5V12.5",
  play: "M5 3.5 12 8 5 12.5Z",
  stop: "M4.5 4.5H11.5V11.5H4.5Z",
  copy: "M5.5 5.5H12.5V12.5H5.5ZM3.5 10.5V3.5H10.5",
  upload: "M8 10.5V3M4.75 6.25 8 3 11.25 6.25M3 13H13",
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
