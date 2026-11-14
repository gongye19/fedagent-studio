// 逐个页面做可访问性与响应式的机器检查：node a11y.mjs
// 环境变量：BASE（默认 http://127.0.0.1:8880/）、CDP_PORT（默认 9350）、OUT（默认 /tmp/fedagent-audit/a11y.json）
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { evaluate, launch, open, routes, sleep, viewport } from "./lib.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8880/";
const OUT = process.env.OUT ?? "/tmp/fedagent-audit/a11y.json";
const port = Number(process.env.CDP_PORT ?? 9350);
mkdirSync(dirname(OUT), { recursive: true });

const CHECK = `(() => {
  const out = { headings: [], unnamed: [], unlabeled: [], dupIds: [], tabindex: [], overflow: null, small: [], tiny: [], contrast: [] };
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[aria-hidden="true"]') && !el.closest('details:not([open]) > :not(summary)'); };
  document.querySelectorAll('h1,h2,h3,h4').forEach((h) => { if (visible(h)) out.headings.push(h.tagName + ':' + h.textContent.trim().slice(0, 24)); });
  const nameOf = (el) => (el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent) || el.textContent || el.getAttribute('title') || '').trim();
  document.querySelectorAll('button, a[href], summary, [role=button], [role=radio], [role=tab]').forEach((el) => { if (visible(el) && !nameOf(el)) out.unnamed.push(el.outerHTML.slice(0, 90)); });
  document.querySelectorAll('input, select, textarea, [role=combobox]').forEach((el) => {
    if (el.type === 'hidden' || !visible(el) || el.closest('[aria-hidden="true"]')) return;
    const labelled = el.closest('label') || (el.id && document.querySelector('label[for="' + el.id + '"]')) || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    if (!labelled) out.unlabeled.push(el.outerHTML.slice(0, 90));
  });
  const ids = {}; document.querySelectorAll('[id]').forEach((el) => { ids[el.id] = (ids[el.id] || 0) + 1; }); out.dupIds = Object.entries(ids).filter(([, n]) => n > 1).map(([k]) => k);
  document.querySelectorAll('[tabindex]').forEach((el) => { if (Number(el.getAttribute('tabindex')) > 0) out.tabindex.push(el.outerHTML.slice(0, 60)); });
  out.overflow = document.documentElement.scrollWidth > window.innerWidth + 1 ? document.documentElement.scrollWidth + ' > ' + window.innerWidth : null;
  // 超出视口右边的元素
  out.offright = [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return visible(el) && r.right > window.innerWidth + 1 && !el.closest('.table-shell, .code-block, pre'); }).slice(0, 5).map((el) => el.className + ':' + el.textContent.trim().slice(0, 20));
  // 点击目标（只在窄屏统计）
  if (window.innerWidth < 700) {
    document.querySelectorAll('button, a[href], summary, select, input:not([type=checkbox]):not([type=radio]), label.option-card, .select-row, input[type=checkbox]').forEach((el) => {
      if (!visible(el)) return; const r = el.getBoundingClientRect();
      const target = el.matches('input[type=checkbox]') ? el.closest('label') || el.closest('tr') || el : el;
      const tr = target.getBoundingClientRect();
      if (tr.height < 40 || (tr.width < 40 && !el.matches('a.text-link'))) out.small.push((el.className || el.tagName) + ' ' + Math.round(tr.width) + 'x' + Math.round(tr.height) + ' ' + (el.textContent || el.value || '').trim().slice(0, 14));
    });
  }
  // 小字
  const texts = [...document.querySelectorAll('body *')].filter((el) => visible(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  texts.forEach((el) => { const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 12) out.tiny.push(el.tagName + '.' + el.className + ' ' + fs + 'px ' + el.textContent.trim().slice(0, 16)); });
  // 对比度（文字色 vs 最近的不透明背景）
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.9) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
  texts.forEach((el) => {
    const s = getComputedStyle(el); if (el.closest('button:disabled, [aria-disabled=true], .option-card--disabled, .select-row--disabled, input:disabled')) return;
    const fg = parse(s.color); if (!fg) return; const bg = bgOf(el);
    const mix = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
    const L1 = lum(mix), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const fs = parseFloat(s.fontSize), bold = Number(s.fontWeight) >= 600; const need = fs >= 24 || (bold && fs >= 18.66) ? 3 : 4.5;
    if (ratio < need) out.contrast.push(ratio.toFixed(2) + ' ' + el.tagName + '.' + (el.className || '') + ' ' + el.textContent.trim().slice(0, 16));
  });
  out.contrast = [...new Set(out.contrast)].slice(0, 12); out.tiny = [...new Set(out.tiny)].slice(0, 8); out.small = [...new Set(out.small)].slice(0, 20);
  return out;
})()`;

const { send, close } = await launch({ port, profile: `/tmp/fedagent-profile-a11y-${port}` });
const report = {};
try {
  for (const [width, height, mobile] of [[1280, 900, false], [768, 1000, false], [390, 844, true]]) {
    await viewport(send, { width, height, mobile, scale: 1 });
    for (const entry of await routes(BASE)) {
      const { route, name, script } = typeof entry === "string" ? { route: entry, name: entry } : entry;
      await open(send, BASE + route);
      try {
        if (script) { await evaluate(send, script); await sleep(300); }
        // 配置预检会解除禁用并触发按钮颜色过渡；读取稳定样式，避免把过渡中间色当作对比度。
        await evaluate(send, "(async()=>{const b=document.querySelector('.summary-start');if(!b)return;for(let i=0;i<30&&b.disabled;i++)await new Promise(r=>setTimeout(r,100));await Promise.all([...document.querySelectorAll('.summary-start,.order-bar button')].flatMap(e=>e.getAnimations()).map(a=>a.finished.catch(()=>{})))})()");
        report[`${width} ${name}`] = await evaluate(send, CHECK);
      } catch (error) {
        report[`${width} ${name}`] = String(error.message);
      }
    }
  }
} finally {
  close();
}
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log("done", Object.keys(report).length);
