import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** 只在导航标识改变时播放，不重新挂载内容，也不随后台轮询重播。 */
export function useContentMotion(key: string, lift = false) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(key);
  useLayoutEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    const element = ref.current;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!element?.animate || preference.matches) return;
    const style = getComputedStyle(element);
    // 构建压缩可能将 180ms 改写为 .18s；Web Animations 的 duration 一律是毫秒。
    const time = style.getPropertyValue("--motion-content").trim();
    const duration = Number.parseFloat(time) * (time.endsWith("ms") ? 1 : 1000);
    // 整页只淡入：transform 会改变新建任务固定底栏的定位基准。
    const animation = element.animate(
      lift
        ? [{ opacity: .65, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }]
        : [{ opacity: .65 }, { opacity: 1 }],
      { duration: Number.isFinite(duration) && duration >= 0 ? duration : 180, easing: style.getPropertyValue("--motion-ease").trim() || "ease-out" },
    );
    const stop = () => { if (preference.matches) animation.cancel(); };
    preference.addEventListener("change", stop);
    return () => {
      animation.cancel();
      preference.removeEventListener("change", stop);
    };
  }, [key, lift]);
  return ref;
}

/** 值停止变化 delay 毫秒后才更新（配置改动时不用每敲一个字就请求一次后端）。 */
export function useDebounced<T>(value: T, delay: number): T {
  const [current, setCurrent] = useState(value);
  const serialized = JSON.stringify(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setCurrent(JSON.parse(serialized) as T), delay);
    return () => window.clearTimeout(timer);
  }, [serialized, delay]);
  return current;
}
