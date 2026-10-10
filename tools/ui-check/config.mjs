// T68／T69：配置分区／菜单／重置／ⓘ／AI Elements 模型选择；只读和响应夹具，不创建任务或调用模型。
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch,viewport,open,evaluate,sleep,NEW_TASK_ALL,OPEN_ADVANCED,PICK,SEARCH,SELECT} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8880/';
const fixture=process.env.CONFIG_FIXTURES!=='0'&&['localhost','127.0.0.1'].includes(new URL(base).hostname);
const out=process.env.CDP_OUT??'/tmp/fedagent-config';mkdirSync(out,{recursive:true});
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9390),profile:'/tmp/fedagent-config-profile'});
const evidence=[];
function check(name,ok){assert.ok(ok,name);evidence.push(name);console.log('PASS',name)}
async function key(key){await send('Input.dispatchKeyEvent',{type:'keyDown',key});await send('Input.dispatchKeyEvent',{type:'keyUp',key});await sleep(200)}
async function point(selector){return evaluate(send,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)}
async function click(selector,touch=false){const r=await point(selector);if(touch){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[r]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}else{await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...r});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...r})}await sleep(350)}
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
const source=`(()=>{const original=fetch.bind(window);window.__writes=0;window.fetch=async(input,init)=>{const method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;if(!['GET','HEAD'].includes(method)&&path!=='/v1/tasks/validate'){window.__writes++;throw Error('Config check blocks business writes')}const response=await original(input,init);if(!${fixture}||!response.ok||path!=='/v1/endpoints')return response;const list=await response.json();return new Response(JSON.stringify(list.map(e=>e.id==='fake'?{...e,models:['fake','config-alpha','config-beta']}:e)),{headers:{'content-type':'application/json'}})}})()`;
await send('Page.addScriptToEvaluateOnNewDocument',{source});
const tip='button[aria-label="FoT说明"]';
const rows=`(()=>{const rows=[...document.querySelectorAll('.task-config .field-grid > .field')].filter(e=>e.getBoundingClientRect().height);return rows.map(e=>{const h=e.querySelector('.field-head').getBoundingClientRect(),c=e.querySelector('.field-control').getBoundingClientRect();return {label:e.querySelector('.field-label').textContent,h:{x:h.x,y:h.y+scrollY,b:h.bottom+scrollY},c:{x:c.x,y:c.y+scrollY,w:c.width}}})})()`;
try{
 for(const width of [1280,390]){
  const touch=width===390;await viewport(send,{width,height:touch?844:900,mobile:touch});await open(send,base+'#/tasks/new/horizontal');
  check('首次打开固定区域齐全且未替用户选 '+width,await evaluate(send,"document.querySelector('.task-config')&&document.getElementById('rounds-pending').disabled&&document.getElementById('trial-cap')&&!document.querySelector('input[name=algorithm]:checked')&&document.querySelectorAll('button[role=radio][aria-checked=true]').length===1&&document.querySelector('main').textContent.includes('参与方')"));
  check('名称并入配置且只有三个固定分区 '+width,await evaluate(send,"!document.getElementById('basic')&&document.getElementById('task-name').closest('section').id==='scenario'&&document.querySelectorAll('.order-main > section.panel').length===3"));
  check('独立重置按钮首次显示但不可用 '+width,await evaluate(send,"document.querySelector('.page-actions button').textContent.trim()==='重置配置'&&document.querySelector('.page-actions button').disabled"));
  await click(tip,touch);
  check('前置未选仍能阅读算法且不误选 '+width,await evaluate(send,"Boolean(document.querySelector('[role=tooltip]'))&&!document.querySelector('input[name=algorithm]:checked')&&document.querySelector('[role=tooltip]').textContent.includes('经验库')"));
  await shot('config-tip-'+width);await key('Escape');
  check('Esc关闭说明 '+width,await evaluate(send,"!document.querySelector('[role=tooltip]')"));
  await evaluate(send,NEW_TASK_ALL);await sleep(350);
  check('较多单选收进菜单而非平铺 '+width,await evaluate(send,"document.querySelector('[data-select-name=rounds]')&&document.querySelector('#settings [role=radiogroup]').querySelectorAll('button').length===2"));
  await click('[data-select-name=rounds]',touch);await key('End');await shot('rounds-menu-'+width);await key('Enter');
  check('键盘选择数字轮次接通摘要 '+width,await evaluate(send,"document.querySelector('input[name=rounds]').value==='6'&&document.querySelector('.summary-list').textContent.includes('6 轮')"));
  await evaluate(send,SELECT('rounds','2'));
  const before=await evaluate(send,rows);await click(tip,touch);
  check('ⓘ浮层不改变行高或控件位置 '+width,JSON.stringify(before)===JSON.stringify(await evaluate(send,rows)));
  check('浮层在视口内 '+width,await evaluate(send,"(()=>{const r=document.querySelector('.info-tip').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()"));
  await click(tip,touch);check('再次点击收起 '+width,await evaluate(send,"!document.querySelector('[role=tooltip]')"));
  if(!touch){
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await sleep(300);
   const r=await point(tip);await send('Input.dispatchMouseEvent',{type:'mouseMoved',...r});await sleep(450);
   check('真实鼠标悬停展示说明 '+width,await evaluate(send,"Boolean(document.querySelector('[role=tooltip]'))"));
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});await sleep(350);
   check('离开悬停收起 '+width,await evaluate(send,"!document.querySelector('[role=tooltip]')"));
  }
  await evaluate(send,"document.getElementById('algorithm-fot').focus();void 0");await key('Tab');await sleep(350);
  check('键盘聚焦可读说明 '+width,await evaluate(send,"Boolean(document.querySelector('[role=tooltip]'))"));
  await key('Tab');check('移走键盘焦点关闭说明 '+width,await evaluate(send,"!document.querySelector('[role=tooltip]')"));
  await click(tip,touch);await click('h1',touch);check('点击外部关闭 '+width,await evaluate(send,"!document.querySelector('[role=tooltip]')"));
  const layout=await evaluate(send,rows);
  check('普通字段逐项排布且标签控件对齐 '+width,layout.every((r,i)=>touch?r.c.y>=r.h.b-1:Math.abs(r.c.x-layout[0].c.x)<1)&&layout.every((r,i)=>i===0||r.h.y>layout[i-1].h.y));
  await evaluate(send,SEARCH('trial-cap','7'));const trial=await evaluate(send,"document.getElementById('trial-cap').closest('.field').getBoundingClientRect().height");
  await evaluate(send,PICK(['正式运行']));
  check('正式运行保留样本行并明确全部样本 '+width,await evaluate(send,`document.getElementById('trial-cap').disabled&&document.getElementById('trial-cap').placeholder==='全部样本'&&document.getElementById('trial-cap').closest('.field').getBoundingClientRect().height===${trial}`));
  await evaluate(send,PICK(['试跑']));check('切回试跑保留样本数 '+width,await evaluate(send,"document.getElementById('trial-cap').value==='7'&&!document.getElementById('trial-cap').disabled"));
  if(fixture){
   await click('[data-model-name=client-model]',touch);
   check('模型选择初始聚焦搜索并有可访问名称 '+width,await evaluate(send,"document.activeElement.matches('[cmdk-input]')&&document.querySelector('[role=dialog]').getAttribute('aria-labelledby')&&document.querySelector('[role=dialog]').textContent.includes('选择模型')"));
   await send('Input.insertText',{text:'config-beta'});await sleep(250);
   check('真实输入搜索仅展示后端登记匹配模型 '+width,await evaluate(send,"document.querySelectorAll('[cmdk-item]').length===1&&document.querySelector('[cmdk-item]').dataset.modelValue==='fake:config-beta'"));
   await shot('model-search-'+width);await key('Enter');
   check('回车选择写入模型引用并恢复触发焦点 '+width,await evaluate(send,"document.querySelector('input[name=client-model]').value==='fake:config-beta'&&document.activeElement.dataset.modelName==='client-model'&&!document.querySelector('[role=dialog]')"));
   await click('[data-model-name=client-model]',touch);await send('Input.insertText',{text:'missing-no-model'});await sleep(250);
   check('搜索空状态准确且不改已选模型 '+width,await evaluate(send,"document.querySelector('[cmdk-empty]').textContent==='没有匹配的模型'&&document.querySelector('input[name=client-model]').value==='fake:config-beta'"));
   await key('Escape');check('取消模型选择恢复焦点 '+width,await evaluate(send,"!document.querySelector('[role=dialog]')&&document.activeElement.dataset.modelName==='client-model'"));
  }else{check('线上只有一个模型直接展示 '+width,await evaluate(send,"!document.querySelector('[data-model-name=client-model]')&&document.querySelector('.task-config').textContent.includes('gpt-5.6-luna')"))}
  await evaluate(send,"document.getElementById('settings').scrollIntoView({block:'start'});window.scrollBy(0,innerWidth>900?-16:-72);void 0");await sleep(350);await shot('config-settings-'+width);
  await evaluate(send,OPEN_ADVANCED);await sleep(300);await click('button[aria-label="并发数说明"]',touch);
  check('高级参数解释不占配置行 '+width,await evaluate(send,"document.querySelector('[role=tooltip]').textContent.includes('同时发出的模型调用数')&&!document.querySelector('.field-help')"));
  await shot('advanced-tip-'+width);await key('Escape');
  check('无横向溢出且业务写入为零 '+width,await evaluate(send,"document.documentElement.scrollWidth<=innerWidth&&window.__writes===0"));
  await evaluate(send,"document.querySelector('details.module').open=false;window.scrollTo(0,0);void 0");await sleep(350);await shot('config-'+width);
  await evaluate(send,SEARCH('task-name','配置重置验证'));
  await open(send,base+'#/tasks/new/horizontal',undefined,{reset:false});
  check('恢复提示只含信息和关闭操作 '+width,await evaluate(send,"[...document.querySelectorAll('.notice')].some(n=>n.textContent.includes('已恢复'))&&![...document.querySelectorAll('.notice button')].some(b=>b.textContent.includes('清空')||b.textContent.includes('重置'))&&Boolean(document.querySelector('.page-actions button:not(:disabled)'))"));
  await click('.page-actions button',touch);
  check('重置确认居中且默认继续编辑 '+width,await evaluate(send,"document.querySelectorAll('dialog[open]').length===1&&document.querySelector('dialog').matches(':modal')&&document.activeElement.textContent==='继续编辑'&&document.querySelector('.notice').textContent.includes('已恢复')"));
  await shot('reset-confirm-'+width);await key('Escape');
  check('取消重置保留草稿并恢复按钮焦点 '+width,await evaluate(send,"document.getElementById('task-name').value==='配置重置验证'&&document.querySelector('input[name=rounds]').value==='2'&&document.querySelector('#pick-p-a').checked&&document.activeElement===document.querySelector('.page-actions button')"));
  await click('.page-actions button',touch);await click('dialog .button--danger-solid',touch);
  check('确认重置清理选择名称及恢复提示 '+width,await evaluate(send,"!document.querySelector('dialog[open]')&&!document.querySelector('.notice')&&document.getElementById('task-name').value!=='配置重置验证'&&!document.querySelector('input[name=algorithm]:checked')&&document.getElementById('rounds-pending').disabled&&document.getElementById('trial-cap').value==='5'&&document.querySelector('.page-actions button').disabled"));
  check('重置后页面无溢出且未触发业务写入 '+width,await evaluate(send,"document.documentElement.scrollWidth<=innerWidth&&window.__writes===0"));
  await evaluate(send,"window.scrollTo(0,0);void 0");await sleep(250);await shot('config-initial-'+width);

 }
 writeFileSync(`${out}/evidence.json`,JSON.stringify({base,fixture,evidence},null,2));
}finally{close()}
