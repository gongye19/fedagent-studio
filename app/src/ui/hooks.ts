import { useEffect, useState } from "react";

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
