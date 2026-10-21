// 已有资源选择 → 主动测试 → FoT两轮 → 发布／试用。线上必须显式允许付费。
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch,viewport,open,evaluate,sleep,SELECT} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8880/',local=['127.0.0.1','localhost'].includes(new URL(base).hostname);
if(!local)assert.equal(process.env.REAL_MODEL_VERIFY,'1');
const out=process.env.CDP_OUT??'/tmp/fedagent-resource-flow';mkdirSync(out,{recursive:true});
const owned={},evidence=[];const check=(n,v)=>{assert.ok(v,n);evidence.push(n);console.log('PASS',n)};
async function req(path,method='GET',body){const r=await fetch(new URL('v1/'+path,base),{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,await r.clone().text());return r.status===204?null:r.json()}
const original={tasks:await req('tasks'),apps:await req('apps')},datasets=await req('datasets');
const data=datasets.filter(d=>d.taskType==='math-reasoning'&&d.ready&&d.shared&&d.source==='builtin').slice(0,2);assert.equal(data.length,2);
const endpoints=await req('endpoints'),endpoint=endpoints.find(e=>e.configured&&(local?e.kind==='fake':e.kind!=='fake'));assert.ok(endpoint);
const model=endpoint.id==='default'?'default':endpoint.id+':'+endpoint.models[0];
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9402),profile:'/tmp/fedagent-resource-flow-profile'});
async function click(text){await evaluate(send,`(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled);if(!e)throw Error('missing '+${JSON.stringify(text)});e.click()})()`);await sleep(200)}
async function set(id,value){await evaluate(send,`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await sleep(120)}
async function until(s,ms=40000){const end=Date.now()+ms;while(Date.now()<end){if(await evaluate(send,`Boolean(${s})`))return;await sleep(local?150:1000)}throw Error('timeout '+s)}
const save=()=>writeFileSync(out+'/owned.json',JSON.stringify(owned,null,2));
try{
 await viewport(send,{width:1280,height:900});await open(send,base+'#/tasks/new',local?1300:4000);
 await click('横向联邦');await evaluate(send,"document.getElementById('algorithm-fot').click()");await sleep(180);await click('数学推理');
 check('任务只选择已有资源，不按来源切换或现场登记',await evaluate(send,"!document.querySelector('#participants .resource-space-bar')&&!document.querySelector('input[type=file]')&&![...document.querySelectorAll('#participants button')].some(b=>['接入数据','接入 LLM','上传'].includes(b.textContent.trim()))"));
 for(const d of data)await evaluate(send,`document.getElementById('pick-${d.participantId}').click()`);
 await evaluate(send,SELECT('client-model',model));await evaluate(send,SELECT('server-model',model));await evaluate(send,SELECT('rounds',2));await set('trial-cap','1');
 await click('正式运行');await until("document.querySelector('.config-test-trigger[data-ready=true]:not(:disabled)')");check('两份已有共享数据可用于正式配置',true);
 await click('试跑');await set('task-name','已有共享资源流程验证（完成后清理）');await until("document.querySelector('.config-test-trigger[data-ready=true]:not(:disabled)')");
 await click('测试配置');await until("JSON.parse(sessionStorage.getItem('fedagent-studio:config-check')??'null')?.id");owned.checkId=await evaluate(send,"JSON.parse(sessionStorage.getItem('fedagent-studio:config-check')).id");save();
 await until("document.querySelector('.summary-start[data-ready=true]:not(:disabled)')",local?60000:180000);check('所选数据和LLM的组合测试通过',true);
 await click('创建并试跑');await until("location.hash.includes('/tasks/task-')");owned.taskId=await evaluate(send,"location.hash.split('/')[2]");save();
 let task;const end=Date.now()+(local?60000:900000);
 while(Date.now()<end){task=await req('tasks/'+owned.taskId);assert.ok(!['paused','canceled'].includes(task.status),task.error);if(task.status==='completed')break;await sleep(local?200:3000)}
 check('共享数据完成两轮真实任务流程',task.status==='completed'&&task.rounds.filter(r=>r.output).length===2);
 await open(send,base+`#/tasks/${owned.taskId}/output`,local?1300:4000);await click('发布为应用');await set('publish-name','已有资源成果验证（完成后清理）');await click('发布');await until("[...document.querySelectorAll('a')].some(a=>a.textContent==='立即试用')");
 owned.appId=(await req('apps')).find(a=>a.taskId===owned.taskId).id;save();await click('立即试用');await until("document.getElementById('try-question')");
 check('应用试用不预选唯一模型',await evaluate(send,"document.querySelector('input[name=model]').value===''&&document.getElementById('try-model').textContent.includes('请选择模型')"));
 await evaluate(send,SELECT('model',model));await set('try-question','1 + 1');await set('try-answer','2');await evaluate(send,SELECT('model','__clear'));
 check('应用清除模型后不能发起比较且不自动回填',await evaluate(send,"document.querySelector('input[name=model]').value===''&&[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='运行对比').disabled"));
 await evaluate(send,SELECT('model',model));await click('运行对比');await until("document.getElementById('try-result')",local?60000:300000);
 check('发布成果可选择模型并对比试用',await evaluate(send,"document.querySelectorAll('.compare-item').length===2"));
 writeFileSync(out+'/evidence.json',JSON.stringify({base,owned,evidence},null,2));
}finally{
 close();
 if(owned.appId)await req('apps/'+owned.appId,'DELETE');
 if(owned.taskId){const task=await req('tasks/'+owned.taskId);assert.ok(['completed','canceled'].includes(task.status),'未结束任务保留');await req('tasks/'+owned.taskId,'DELETE')}
 if(owned.checkId)await req('task-checks/'+owned.checkId,'DELETE');
 for(const kind of ['tasks','apps']){const ids=(await req(kind)).map(r=>r.id);for(const r of original[kind])assert.ok(ids.includes(r.id));assert.ok(!ids.includes(owned[kind==='tasks'?'taskId':'appId']))}
 for(const d of datasets)assert.ok((await req('datasets')).some(r=>r.id===d.id));
 console.log('PASS 原资源保留，只清理本次验证记录');
}
