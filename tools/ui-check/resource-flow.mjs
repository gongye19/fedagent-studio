// T78: real intake -> mixed scopes -> task -> application. Explicit opt-in for paid verification.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {launch,viewport,open,evaluate,sleep,SELECT} from './lib.mjs';

const base=process.env.BASE??'http://127.0.0.1:8880/';
const local=['127.0.0.1','localhost'].includes(new URL(base).hostname);
if(!local)assert.equal(process.env.REAL_MODEL_VERIFY,'1','Real calls require explicit opt-in');
const out=process.env.CDP_OUT??'/tmp/fedagent-resource-flow';mkdirSync(out,{recursive:true});
const read=async path=>{const r=await fetch(new URL(path,base));assert.ok(r.ok,path);return r.json()};
const endpoints=await read('v1/endpoints');
const endpoint=endpoints.find(e=>local?e.kind==='fake':e.configured&&e.kind!=='fake');assert.ok(endpoint);
const model=endpoint.id==='default'?'default':`${endpoint.id}:${endpoint.models[0]}`;
const original=Object.fromEntries(await Promise.all(['tasks','apps','datasets','participants','endpoints'].map(async k=>[k,(await read(`v1/${k}`)).map(x=>x.id).sort()])));
const lines=readFileSync(resolve('server/fedagent/builtin/math/AIME24.jsonl'),'utf8').trim().split('\n');
const input=lines.slice(0,2).join('\n')+'\n';const inputHash=createHash('sha256').update(input).digest('hex');
writeFileSync(`${out}/AIME24-input.jsonl`,input);
writeFileSync(`${out}/invalid.jsonl`,lines[0]+'\n'+lines[0]+'\n');
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9402),profile:'/tmp/fedagent-resource-flow-profile'});
const evidence=[];let resource,taskId,appId,modelEndpointId;
function check(name,ok){assert.ok(ok,name);evidence.push(name);console.log('PASS',name)}
async function until(s,ms=40000){const deadline=Date.now()+ms;while(Date.now()<deadline){if(await evaluate(send,`Boolean(${s})`))return;await sleep(200)}throw Error('Timed out: '+s)}
async function click(text){await evaluate(send,`(()=>{const region=document.querySelector('.resource-dialog')??document.querySelector('dialog[open]')??document.querySelector('main');const matches=e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled;const e=[...region.querySelectorAll('button,a')].find(matches)??[...document.querySelectorAll('button,a')].filter(e=>e.getClientRects().length).find(matches);if(!e)throw Error('Missing '+${JSON.stringify(text)});e.focus();e.click()})()`);await sleep(250)}
async function set(id,value){await evaluate(send,`(()=>{const e=document.getElementById(${JSON.stringify(id)});const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(120)}
async function file(path){const d=await send('DOM.getDocument'),n=await send('DOM.querySelector',{nodeId:d.root.nodeId,selector:'input[name=dataset-file]'});await send('DOM.setFileInputFiles',{nodeId:n.nodeId,files:[path]})}
async function shot(name){const m=await send('Page.getLayoutMetrics');const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:1280,height:Math.ceil(m.cssContentSize.height),scale:1}});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
async function key(key){await send('Input.dispatchKeyEvent',{type:'keyDown',key});await send('Input.dispatchKeyEvent',{type:'keyUp',key});await sleep(200)}
const owned=()=>writeFileSync(`${out}/owned.json`,JSON.stringify({datasetId:resource?.dataset.id,sourceId:resource?.source.id,taskId,appId},null,2));
try{
  await viewport(send,{width:1280,height:900});await open(send,base+'#/tasks/new',local?1500:4000);
  check('通用入口场景未预选，固定资源与运行区域已展示',await evaluate(send,"![...document.querySelectorAll('[aria-labelledby=scenario-label] button')].some(b=>b.getAttribute('aria-checked')==='true')&&Boolean(document.getElementById('participants')&&document.getElementById('settings'))"));
  await click('创建并试跑');check('缺场景在原字段提示',await evaluate(send,"document.getElementById('scenario-label-error')?.textContent.includes('选择场景')&&!document.querySelector('.notice')"));
  await click('横向联邦');await click('数学推理');await evaluate(send,"document.getElementById('algorithm-fot').click()");await sleep(250);
  check('资源入口按已选算法启用，先看我的数据',await evaluate(send,"document.querySelector('#participants .resource-space-bar button[aria-pressed=true]').textContent==='我的资源'&&document.getElementById('client-model')&&!document.getElementById('client-model').disabled"));
  await click('接入数据');check('任务上下文锁定数据类型，未要求先建参与方',await evaluate(send,"document.querySelector('.resource-context').textContent.includes('数学推理')&&!document.querySelector('.resource-dialog [aria-labelledby$=type]')"));
  await click('平台运行');await file(`${out}/invalid.jsonl`);await until("document.querySelector('.check-result--failed')");
  check('错误文件不能保存，未留下空来源',await evaluate(send,"[...document.querySelectorAll('.resource-dialog button')].find(b=>b.textContent==='保存数据').disabled")&&(await read('v1/participants')).length===original.participants.length);
  await file(`${out}/AIME24-input.jsonl`);await until("document.querySelector('.check-result--ok')?.textContent.includes('检查通过')");
  // Actual pointer opening validates nested Select's portal and focus trap.
  await evaluate(send,"document.getElementById('resource-source').focus()");await key('ArrowDown');await until("document.querySelector('[role=listbox]')");
  check('接入弹窗内菜单位于弹窗上方',await evaluate(send,"(()=>{const e=document.querySelector('[role=listbox]');const r=e.getBoundingClientRect();return Number(getComputedStyle(e).zIndex)>Number(getComputedStyle(document.querySelector('.resource-dialog')).zIndex)&&!!document.elementFromPoint(r.x+10,r.y+10)?.closest('[role=listbox]')})()"));
  await key('Escape');await click('保存数据');await until("!document.querySelector('.resource-dialog')");
  const created=(await read('v1/datasets')).find(d=>!original.datasets.includes(d.id)&&d.name==='AIME24-input'&&d.sourceHash===inputHash);assert.ok(created);resource={dataset:created,source:(await read('v1/participants')).find(p=>p.id===created.participantId)};owned();
  check('保存与自动选入真实资源，配置未离开',resource.dataset.resourceSpace==='workspace'&&resource.dataset.count===2&&await evaluate(send,`location.hash==='#/tasks/new'&&document.getElementById('pick-${resource.source.id}').checked&&document.activeElement.textContent.includes('接入数据')`));
  await click('公用资源');await evaluate(send,"document.querySelector('input[aria-label=全选]').click()");await sleep(150);await evaluate(send,"document.querySelector('input[aria-label=全选]').click()");await sleep(150);
  check('另一资源范围全选／取消不清除我的选择',await evaluate(send,"document.querySelector('.resource-selection').textContent.includes('AIME24-input')"));
  await evaluate(send,"document.getElementById('pick-p-b').click()");await sleep(200);
  await evaluate(send,SELECT('rounds','2'));await set('trial-cap','1');await evaluate(send,SELECT('client-model',model));await evaluate(send,SELECT('server-model',model));
  await click('正式运行');await until("document.querySelector('.summary-start[data-ready=true]:not(:disabled)')");
  check('我的与公用数据组合满足正式输入要求',await evaluate(send,"document.querySelector('.summary-start').textContent==='创建并正式运行'"));
  await click('试跑');await until("document.querySelector('.summary-start[data-ready=true]:not(:disabled)')");await shot('mixed-task-config');
  await click('创建并试跑');await until("location.hash.includes('/tasks/task-')");taskId=await evaluate(send,"location.hash.split('/')[2]");owned();
  let task;const deadline=Date.now()+(local?60000:600000);
  while(Date.now()<deadline){task=await read(`v1/tasks/${taskId}`);if(task.status==='completed')break;assert.ok(!['paused','failed','canceled'].includes(task.status),task.error);await sleep(local?300:3000)}
  check('runner使用所选两份真实输入完成两轮',task.status==='completed'&&task.config.participants.length===2&&task.config.rounds===2&&task.config.participants.some(p=>p.datasetId===resource.dataset.id));
  await open(send,base+`#/tasks/${taskId}/output`,local?1500:4000);await click('发布为应用');await set('publish-name','资源流程验证（完成后清理）');await click('发布');await until("[...document.querySelectorAll('a')].some(a=>a.textContent==='立即试用')");appId=(await read('v1/apps')).find(a=>!original.apps.includes(a.id)&&a.taskId===taskId)?.id;assert.ok(appId);owned();await click('立即试用');await until("document.getElementById('try-question')");
  await evaluate(send,SELECT('model',model));await set('try-question','1 + 1');await set('try-answer','2');await click('运行对比');await until("document.getElementById('try-result')",local?30000:240000);
  check('发布后的模型选择、成果使用和对比可用',await evaluate(send,"document.querySelectorAll('.compare-item').length===2&&document.querySelectorAll('.verdict').length===2"));
  await open(send,base+`#/resources/mine/data/${resource.dataset.id}`,local?1500:4000);await shot('my-resource-detail');
  check('我的资源按任务类型分类，公用数据不混入',await evaluate(send,"document.querySelector('.participant-detail')&&document.querySelector('.row-button').textContent.includes('AIME24-input')&&!document.querySelector('main').textContent.includes('AIME25')"));
  await open(send,base+'#/tasks/new',local?1500:4000);await click('横向联邦');await click('数学推理');await evaluate(send,"document.getElementById('algorithm-fot').click()");await sleep(200);await evaluate(send,`document.getElementById('pick-${resource.source.id}').click()`);await click('重置配置');await click('重置');
  check('重置配置不删除已保存资源',await evaluate(send,"!document.querySelector('input[name=algorithm]:checked')")&&(await read('v1/datasets')).some(d=>d.id===resource.dataset.id));
  await viewport(send,{width:390,height:844,mobile:true});await click('横向联邦');await click('数学推理');await evaluate(send,"document.getElementById('algorithm-fot').click()");await sleep(200);await click('接入数据');
  check('窄屏接入窗口可滚动且不横向溢出',await evaluate(send,"document.documentElement.scrollWidth<=390&&document.querySelector('.resource-dialog').getBoundingClientRect().width<=390&&getComputedStyle(document.querySelector('.resource-dialog-body')).overflowY==='auto'"));
  await key('Escape');check('关闭接入保留算法配置并恢复焦点',await evaluate(send,"document.getElementById('algorithm-fot').checked&&!document.querySelector('.resource-dialog')&&document.activeElement.textContent.includes('接入数据')"));
  if(local){
    await click('接入模型');await set('endpoint-name','本地资源接口验证（完成后清理）');await set('endpoint-model','local-check');await set('endpoint-url','http://127.0.0.1:8000/v1');await click('保存接口');await until("!document.querySelector('.resource-dialog')");
    const added=(await read('v1/endpoints')).find(e=>!original.endpoints.includes(e.id));assert.ok(added);modelEndpointId=added.id;
    check('任务中接入模型归入我的资源并写回实际引用',added.resourceSpace==='workspace'&&await evaluate(send,`document.querySelector('input[name=client-model]').value==='${added.id}:local-check'`));
    await open(send,base+'#/resources/mine/models');check('我的模型与公用接口分别展示',await evaluate(send,"document.querySelector('main').textContent.includes('本地资源接口验证')&&!document.querySelector('main').textContent.includes('测试用假模型')"));
  }
  writeFileSync(`${out}/evidence.json`,JSON.stringify({resource,taskId,appId,model,evidence},null,2));
}finally{
  close();
  if(appId)assert.ok((await fetch(new URL(`v1/apps/${appId}`,base),{method:'DELETE'})).ok);
  if(taskId){const task=await read(`v1/tasks/${taskId}`);assert.ok(['completed','canceled'].includes(task.status),'Active task retained for inspection');assert.ok((await fetch(new URL(`v1/tasks/${taskId}`,base),{method:'DELETE'})).ok);}
  if(resource)assert.ok((await fetch(new URL(`v1/resources/data/${resource.dataset.id}`,base),{method:'DELETE'})).ok);
  if(modelEndpointId)assert.ok((await fetch(new URL(`v1/endpoints/${modelEndpointId}`,base),{method:'DELETE'})).ok);
  for(const k of ['tasks','apps','datasets','participants','endpoints'])assert.deepEqual((await read(`v1/${k}`)).map(x=>x.id).sort(),original[k],`Preserve original ${k}`);
  console.log('PASS 仅清理本次任务、应用、数据与托管来源');
}
