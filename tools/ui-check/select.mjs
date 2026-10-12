// 选择控件回归：真实只读接口 + 本地响应夹具；禁止业务写入与模型调用。
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, viewport, open, evaluate, sleep, sampleIds, PICK, SELECT, OPEN_ADVANCED, LOCAL_CONNECTION_SOURCE } from './lib.mjs';
const base = process.env.BASE ?? 'http://127.0.0.1:8880/';
const fixture = process.env.SELECT_FIXTURES !== '0' && ['127.0.0.1', 'localhost'].includes(new URL(base).hostname);
const ids = await sampleIds(base);
const out = process.env.CDP_OUT ?? '/tmp/fedagent-select'; mkdirSync(out, {recursive:true});
const {send,close} = await launch({port:Number(process.env.CDP_PORT ?? 9380), profile:'/tmp/fedagent-select-profile'});
const evidence=[];
function check(name,ok){assert.ok(ok,name);evidence.push(name);console.log('PASS',name)}
async function key(key){await send('Input.dispatchKeyEvent',{type:'keyDown',key});await send('Input.dispatchKeyEvent',{type:'keyUp',key});await sleep(200)}
async function click(selector){const r=await evaluate(send,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...r});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...r});await sleep(200)}
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
const source=`(()=>{const original=fetch.bind(window);window.__writes=0;window.fetch=async(input,init)=>{const method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;if(!['GET','HEAD'].includes(method)&&path!=='/v1/tasks/validate'){window.__writes++;throw Error('Select check blocks writes: '+method)}const response=await original(input,init);if(!${fixture}||!response.ok)return response;if(path==='/v1/datasets'){const list=await response.json();const a=list.find(d=>d.participantId==='p-a');return new Response(JSON.stringify([...list,{...a,id:'fixture-second',name:'另一份题库（仅前端验证夹具）'}]),{headers:{'content-type':'application/json'}})}if(path==='/v1/endpoints'){const list=await response.json();return new Response(JSON.stringify(list.map(e=>e.id==='fake'?{...e,models:['fake',...Array.from({length:30},(_,i)=>'fixture-model-'+i+'-用于验证长名称的模型接口显示及选项滚动')]}:e)),{headers:{'content-type':'application/json'}})}return response}})()`;
await send('Page.addScriptToEvaluateOnNewDocument',{source:LOCAL_CONNECTION_SOURCE});
await send('Page.addScriptToEvaluateOnNewDocument',{source});
try{
 for(const width of [1280,390]){
  await viewport(send,{width,height:width===390?844:900,mobile:width===390});await open(send,base+'#/tasks');
  check('筛选触发器有名称且没有原生可见菜单 '+width,await evaluate(send,"document.querySelectorAll('[role=combobox][aria-label]').length===2&&![...document.querySelectorAll('select')].some(s=>s.getBoundingClientRect().height>1)"));
  await click('[data-select-name="task-status"]');
  check('选中项勾选且弹层位于控件下方 '+width,await evaluate(send,"(()=>{const t=document.querySelector('[data-select-name=task-status]').getBoundingClientRect(),m=document.querySelector('[role=listbox]').getBoundingClientRect();return m.top>=t.bottom&&Math.abs(m.left-t.left)<2&&m.right<=innerWidth&&document.querySelector('[data-state=checked] .select-check')&&document.querySelectorAll('[role=option]').length===6})()"));await shot('status-open-'+width);
  await key('ArrowDown');await key('Enter');
  check('键盘选择排队并真实过滤且恢复焦点 '+width,await evaluate(send,"document.querySelector('[data-select-name=task-status]').textContent.includes('排队中')&&!document.querySelector('.table--tasks tbody tr')&&document.activeElement.dataset.selectName==='task-status'"));
  await click('[data-select-name="task-status"]');await key('End');await key('Escape');await sleep(180);
  check('Esc取消不改变已选值 '+width,await evaluate(send,"!document.querySelector('[role=listbox]')&&document.activeElement.textContent.includes('排队中')"));
  await click('[data-select-name="task-status"]');await key('Home');await key('Enter');await sleep(180);
  check('恢复全部状态后列表回来 '+width,await evaluate(send,"Boolean(document.querySelector('.table--tasks tbody tr'))&&document.querySelector('[data-select-name=task-status]').textContent.includes('全部状态')"));
  await click('[data-select-name="task-status"]');await click('h1');await sleep(180);
  check('点击外部关闭且筛选不改变 '+width,await evaluate(send,"!document.querySelector('[role=listbox]')&&document.querySelector('[data-select-name=task-status]').textContent.includes('全部状态')"));
  await evaluate(send,SELECT('task-type','math-reasoning'));
  check('任务类型选择正确写入状态 '+width,await evaluate(send,"document.querySelector('[data-select-name=task-type]').textContent.includes('数学推理')&&document.querySelector('input[name=task-type]').value==='math-reasoning'"));
  await open(send,base+'#/datasets/new');
  check('参与方初始占位而未默认选择 '+width,await evaluate(send,"document.querySelector('[data-select-name=dataset-owner]').hasAttribute('data-placeholder')&&!document.querySelector('[role=listbox]')"));
  await click('label[for="dataset-owner"]');
  check('点字段名可打开选择且占位不作为选项 '+width,await evaluate(send,"Boolean(document.querySelector('[role=listbox]'))&&![...document.querySelectorAll('[role=option]')].some(e=>e.textContent==='选择参与方')"));await key('Escape');
  await evaluate(send,SELECT('dataset-owner','qa-local-client'));
  check('参与方变化接通对应表单 '+width,await evaluate(send,"document.querySelector('input[name=dataset-owner]').value==='qa-local-client'&&document.querySelector('main').textContent.includes('参与方本地')"));
  await open(send,base+'#/tasks/new/horizontal');
  check('前置未选的轮次确实禁用 '+width,await evaluate(send,"document.getElementById('rounds-pending').disabled"));
  await evaluate(send,PICK(['数学推理']));await click('#algorithm-fot');
  if(fixture){
   await click('[data-select-name="dataset-p-a"]');await click('[data-option-value="fixture-second"]');
   check('表格选择题库保留参与方勾选 '+width,await evaluate(send,"document.querySelector('input[name=dataset-p-a]').value==='fixture-second'&&document.querySelector('[data-select-name=dataset-p-a]').closest('tr').querySelector('input[type=checkbox]').checked"));
   await click('[data-model-name="client-model"]');await key('End');
   check('长模型菜单限高且尾部可见 '+width,await evaluate(send,"(()=>{const m=document.querySelector('.model-picker [role=listbox]').getBoundingClientRect(),f=document.querySelector('.model-picker [cmdk-item][data-selected=true]').getBoundingClientRect();return m.height<=382&&m.right<=innerWidth&&m.left>=0&&f.top>=m.top&&f.bottom<=m.bottom})()"));await shot('models-scroll-'+width);await key('Enter');
   check('长模型名选择后触发器不撑破页面 '+width,await evaluate(send,"document.querySelector('[data-model-name=client-model]').title.includes('fixture-model-29')&&document.documentElement.scrollWidth<=innerWidth"));
  }
  await evaluate(send,OPEN_ADVANCED);
  if(fixture){
   await evaluate(send,"[...document.querySelectorAll('button')].find(b=>b.textContent.includes('为某个参与方指定')).click();void 0");await sleep(200);
   await click('.override-list button[aria-label$=模型]');await key('Home');await key('ArrowDown');await key('Enter');
   check('单独模型选择不改默认模型 '+width,await evaluate(send,"document.querySelector('.override-list button[aria-label$=模型]').textContent.includes('fake · 测试用假模型')&&document.getElementById('client-model').title.includes('fixture-model-29')"));
  }
  await evaluate(send,SELECT('maxTracesPerItem','2'));await evaluate(send,SELECT('maxTracesPerItem',''));
  check('数值参数可恢复有效空值不限 '+width,await evaluate(send,"document.querySelector('input[name=maxTracesPerItem]').value===''&&document.querySelector('[data-select-name=maxTracesPerItem]').textContent.includes('不限')"));
  await evaluate(send,SELECT('insightTarget','fixed-11'));
  check('枚举参数联动摘要 '+width,await evaluate(send,"document.querySelector('[data-select-name=insightTarget]').textContent.includes('固定 11 条')&&document.querySelector('.panel--collapsible').textContent.includes('已改')"));
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await click('[data-select-name="insightTarget"]');
  check('减少动态仍能展开且动画近零 '+width,await evaluate(send,"parseFloat(getComputedStyle(document.querySelector('.select-menu')).animationDuration)<.001"));await key('Escape');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  if(ids.task){await open(send,base+'#/tasks/'+ids.task+'/overview');await click('.tabs a:nth-child(2)');check('切换标签有滑动指示条且定位正确 '+width,await evaluate(send,"(()=>{const tab=document.querySelector('.tab--active').getBoundingClientRect(),bar=document.querySelector('.tab-indicator').getBoundingClientRect();return Math.abs(tab.left-bar.left)<2&&Math.abs(tab.width-bar.width)<2})()"));}
  if(ids.task){
   await open(send,base+'#/tasks/'+ids.task+'/output');
   const version=await evaluate(send,"document.querySelector('input[name=version]')?.value");
   if(version){await evaluate(send,SELECT('version','1'));check('版本选择接通数字状态与对应内容 '+width,await evaluate(send,"document.querySelector('input[name=version]').value==='1'&&document.querySelector('[data-select-name=version]').textContent.includes('1')"));await evaluate(send,SELECT('version',version));}
  }
  if(fixture&&ids.app){await open(send,base+'#/apps/'+ids.app+'/try');await evaluate(send,SELECT('model','fake:fixture-model-0-用于验证长名称的模型接口显示及选项滚动'));check('应用试用模型选择接通真实控件状态 '+width,await evaluate(send,"document.getElementById('try-model').title.includes('fixture-model-0')&&document.querySelector('input[name=model]').value.startsWith('fake:fixture-model-0')"));}
  check('没有触发业务写入 '+width,await evaluate(send,'window.__writes===0'));
 }
 writeFileSync(out+'/evidence.json',JSON.stringify({base,fixture,evidence},null,2));
}finally{close()}
