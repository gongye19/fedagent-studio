// 截图：node cdp.mjs shots.json
// shots.json: [{ name, url, width?, height?, mobile?, fresh?, wait?, script?, after?, fullPage?, split? }]
// 地址里可以写 {task}、{app}，换成平台上已有的一个任务、一个应用。
// 环境变量：CDP_PORT（默认 9333）、CDP_PROFILE（浏览器配置目录）、CDP_OUT（输出目录）
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { evaluate, launch, sampleIds, sleep, viewport } from "./lib.mjs";

const port = Number(process.env.CDP_PORT ?? 9333);
const profile = process.env.CDP_PROFILE ?? "/tmp/fedagent-cdp-profile";
const out = process.env.CDP_OUT ?? "/tmp/fedagent-shots";
mkdirSync(out, { recursive: true });
const shots = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (shots.some((shot) => /\{(task|app)\}/.test(shot.url))) {
  const ids = await sampleIds(new URL(shots[0].url).origin + "/");
  for (const shot of shots) shot.url = shot.url.replace("{task}", ids.task ?? "").replace("{app}", ids.app ?? "");
}
const { send, close } = await launch({ port, profile });
try {
  for (const shot of shots) {
    const width = shot.width ?? 1280;
    const height = shot.height ?? 900;
    const mobile = Boolean(shot.mobile);
    await viewport(send, { width, height, mobile });
    if (shot.fresh) {
      // 从干净的浏览器存储开始：先到同源页面清掉 localStorage（草稿、访问令牌）
      await send("Page.navigate", { url: new URL(shot.url).origin + "/" });
      await sleep(400);
      await evaluate(send, "localStorage.clear()").catch(() => {});
    }
    await send("Page.navigate", { url: "about:blank" });
    await sleep(80);
    await send("Page.navigate", { url: shot.url });
    await sleep(shot.wait ?? 1300);
    if (shot.script) {
      try { await evaluate(send, shot.script); } catch (error) { console.error(shot.name, "script error", error.message); }
      await sleep(shot.after ?? 600);
    }
    if (shot.fullPage === false) {
      // 只截当前视口（脚本可能已经滚动过）
      const image = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(`${out}/${shot.name}.png`, Buffer.from(image.data, "base64"));
      console.log(shot.name, `${width}x${height}`);
      continue;
    }
    const metrics = await send("Page.getLayoutMetrics");
    const total = Math.max(height, Math.ceil(metrics.cssContentSize?.height ?? metrics.contentSize.height));
    const parts = shot.split ? Math.ceil(total / shot.split) : 1;
    for (let index = 0; index < parts; index += 1) {
      const y = shot.split ? index * shot.split : 0;
      const h = shot.split ? Math.min(shot.split, total - y) : total;
      // 整页：clip 以文档左上角为原点
      const image = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y, width, height: h, scale: 1 } });
      const file = parts > 1 ? `${shot.name}-${index + 1}` : shot.name;
      writeFileSync(`${out}/${file}.png`, Buffer.from(image.data, "base64"));
      console.log(file, `${width}x${h}`);
    }
  }
} finally {
  close();
}
