import { afterEach, expect, it, vi } from "vitest";
import { loadDiagramSource } from "./source";
afterEach(() => vi.unstubAllGlobals());
it("loads the generated document in the parent context and rejects HTML fallback pages", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '<meta http-equiv="Content-Security-Policy"><script id="live-config">{}</script>' });
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  expect(await loadDiagramSource("/algorithm-diagrams/evomedclaw.html", signal)).toContain("live-config");
  expect(fetch).toHaveBeenCalledWith("/algorithm-diagrams/evomedclaw.html", { signal, cache: "no-cache" });
  fetch.mockResolvedValueOnce({ ok: true, text: async () => '<div id="root"></div>' });
  await expect(loadDiagramSource("/missing", signal)).rejects.toThrow("格式无效");
  fetch.mockResolvedValueOnce({ ok: false });
  await expect(loadDiagramSource("/failed", signal)).rejects.toThrow("读取失败");
});
