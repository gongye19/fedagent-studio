// 无头 Chrome + DevTools 协议的公共部分。端口、配置目录可以用环境变量改，便于并行跑几个脚本。
// 环境变量：CHROME_PATH（默认 macOS 上的 Google Chrome）、WAIT（打开页面后等多少毫秒，默认 1300；
// 经 Tailscale 访问部署的平台时页面要先读数据，用 4000）。
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const WAIT = Number(process.env.WAIT ?? 1300);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function launch({ port, profile }) {
  // 端口上已经有浏览器（上次没关掉）时直接退出，免得连到旧实例、读到过期的 localStorage。
  try {
    await fetch(`http://127.0.0.1:${port}/json/version`);
    console.error(`port ${port} is already in use; stop the old Chrome first`);
    process.exit(1);
  } catch { /* 端口空闲 */ }
  rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let url;
  for (let attempt = 0; attempt < 60 && !url; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      url = list.find((item) => item.type === "page")?.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    if (!url) await sleep(200);
  }
  if (!url) { chrome.kill(); throw new Error("chrome did not start"); }
  const socket = new WebSocket(url);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  let seq = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  const send = (method, params = {}) => {
    const id = ++seq;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result))));
  };
  await send("Page.enable");
  await send("Runtime.enable");
  const close = () => { socket.close(); chrome.kill(); };
  return { send, close };
}

/** 视口：手机同时模拟触屏和 coarse 指针。 */
export async function viewport(send, { width, height, mobile = false, scale }) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale ?? (mobile ? 2 : 1), mobile });
  await send("Emulation.setTouchEmulationEnabled", mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: mobile ? "coarse" : "fine" }, { name: "hover", value: mobile ? "none" : "hover" }] });
}

export async function evaluate(send, expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

/** 等到应用主内容已显示，避免把加载页或白屏当成验证结果。 */
export async function ready(send, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(send, "Boolean(document.querySelector('main h1'))")) return;
    await sleep(200);
  }
  throw new Error("页面主内容在 30 秒内未加载完成");
}

/** 打开一个地址：先回空白页，保证每次都是完整加载，而不是同一页里换 hash。 */
export async function open(send, url, wait = WAIT, { reset = true } = {}) {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(100);
  // 每页都从干净的浏览器存储开始（草稿、访问令牌），前一页脚本里的操作（选参与方、填表）不影响下一页
  if (reset) await send("Storage.clearDataForOrigin", { origin: new URL(url).origin, storageTypes: "local_storage,session_storage" });
  await send("Page.navigate", { url });
  await sleep(wait);
  await ready(send);
}

// 页面上的常用操作（在页面里执行的脚本）
export const CLICK = (text) => `(async () => { [...document.querySelectorAll('button, a')].find((b) => b.textContent.includes(${JSON.stringify(text)}))?.click(); await new Promise((r) => setTimeout(r, 300)); })()`;
export const PICK = (labels) => `(async () => { const wait = () => new Promise((r) => setTimeout(r, 120)); for (const t of ${JSON.stringify(labels)}) { const b=[...document.querySelectorAll('button[role=radio]')].find((b) => b.textContent.trim().startsWith(t)); if(b?.getAttribute('aria-checked')!=='true')b?.click(); await wait(); } })()`;
export const OPEN_ADVANCED = "(async () => { const d = document.querySelector('details.module'); if (d) d.open = true; await new Promise((r) => setTimeout(r, 200)); })()";
export const NEW_TASK_ALL = "(async () => { const wait = () => new Promise((r) => setTimeout(r, 150)); const a=document.getElementById('algorithm-fot');if(a&&!a.checked)a.click();await wait();const t=[...document.querySelectorAll('button[role=radio]')].find(b=>b.textContent.trim()==='数学推理');if(t?.getAttribute('aria-checked')!=='true')t?.click();await wait();const all=document.querySelector('input[aria-label=全选]');if(all&&!all.checked)all.click();await wait();})()";
export const NEW_MEDICAL_GROUPS = "(async()=>{const wait=()=>new Promise(r=>setTimeout(r,180));document.getElementById('algorithm-evomedclaw')?.click();await wait();[...document.querySelectorAll('button[role=radio]')].find(e=>e.textContent.trim()==='医疗诊断')?.click();await wait();})()";
export const SELECT = (name, value) => `(async () => { const s = document.querySelector('[data-select-name="${name}"], [data-model-name="${name}"]'); if (!s) throw new Error('select trigger missing: ${name}'); const model = s.hasAttribute('data-model-name'); if (model) s.click(); else { s.focus(); s.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); } await new Promise((r) => setTimeout(r, 180)); const content=document.getElementById(s.getAttribute('aria-controls')); if(!content)throw new Error('select content missing'); const item = [...content.querySelectorAll('[role=option]')].find((i) => (model ? i.dataset.modelValue : i.dataset.optionValue) === ${JSON.stringify(String(value))}); if (!item) throw new Error('select option missing'); if (model) item.click(); else { item.focus(); item.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); } await new Promise((r) => setTimeout(r, 250)); })()`;
export const SEARCH = (name, value) => `(async () => { const i = document.querySelector('input[name=${name}]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 250)); })()`;

/**
 * 平台上已有的一个任务（优先已完成的）和一个应用，用来扫详情页；读不到（没有数据、开了访问令牌）时为 null。
 * base 是平台地址，例如 http://127.0.0.1:8880/。
 */
export async function sampleIds(base) {
  const read = (path) => fetch(new URL(path, base)).then((response) => (response.ok ? response.json() : [])).catch(() => []);
  const [tasks, apps] = await Promise.all([read("v1/tasks"), read("v1/apps")]);
  return { task: (tasks.find((task) => task.status === "completed") ?? tasks[0])?.id ?? null, app: apps[0]?.id ?? null };
}

/** 扫描用的页面清单：每一项是地址，或 { route, name, script }。任务、应用的详情页用平台上已有的数据。 */
export async function routes(base) {
  const { task, app } = await sampleIds(base);
  const taskPages = task ? ["overview", "progress", "output", "config"].map((tab) => `#/tasks/${task}/${tab}`) : [];
  const appPages = app ? [`#/apps/${app}`, `#/apps/${app}/content`, `#/apps/${app}/integrate`] : [];
  const entries = ROUTES.flatMap((entry) => (entry === "{tasks}" ? taskPages : entry === "{apps}" ? appPages : [entry]));
  return process.env.ROUTE_MATCH ? entries.filter(entry => (typeof entry === "string" ? entry : entry.name ?? entry.route).includes(process.env.ROUTE_MATCH)) : entries;
}

const ROUTES = [
  "#/", "#/tasks",
  { route: "#/tasks", name: "#/tasks 筛选无结果", script: SEARCH("task-search", "zzz") },
  "#/tasks/new/horizontal",
  "#/tasks/new", "#/resources/mine/data", "#/resources/public/data", "#/resources/mine/models", "#/resources/public/models", "#/resources/mine/agents", "#/resources/public/agents",
  { route: "#/tasks/new/horizontal", name: "#/tasks/new/horizontal 全选", script: NEW_TASK_ALL },
  { route: "#/tasks/new/horizontal", name: "#/tasks/new/horizontal 医疗协作组", script: NEW_MEDICAL_GROUPS },
  { route: "#/tasks/new/horizontal", name: "#/tasks/new/horizontal 高级配置", script: NEW_TASK_ALL + ";" + OPEN_ADVANCED },
  "#/tasks/new/vertical",
  "{tasks}",
  "#/apps",
  { route: "#/apps", name: "#/apps 筛选无结果", script: SELECT("task-type", "math-reasoning") + ";" + SEARCH("app-search", "zzz") },
  "{apps}",
  "#/participants", "#/participants/horizontal/p-a",
  { route: "#/participants", name: "#/participants 筛选", script: SEARCH("participant-search", "参与方 A") },
  "#/participants/new",
  { route: "#/participants/new", name: "#/participants/new 已选", script: PICK(["平台托管", "横向联邦", "数学推理"]) },
  "#/datasets/new",
  "#/algorithms", "#/algorithms/fot", "#/models", "#/models/public", "#/agents", "#/agents/public", "#/models/new", "#/tasks/nope",
];

// 本地客户端仅在浏览器回归中注入；不依赖生产初始资源，不签发凭据或写数据库。
export const LOCAL_CONNECTION_SOURCE = `(()=>{const original=fetch.bind(window);window.fetch=async(input,init)=>{const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname,method=(init?.method??'GET').toUpperCase();const response=await original(input,init);if(method!=='GET'||!response.ok||!['/v1/participants','/v1/datasets'].includes(path))return response;const list=await response.json();const row=path==='/v1/participants'?{id:'qa-local-client',name:'客户端连接验证夹具',org:'仅浏览器回归',intro:'',hosting:'local',status:'waiting',builtin:false,lastSeenAt:null}:{id:'qa-local-data',name:'客户端数据验证夹具',participantId:'qa-local-client',scenario:'horizontal',taskType:'math-reasoning',description:'',origin:null,source:'local',ready:false,count:0,answered:0,sample:null};return new Response(JSON.stringify([...list,row]),{headers:{'content-type':'application/json'}})}})()`;
