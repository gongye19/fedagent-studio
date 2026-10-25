/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../../../tools/algorithm-diagrams/controller.js", import.meta.url), "utf8");

function player(width = 1040) {
  const listeners = new Map<string, (event?: unknown) => void>();
  const events = new Map<string, () => void>();
  const frames = new Map<number, (time: number) => void>();
  let next = 0;
  const stage = {dataset: {} as Record<string, string>};
  const document = {
    hidden: false,
    documentElement: {clientWidth: width, clientHeight: 702},
    getElementById: (id: string) => id === "stage" ? stage : {textContent: '{"canvas":{"duration":18}}'},
    addEventListener: (name: string, fn: () => void) => events.set(name, fn),
  };
  const reduced = {matches: false, addEventListener: (_: string, fn: () => void) => events.set("reduced", fn)};
  const parent = {postMessage: vi.fn()};
  const window = {__ready: true, __check: vi.fn(() => []), seek: vi.fn()};
  runInNewContext(source, {
    document, parent, window, matchMedia: () => reduced,
    addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn),
    dispatchEvent: vi.fn(), Event,
    ResizeObserver: class { observe() {} },
    requestAnimationFrame: (fn: (time: number) => void) => { frames.set(++next, fn); return next; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  return {
    stage, document, reduced, parent, window, frames, events,
    control: (playing: boolean, visible = true, sender = parent) => listeners.get("message")?.({source: sender, data: {type: "fedagent-diagram-control", playing, visible}}),
    step: (time: number) => {
      const [id, fn] = frames.entries().next().value!;
      frames.delete(id);
      fn(time);
    },
  };
}

describe("isolated diagram playback", () => {
  it("ignores control messages from unrelated frames", () => {
    const p = player();
    p.control(true, true, {postMessage: vi.fn()});
    expect(p.frames.size).toBe(0);
    p.control(true);
    expect(p.stage.dataset.playing).toBe("true");
  });

  it("pauses and resumes without advancing during the pause", () => {
    const p = player();
    p.control(true);
    p.step(100);
    p.step(1100);
    expect(p.window.seek).toHaveBeenLastCalledWith(1);
    p.control(false);
    expect(p.frames.size).toBe(0);
    p.control(true);
    p.step(5100);
    expect(p.window.seek).toHaveBeenLastCalledWith(1);
    p.step(6100);
    expect(p.window.seek).toHaveBeenLastCalledWith(2);
  });

  it("stops while off-screen or in a hidden tab", () => {
    const p = player();
    p.control(true, false);
    expect(p.frames.size).toBe(0);
    p.control(true);
    p.document.hidden = true;
    p.events.get("visibilitychange")?.();
    expect(p.frames.size).toBe(0);
    p.document.hidden = false;
    p.events.get("visibilitychange")?.();
    expect(p.frames.size).toBe(1);
  });

  it("stops when the user switches to reduced motion", () => {
    const p = player();
    p.control(true);
    p.reduced.matches = true;
    p.events.get("reduced")?.();
    expect(p.frames.size).toBe(0);
    expect(p.stage.dataset.playing).toBe("false");
  });

  it("does not report a zero-size iframe as layout-verified", () => {
    const p = player(0);
    expect(p.parent.postMessage).not.toHaveBeenCalled();
    expect(p.window.__check).not.toHaveBeenCalled();
    p.document.documentElement.clientWidth = 1040;
    p.step(100);
    expect(p.window.__check).toHaveBeenCalledOnce();
    expect(p.stage.dataset.ready).toBe("true");
  });
});
