// 在多个宽度下找"断行不当"的文字：node wrap.mjs
// 规则：短文字（字段名、按钮、标签、表格单元格等，≤ 16 个字）被折成两行；或者较长文字的最后一行只剩 ≤ 3 个字。
// 环境变量：BASE、CDP_PORT（默认 9360）、OUT（默认 /tmp/fedagent-audit/wrap.json）、WIDTHS（逗号分隔）
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { evaluate, launch, open, routes, sleep, viewport } from "./lib.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8880/";
const OUT = process.env.OUT ?? "/tmp/fedagent-audit/wrap.json";
const port = Number(process.env.CDP_PORT ?? 9360);
mkdirSync(dirname(OUT), { recursive: true });

const CHECK = `(() => {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent;
    if (!text.trim()) continue;
    const el = node.parentElement;
    if (!el || el.closest('pre, textarea, script, style, .visually-hidden, svg, option, .chart')) continue;
    if (el.closest('details:not([open]) > :not(summary)')) continue;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.5);
    if (!rects.length) continue;
    const tops = [...new Set(rects.map((r) => Math.round(r.top / 4)))];
    if (tops.length < 2) continue;
    const lastTop = Math.max(...rects.map((r) => r.top));
    let last = '';
    for (let i = text.length - 1; i >= 0; i -= 1) {
      const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1);
      const rr = [...r.getClientRects()].find((x) => x.width > 0);
      if (!rr) { last = text[i] + last; continue; }
      if (Math.abs(rr.top - lastTop) > 3) break;
      last = text[i] + last;
    }
    const whole = text.trim();
    const tail = last.trim();
    const short = whole.length <= 16;
    const orphan = tail.length <= 3;
    if (short || orphan) {
      const where = (el.className && typeof el.className === 'string' ? el.tagName + '.' + el.className.split(' ')[0] : el.tagName);
      out.push((short ? 'SHORT ' : 'ORPHAN ') + where + ' | ' + whole.slice(0, 40) + ' | 末行: ' + tail);
    }
  }
  return [...new Set(out)];
})()`;

const widths = (process.env.WIDTHS ?? "1280,1180,1120,1024,900,800,768,600,390").split(",").map(Number);
const { send, close } = await launch({ port, profile: `/tmp/fedagent-profile-wrap-${port}` });
const report = {};
try {
  for (const width of widths) {
    await viewport(send, { width, height: 900, mobile: width < 700, scale: 1 });
    for (const entry of await routes(BASE)) {
      const { route, name, script } = typeof entry === "string" ? { route: entry, name: entry } : entry;
      await open(send, BASE + route);
      try {
        if (script) { await evaluate(send, script); await sleep(300); }
        const value = await evaluate(send, CHECK);
        if (value.length) report[`${width} ${name}`] = value;
      } catch (error) {
        report[`${width} ${name}`] = [String(error.message)];
      }
    }
  }
} finally {
  close();
}
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log("done", Object.keys(report).length);
