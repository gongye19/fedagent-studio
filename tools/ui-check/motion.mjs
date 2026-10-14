// 动效与状态保留回归：真实只读页面，禁止任何 API 写请求或模型调用。
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { evaluate, launch, open, sampleIds, sleep, viewport, LOCAL_CONNECTION_SOURCE } from './lib.mjs';
const base = process.env.BASE ?? 'http://127.0.0.1:8880/';
const ids = await sampleIds(base);
assert.ok(ids.task && ids.app, '需要现有任务和应用作为只读模板');
const out = process.env.CDP_OUT ?? '/tmp/fedagent-motion';
mkdirSync(out, { recursive: true });
const { send, close } = await launch({ port: Number(process.env.CDP_PORT ?? 9371), profile: '/tmp/fedagent-motion-profile' });
const evidence = [];
function check(name, ok) { assert.ok(ok, name); evidence.push(name); console.log('PASS', name); }
async function go(hash) { await evaluate(send, `location.hash=${JSON.stringify(hash)};void 0`); await sleep(250); }
async function shot(name) {
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${out}/${name}.png`, Buffer.from(image.data, 'base64'));
}
await send('Page.addScriptToEvaluateOnNewDocument',{source:LOCAL_CONNECTION_SOURCE});
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) throw Error('Motion check blocks write requests: ' + method);
    return fetchOriginal(input, init);
  };
  window.__motions = [];
  const animateOriginal = Element.prototype.animate;
  Element.prototype.animate = function(frames, timing) {
    const animation = animateOriginal.call(this, frames, timing);
    window.__motions.push({ element: this, animation, frames, timing });
    if (window.__pauseMotion) { animation.pause(); animation.currentTime = 60; }
    return animation;
  };
})()` });
try {
  for (const width of [1280, 390]) {
    await viewport(send, { width, height: width === 390 ? 844 : 900, mobile: width === 390 });
    await open(send, base + '#/');
    await evaluate(send, "window.__page=document.querySelector('.page');void 0");
    await go('#/tasks');
    check('页面淡入且主内容节点保留 ' + width, await evaluate(send, "__page===document.querySelector('.page')&&__motions.length>0&&__motions.every(m=>m.frames[0].opacity===0&&m.frames[0].transform==='translateY(8px)'&&m.timing.duration===240)"));
    check('页面切换后焦点到主内容 ' + width, await evaluate(send, "document.activeElement.id==='main'"));
    await evaluate(send, "window.__pauseMotion=true;location.hash='#/apps';void 0");
    await sleep(70);
    await evaluate(send, "window.__prior=__motions.slice();location.hash='#/tasks';void 0"); await sleep(70);
    check('快速切换取消前一次动画 ' + width, await evaluate(send, "__prior.every(m=>m.animation.playState==='idle')&&__motions.at(-1).animation.playState==='paused'"));
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    // 等媒体查询的样式重算完成，再断言折叠没有过渡（与前面的偏好切换检查一致）。
    await sleep(60);
    await sleep(60); // matchMedia 的 change 事件由浏览器在渲染周期派发。
    check('偏好中途改变会立即取消动画 ' + width, await evaluate(send, "__motions.at(-1).animation.playState==='idle'"));
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await go('#/tasks/new/horizontal');
    check('切换中底栏布局保持正确 ' + width, await evaluate(send, "(()=>{const bar=document.querySelector('.order-bar'),r=bar.getBoundingClientRect();return (getComputedStyle(bar).display==='none'||Math.abs(r.bottom-innerHeight)<2)&&getComputedStyle(__page).transform==='none'})()"));
    await shot('new-task-during-' + width);
    await evaluate(send, "__motions.at(-1).animation.finish();window.__pauseMotion=false;const i=document.getElementById('task-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'动效验证草稿');i.dispatchEvent(new Event('input',{bubbles:true}));void 0");
    await sleep(80); await go('#/tasks'); await go('#/tasks/new/horizontal');
    check('切换后草稿保留 ' + width, await evaluate(send, "document.getElementById('task-name').value==='动效验证草稿'"));
    await evaluate(send, "window.__motionCount=__motions.length;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(document.getElementById('task-name'),'继续编辑');document.getElementById('task-name').dispatchEvent(new Event('input',{bubbles:true}));void 0");
    await sleep(300);
    check('普通状态更新不重播导航动画 ' + width, await evaluate(send, "__motions.length===__motionCount"));
    await go('#/tasks/' + ids.task + '/overview');
    await go('#/tasks/' + ids.task + '/config');
    check('任务标签仅动画内容区 ' + width, await evaluate(send, "__motions.at(-1).element.className==='tab-panel'&&__motions.at(-1).frames[0].transform==='translateY(8px)'"));
    await go('#/tasks/' + ids.task + '/progress');
    // 延长测试中的 CSS 时长，可靠采样开、关中间帧；产品默认为 240ms。
    const disclosure = await evaluate(send, `(async()=>{const d=document.querySelector('.round details');if(!d)return null;d.style.setProperty('--motion-content','1000ms');d.open=true;await new Promise(r=>setTimeout(r,1100));const full=d.getBoundingClientRect().height;window.__steps=d.querySelector('.step-line');d.open=false;await new Promise(r=>setTimeout(r,100));const mid=d.getBoundingClientRect().height;await new Promise(r=>setTimeout(r,1100));const closed=d.getBoundingClientRect().height;d.open=true;await new Promise(r=>setTimeout(r,100));const opening=d.getBoundingClientRect().height;return {full,mid,closed,opening,retained:__steps===d.querySelector('.step-line'),supported:CSS.supports('interpolate-size','allow-keywords')}})()`);
    check('轮次收起保留步骤且双向平滑 ' + width, disclosure && disclosure.retained && (!disclosure.supported || (disclosure.closed < disclosure.mid && disclosure.mid < disclosure.full && disclosure.closed < disclosure.opening && disclosure.opening < disclosure.full)));
    await go('#/apps/' + ids.app + '/content');
    await evaluate(send, "[...document.querySelectorAll('button')].find(x=>x.textContent==='重命名')?.click();void 0");
    await sleep(80); await evaluate(send, "window.__rename=document.getElementById('app-name');void 0");
    await go('#/apps/' + ids.app + '/integrate');
    check('应用标签动效保留父级编辑状态 ' + width, await evaluate(send, "__motions.at(-1).element.className==='tab-panel'&&__rename&&document.getElementById('app-name')===__rename"));
    await go('#/participants/horizontal/qa-local-client');
    await evaluate(send, "window.__guide=document.querySelector('.participant-connect');__guide.style.setProperty('--motion-content','1000ms');window.__closed=__guide.getBoundingClientRect().height;__guide.querySelector('summary').focus({preventScroll:true});void 0");
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await sleep(100); const middle = await evaluate(send, '__guide.getBoundingClientRect().height'); await sleep(1100);
    check('键盘展开连接指南有高度过渡 ' + width, await evaluate(send, `__guide.open&&document.activeElement.tagName==='SUMMARY'&&${middle}>__closed&&${middle}<__guide.getBoundingClientRect().height`));
    await shot('participants-expanded-' + width);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(60); // 媒体查询重算后，折叠应立即完成。
    await evaluate(send, "window.__count=__motions.length;__guide.open=false;void 0"); await sleep(30);
    check('减少动态时折叠立即完成 ' + width, await evaluate(send, "__guide.getBoundingClientRect().height===__closed&&getComputedStyle(__guide,'::details-content').transitionDuration==='0s'"));
    await go('#/tasks');
    check('减少动态时页面切换不播放动画 ' + width, await evaluate(send, '__motions.length===__count'));
    await evaluate(send, "const b=[...document.querySelectorAll('.table--tasks button')].find(x=>!x.disabled);b.focus({preventScroll:true});window.__deleteTrigger=b;b.click();void 0"); await sleep(60);
    check('减少动态时确认框仍居中且默认焦点取消 ' + width, await evaluate(send, "(()=>{const d=document.querySelector('dialog[open]'),r=d?.getBoundingClientRect();return d&&Math.abs((r.top+r.bottom)/2-innerHeight/2)<2&&document.activeElement.textContent==='取消'&&parseFloat(getComputedStyle(d).animationDuration)<.001})()"));
    await evaluate(send, "document.querySelector('.dialog-close').click();void 0");
    check('关闭确认恢复触发焦点 ' + width, await evaluate(send, 'document.activeElement===__deleteTrigger'));
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await evaluate(send, "__deleteTrigger.click();void 0"); await sleep(40);
    check('确认框与遮罩有短促入场 ' + width, await evaluate(send, "(()=>{const d=document.querySelector('dialog');return getComputedStyle(d).animationName==='dialog-enter'&&getComputedStyle(d,'::backdrop').animationName==='backdrop-enter'&&parseFloat(getComputedStyle(d).animationDuration)===.15})()"));
    await sleep(200); await shot('confirm-' + width);
    await evaluate(send, "document.querySelector('.dialog-close').click();void 0");
    await go('#/');
    if (width === 390) { await evaluate(send, "document.querySelector('.menu-button').click();void 0"); await sleep(180); }
    check('所有资源入口同级可见且没有折叠父目录 ' + width, await evaluate(send, "!document.querySelector('.nav-parent,.nav-sub')&&['我的资源','公用资源','算法','模型接口'].every(t=>[...document.querySelectorAll('.side-nav > a')].some(a=>a.textContent.trim()===t&&a.getBoundingClientRect().height>0))"));
    check('页面无横向溢出 ' + width, await evaluate(send, 'document.documentElement.scrollWidth<=innerWidth'));
    if (process.env.DEV_FIXTURES !== '0' && ['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) {
      // 本地仅发布前端通知夹具，验证实际 Toast 组件，不触发任何业务写入。
      await evaluate(send, "(async()=>{const {showFlash}=await import('/src/state/flash.ts');showFlash({page:'home'},'动效回归通知')})()");
      await sleep(40);
      check('成功通知有轻量入场且不抢焦点 ' + width, await evaluate(send, "Boolean(document.querySelector('.toast'))&&getComputedStyle(document.querySelector('.toast')).animationName==='content-enter'&&!document.querySelector('.toast').contains(document.activeElement)"));
      await evaluate(send, "document.querySelector('.toast-close').click();void 0");
    }
  }
  writeFileSync(out + '/evidence.json', JSON.stringify({ readOnly: true, base, evidence }, null, 2));
} finally { close(); }
