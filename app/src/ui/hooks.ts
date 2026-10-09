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
    // 只移动正常内容，避免 transform 把固定底栏变成相对页面定位。
    const targets = lift ? [element] : Array.from(element.children).filter((child): child is HTMLElement =>
      child instanceof HTMLElement && !child.matches(".toast, .order-bar, dialog"));
    const animations = targets.map((target) => target.animate(
      [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: Number.isFinite(duration) && duration >= 0 ? duration : 240, easing: style.getPropertyValue("--motion-ease").trim() || "ease-out" },
    ));
    const stop = () => { if (preference.matches) animations.forEach((animation) => animation.cancel()); };
    preference.addEventListener("change", stop);
    return () => {
      animations.forEach((animation) => animation.cancel());
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
