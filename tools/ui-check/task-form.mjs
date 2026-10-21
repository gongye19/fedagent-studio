// T71：静默恢复、字段原位校验与开始反馈。所有业务写请求被阻止，可在线只读验证。
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch,viewport,open,evaluate,sleep,PICK,NEW_TASK_ALL,SEARCH,SELECT} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8880/';
const fixture=['localhost','127.0.0.1'].includes(new URL(base).hostname);
const out=process.env.CDP_OUT??'/tmp/fedagent-task-form';mkdirSync(out,{recursive:true});
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9391),profile:'/tmp/fedagent-task-form-profile'});
const evidence=[];
const check=(name,ok)=>{assert.ok(ok,name);evidence.push(name);console.log('PASS',name)};
await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=fetch.bind(window);window.__writes=0;window.fetch=async(input,init)=>{const method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase(),path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;if(!['GET','HEAD'].includes(method)&&path!=='/v1/tasks/validate'){window.__writes++;throw Error('Form check blocks business writes')}const response=await original(input,init);if(${fixture}&&path==='/v1/tasks/validate'&&window.__qaIssues&&response.ok){const payload=await response.json();return new Response(JSON.stringify({...payload,issues:window.__qaIssues}),{headers:{'content-type':'application/json'}})}return response}})()`});
const start="(innerWidth<=1180?document.querySelector('.order-bar .button--primary'):document.querySelector('.summary-start'))";
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
async function key(key){await send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,text:key==='Enter'?'\r':undefined,unmodifiedText:key==='Enter'?'\r':undefined,windowsVirtualKeyCode:key==='Enter'?13:0,nativeVirtualKeyCode:key==='Enter'?13:0});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:key==='Enter'?13:0,nativeVirtualKeyCode:key==='Enter'?13:0});await sleep(100)}
try{
 for(const width of [1280,390]){
  await viewport(send,{width,height:width===390?844:900,mobile:width===390});await open(send,base+'#/tasks/new/horizontal');
  check('首次打开无提示栏或未提交错误 '+width,await evaluate(send,"!document.querySelector('.notice,.field-error')"));
  check('重置与摘要标题同一行且移除页面取消 '+width,await evaluate(send,"document.querySelector('.summary-reset').closest('.panel-head').querySelector('h2').textContent==='配置摘要'&&Math.abs(document.querySelector('.summary-reset').getBoundingClientRect().top-document.querySelector('.summary-panel h2').getBoundingClientRect().top)<20&&![...document.querySelectorAll('.summary-actions button,.order-bar button')].some(b=>b.textContent==='取消')"));
  await evaluate(send,`${start}.click();void 0`);await sleep(45);
  check('缺项开始按钮播放一次短反馈 '+width,await evaluate(send,`${start}.getAnimations().some(a=>a.effect.getTiming().duration===260)`));
  await sleep(400);
  check('算法错误原位且获得焦点 '+width,await evaluate(send,"document.getElementById('algorithm-label-error').closest('.field').querySelector('#algorithm-label')&&document.activeElement.matches('input[name=algorithm]')&&document.getElementById('algorithm-label-error').getBoundingClientRect().top>=0&&document.getElementById('algorithm-label-error').getBoundingClientRect().bottom<=innerHeight"));
  await shot('missing-type-'+width);
  await evaluate(send,"document.getElementById('algorithm-fot').click();void 0");await sleep(150);
  check('修正算法清除其错误并提示类型 '+width,await evaluate(send,"!document.getElementById('algorithm-label-error')&&Boolean(document.getElementById('task-type-label-error'))"));
  await evaluate(send,PICK(['数学推理']));await sleep(350);
  check('修正类型清除其错误且参与方提示在表格下 '+width,await evaluate(send,"!document.getElementById('task-type-label-error')&&document.getElementById('participants-error').closest('section').id==='participants'"));
  await evaluate(send,"[...document.querySelectorAll('#participants .resource-space-bar button')].find(b=>b.textContent==='共享资源').click();void 0");await sleep(250);
  await evaluate(send,`${start}.focus();void 0`);await key('Enter');await sleep(500);
  check('键盘开始定位参与方复选框 '+width,await evaluate(send,"document.activeElement.matches('#participants input[type=checkbox]')&&window.__writes===0"));
  await shot('missing-participants-'+width);
  await evaluate(send,NEW_TASK_ALL);await sleep(500);
  check('足够参与方后自动清除对应错误 '+width,await evaluate(send,"!document.getElementById('participants-error')"));
  await evaluate(send,SEARCH('task-name','静默恢复验证'));await open(send,base+'#/tasks/new/horizontal',undefined,{reset:false});
  check('恢复选择名称但无恢复栏或旧错误 '+width,await evaluate(send,"document.getElementById('task-name').value==='静默恢复验证'&&document.getElementById('algorithm-fot').checked&&!document.querySelector('.notice,.field-error')"));
  if(fixture){
   await evaluate(send,SELECT('client-model','fake:fake'));await evaluate(send,SELECT('server-model','fake:fake'));
   for(const [field,id,cap] of [['models','models-error','1'],['rounds','rounds-label-error','2'],['params','params-error','3']]){
    await evaluate(send,`window.__qaIssues=[{field:${JSON.stringify(field)},message:'验证：'+${JSON.stringify(field)}}];void 0`);
    await evaluate(send,SEARCH('trial-cap',cap));await sleep(700);await evaluate(send,`${start}.click();void 0`);await sleep(500);
    check('后端'+field+'错误在对应配置原位 '+width,await evaluate(send,`document.getElementById(${JSON.stringify(id)})?.textContent.includes('验证：'+${JSON.stringify(field)})&&!document.querySelector('.notice')&&window.__writes===0`));
    if(field==='params')check('高级参数出错自动展开且提示可见 '+width,await evaluate(send,"document.querySelector('details.module').open&&document.getElementById('params-error').getBoundingClientRect().top>=0&&document.getElementById('params-error').getBoundingClientRect().bottom<=innerHeight"));
   }
  }
  await open(send,base+'#/tasks/new/horizontal');await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await evaluate(send,`${start}.click();void 0`);await sleep(45);
  check('减少动态保留错误与焦点且不震动 '+width,await evaluate(send,`Boolean(document.getElementById('algorithm-label-error'))&&document.activeElement.matches('input[name=algorithm]')&&${start}.getAnimations().length===0`));
  check('所有不完整提交未发业务写入 '+width,await evaluate(send,"window.__writes===0&&!document.querySelector('dialog[open]')&&document.documentElement.scrollWidth<=innerWidth"));
 }
 writeFileSync(`${out}/evidence.json`,JSON.stringify({base,evidence},null,2));
}finally{close()}
