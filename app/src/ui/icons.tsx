/** 统一线宽的小图标，替代 ✓ ✕ ! 这类字符。 */
export type IconName = "check" | "x" | "alert" | "chevron" | "plus" | "minus" | "arrow" | "download" | "pause" | "play" | "stop" | "copy" | "upload" | "home" | "tasks" | "apps" | "manage" | "participants" | "algorithm" | "model" | "search";

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
  home: "M2.5 7 8 2.5 13.5 7M4 6V13H12V6M6.5 13V9H9.5V13",
  tasks: "M6.5 4H13M6.5 8H13M6.5 12H13M2.5 4H3M2.5 8H3M2.5 12H3",
  apps: "M2.5 2.5H6.5V6.5H2.5ZM9.5 2.5H13.5V6.5H9.5ZM2.5 9.5H6.5V13.5H2.5ZM9.5 9.5H13.5V13.5H9.5Z",
  manage: "M3 4H13M3 8H13M3 12H13M6 2.5V5.5M10 6.5V9.5M6 10.5V13.5",
  participants: "M6 2.5A2 2 0 1 0 6 6.5A2 2 0 1 0 6 2.5M2.5 13V11A3.5 3.5 0 0 1 9.5 11V13M10 3A2 2 0 0 1 10 7M11 9A3 3 0 0 1 13.5 12V13",
  algorithm: "M6 2H10V6H6ZM2 10H6V14H2ZM10 10H14V14H10ZM8 6V8M4 10V8H12V10",
  model: "M3 2.5H13V6.5H3ZM3 9.5H13V13.5H3ZM5 4.5H5.5M5 11.5H5.5M9 4.5H11M9 11.5H11",
  search: "M7 2.5A4.5 4.5 0 1 0 7 11.5A4.5 4.5 0 1 0 7 2.5M10.5 10.5 13.5 13.5",
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
