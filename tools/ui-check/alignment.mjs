// 只读检查表格对齐及展开稳定性，不创建任务、修改资源或调用模型。
// BASE=http://127.0.0.1:8892/ OUT=/tmp/fedagent-alignment node tools/ui-check/alignment.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { evaluate, launch, open, sleep, viewport } from "./lib.mjs";

const base = process.env.BASE ?? "http://127.0.0.1:8892/";
const out = process.env.OUT ?? "/tmp/fedagent-alignment";
const browser = await launch({ port: Number(process.env.CDP_PORT ?? 9460), profile: `${out}/chrome` });
mkdirSync(out, { recursive: true });
const reports = [];
if (process.env.LONG_CONTENT === "1") await browser.send("Page.addScriptToEvaluateOnNewDocument", {source: `
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href);
    if (!['/v1/datasets','/v1/participants'].includes(url.pathname) || !response.ok) return response;
    const rows = await response.clone().json();
    if (url.pathname === '/v1/participants') for (const row of rows) row.name = '临床数据协作研究工作区与跨机构资源提供方';
    for (const row of rows) if (row.taskType === 'medical-records') {
      row.name = '跨机构医疗问诊过程记录与病例检查结果汇总，用于检验较长数据名称在不同屏宽下的换行和对齐';
      row.description = '仅供浏览器排版检查，未修改或上传服务器数据。'.repeat(10);
    }
    return new Response(JSON.stringify(rows), {status:response.status,headers:response.headers});
  };
`});
const read = `(() => {
  const rect = (e) => { const r = e.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
  const text = (e) => {
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.textContent.trim() || n.parentElement.closest('.visually-hidden, [aria-hidden=true]')) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      const r = range.getClientRects()[0]; if (r?.width) return { left:r.left, right:r.right, top:r.top, bottom:r.bottom };
    }
    return rect(e);
  };
  const tables = [...document.querySelectorAll('table')].filter(e => e.getBoundingClientRect().width);
  return {
    overflow: document.documentElement.scrollWidth > innerWidth,
    tables: tables.map(table => ({
      label: table.getAttribute('aria-label') ?? table.className,
      bounds: rect(table),
      headerVisible: Boolean(table.querySelector('thead')?.getBoundingClientRect().height),
      header: [...table.querySelectorAll(':scope > thead > tr:first-child > th')].map(e => ({...rect(e), text:text(e), label:e.textContent})),
      rows: [...table.querySelectorAll(':scope > tbody > tr:not(.detail-row):not(.resource-empty-row)')].filter(r => r.cells.length > 1).map(r =>
        [...r.cells].map(e => { const contentRange=document.createRange(); contentRange.selectNodeContents(e); return {...rect(e), block:rect(contentRange), text:text(e), numeric:e.classList.contains('numeric'), label:e.dataset.label,
          content:rect(e.querySelector('.row-button, .table-link, .tag, .model-availability, .model-actions, button') ?? e),
          plain:!e.querySelector('button, .tag, .model-availability, .model-actions')}; })),
    })),
    name: document.querySelector('.row--open .row-button > span') ? text(document.querySelector('.row--open .row-button > span')) : null,
    toggles: [...document.querySelectorAll('.row-button')].map(rect),
    detailOpen: Boolean(document.querySelector('.row--open')),
    participantDetail: document.querySelector('.participant-detail') ? rect(document.querySelector('.participant-detail')) : null,
    flatData: document.querySelector('.table--resources') ? {
      labels:[...document.querySelectorAll('.table--resources thead th')].map(e=>e.textContent),
      expandable:Boolean(document.querySelector('.table--resources .row-button, .table--resources .detail-row')),
      extraDescription:document.querySelector('.table--resources').textContent.includes('仅供浏览器排版检查'),
      actions:[...document.querySelectorAll('.table--resources tbody button')].map(e=>({lastCell:e.closest('td')===e.closest('tr').lastElementChild,...rect(e)})),
    } : null,
  };
})()`;

function inspect(state, width) {
  const issues = [];
  const near = (a, b, label, tolerance = 1) => { if (Math.abs(a - b) > tolerance) issues.push(`${label}: ${a.toFixed(2)} / ${b.toFixed(2)}`); };
  if (state.overflow) issues.push("页面横向溢出");
  for (const table of state.tables) {
    // 各表断点不同：任务表先切三列卡片，不能只根据视口宽度推断是否仍显示表头。
    if (!table.headerVisible) {
      for (const row of table.rows) for (const cell of row) {
        const content = cell.plain ? cell.block : cell.content;
        if (content && (content.left < table.bounds.left - 1 || content.right > table.bounds.right + 1))
          issues.push(`${table.label}/卡片内容超出左右边界`);
      }
      continue;
    }
    for (const row of table.rows) row.forEach((cell, i) => {
      const block = cell.plain ? cell.block : cell.content;
      const reference = row[0].plain ? row[0].block : row[0].content;
      if (block && reference) near((block.top + block.bottom) / 2, (reference.top + reference.bottom) / 2, `${table.label}/行内垂直居中`, 1.5);
      const header = table.header[i]; if (!header) return;
      if (cell.label === "操作" || header.label === "操作") return;
      const edge = cell.numeric ? "right" : "left";
      const actual = cell.plain ? cell.text[edge] : cell.content[edge];
      // 展开按钮包含箭头，但对齐的是名称文字。
      const isName = i === 0 && state.toggles.length;
      near(header.text[edge], isName ? cell.text[edge] : actual, `${table.label}/${header.label}`);
    });
  }
  if (width > 720 && state.name && state.participantDetail) near(state.name.left, state.participantDetail.left, "参与方名称与详情起点");
  if (state.flatData) {
    if (state.flatData.labels.join() !== "数据名称,任务类型,样本数,操作") issues.push("数据目录列与用户所需信息不一致");
    if (state.flatData.expandable) issues.push("数据目录仍有不需要的展开");
    if (state.flatData.extraDescription) issues.push("数据目录仍展示冗长说明");
    for (const action of state.flatData.actions) {
      if (!action.lastCell) issues.push("删除操作未放在数据行末尾");
      if (action.width < 44) issues.push("删除操作触达宽度不足");
    }
  }
  if (width <= 720) for (const target of state.toggles) if (target.height < 44) issues.push("展开按钮触达区域不足 44px");
  return issues;
}

try {
  for (const width of [1440, 1280, 768, 700, 390]) {
    await viewport(browser.send, { width, height: 1000, mobile: width <= 720 });
    for (const route of ["resources", "tasks", "results", "evaluations", "models", "algorithms", "participants"]) {
      await open(browser.send, `${base}#/${route}`, 900);
      const before = await evaluate(browser.send, read);
      const issues = inspect(before, width);
      const expanded = [];
      if (route === "participants") {
        const labels = await evaluate(browser.send, "[...document.querySelectorAll('.table--expandable > tbody > tr > th > .row-button')].map(b=>b.closest('tr').textContent)");
        if (!labels.length) issues.push("没有可测的可展开数据行，未完成对齐验收");
        if (process.env.LONG_CONTENT === "1" && !labels.some(s=>s.includes('跨机构医疗问诊过程记录与病例检查结果汇总'))) issues.push("长内容夹具没有显示");
        for (let rowIndex=0; rowIndex<labels.length; rowIndex++) {
          await evaluate(browser.send, `[...document.querySelectorAll('.table--expandable > tbody > tr > th > .row-button')][${rowIndex}].click()`);
          await sleep(200);
          const after = await evaluate(browser.send, read);
          const rowIssues = inspect(after, width);
          if (!after.detailOpen) rowIssues.push("行未展开");
          if (route === "participants" && !after.participantDetail) rowIssues.push("参与方详情未被测量");
          if (width > 720) for (let i=0; i<(before.tables[0]?.header.length ?? 0); i++) {
            const a=before.tables[0].header[i], b=after.tables[0].header[i];
            if (Math.abs(a.left-b.left)>1 || Math.abs(a.width-b.width)>1) rowIssues.push(`展开后第 ${i+1} 列移动`);
          }
          expanded.push({rowIndex,issues:rowIssues});
          issues.push(...rowIssues.map(issue=>`行 ${rowIndex+1}: ${issue}`));
          if (rowIndex === 0) {
            const shot=await browser.send("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
            writeFileSync(`${out}/${route}-expanded-${width}.png`,Buffer.from(shot.data,"base64"));
          }
          await evaluate(browser.send, `[...document.querySelectorAll('.table--expandable > tbody > tr > th > .row-button')][${rowIndex}].click()`);
          await sleep(150);
          const collapsed = await evaluate(browser.send, "!document.querySelector('.row--open')");
          expanded.at(-1).collapsed = collapsed;
          if (!collapsed) issues.push(`行 ${rowIndex + 1}: 收起未完成`);
        }
      }
      const image = await browser.send("Page.captureScreenshot", {format:"png", captureBeyondViewport:false});
      writeFileSync(`${out}/${route}-${width}.png`, Buffer.from(image.data,"base64"));
      reports.push({width, route, rows:before.tables.reduce((n,t)=>n+t.rows.length,0), expanded, issues});
      console.log(issues.length ? "FAIL" : "PASS", width, route, issues.join("; "));
    }
  }
  writeFileSync(`${out}/report.json`, JSON.stringify(reports,null,2));
  if (reports.some(r => r.issues.length)) process.exitCode = 1;
} finally { browser.close(); }
