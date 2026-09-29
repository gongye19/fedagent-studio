/**
 * 页面顶部的提示条：创建、保存、上传、发布之后告诉用户结果。
 * 提示属于它显示的那一页（按 pageKeyOf 判断）：同一页里展开行、切换标签时保留，换到别的页就收起。
 * 通常先 showFlash(目标页, …)，紧接着 navigate(目标页)。
 */
import { useSyncExternalStore } from "react";
import { pageKeyOf, type Route } from "./route";

export type Flash = { text: string; link?: { label: string; route: Route }; page: string };

let current: Flash | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function showFlash(route: Route, text: string, link?: Flash["link"]): void {
  current = { text, link, page: pageKeyOf(route) };
  emit();
}

export function clearFlash(): void {
  if (!current) return;
  current = null;
  emit();
}

/** 进入页面时读一次：这一页有没有待显示的提示。 */
export function flashFor(route: Route): Flash | null {
  return current && current.page === pageKeyOf(route) ? current : null;
}

export function useFlash(route: Route): Flash | null {
  const flash = useSyncExternalStore(subscribe, () => current);
  return flash && flash.page === pageKeyOf(route) ? flash : null;
}
