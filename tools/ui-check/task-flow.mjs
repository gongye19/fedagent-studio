// 真正的本地假模型流程：浏览器配置 → runner → 发布 → 对比；只清理本脚本创建的记录。
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch,viewport,open,evaluate,sleep,NEW_TASK_ALL,SELECT,SEARCH} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8880/';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'仅允许本地假模型验证');
const read=async(path)=>{const r=await fetch(new URL(path,base));assert.ok(r.ok,path);return r.json()};
assert.ok((await read('v1/endpoints')).some(e=>e.id==='fake'&&e.kind==='fake'&&e.models.includes('fake')),'必须先启动本地 fake 接口');
const original={tasks:(await read('v1/tasks')).map(t=>t.id).sort(),apps:(await read('v1/apps')).map(a=>a.id).sort()};
const out=process.env.CDP_OUT??'/tmp/fedagent-task-flow';mkdirSync(out,{recursive:true});
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9392),profile:'/tmp/fedagent-task-flow-profile'});
const evidence=[];let taskId,appId;
function check(name,ok){assert.ok(ok,name);evidence.push(name);console.log('PASS',name)}
async function until(expression){const end=Date.now()+30000;while(Date.now()<end){if(await evaluate(send,expression))return;await sleep(200)}throw Error('Timed out: '+expression)}
async function click(label){await evaluate(send,`(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled);if(!e)throw Error('missing action');e.click()})()`);await sleep(250)}
async function set(id,value){await evaluate(send,`(()=>{const e=document.getElementById(${JSON.stringify(id)}),p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(200)}
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
try{
 await viewport(send,{width:1280,height:900});await open(send,base+'#/tasks/new/horizontal');
 await evaluate(send,NEW_TASK_ALL);await evaluate(send,SELECT('rounds','2'));await set('trial-cap','1');await set('task-name','配置流程验证（本地假模型）');
 await evaluate(send,SELECT('client-model','fake:fake'));await evaluate(send,SELECT('server-model','fake:fake'));
 await until("Boolean(document.querySelector('.config-test-trigger[data-ready=true]:not(:disabled)'))");await click('测试配置');await until("Boolean(document.querySelector('.summary-start[data-ready=true]:not(:disabled)'))");
 check('新组件选模型与真实后端配置校验接通',await evaluate(send,"document.querySelector('input[name=client-model]').value==='fake:fake'&&document.querySelector('input[name=server-model]').value==='fake:fake'"));
 await shot('configured');await click('创建并试跑');await until("location.hash.includes('/tasks/task-')");taskId=await evaluate(send,"location.hash.split('/')[2]");
 let task;for(let i=0;i<100;i++){task=await read('v1/tasks/'+taskId);assert.notEqual(task.status,'paused',task.error);if(task.status==='completed')break;await sleep(300)}
 check('真实本地 runner 完成两轮假模型任务',task.status==='completed'&&task.config.rounds===2&&task.fake&&task.config.participants.length===8);
 await open(send,base+'#/tasks/'+taskId+'/output');await click('发布为应用');await set('publish-name','配置流程验证应用（本地假模型）');await click('发布');
 await until("[...document.querySelectorAll('a')].some(e=>e.textContent==='立即试用')");await click('立即试用');await until("Boolean(document.getElementById('try-question'))");appId=await evaluate(send,"location.hash.split('/')[2]");
 if(await evaluate(send,"Boolean(document.querySelector('[data-select-name=model]'))"))await evaluate(send,SELECT('model','fake:fake'));
 await evaluate(send,SELECT('model','fake:fake'));await set('try-question','1 + 1');await set('try-answer','2');await click('运行对比');await until("Boolean(document.getElementById('try-result'))");
 check('发布后真实假模型两侧回答与判分显示',await evaluate(send,"document.querySelectorAll('.compare-item').length===2&&document.querySelectorAll('.verdict').length===2&&document.querySelectorAll('.compare-usage').length===2"));
 await evaluate(send,"document.getElementById('try-result').scrollIntoView({block:'center'})");await shot('comparison');
 writeFileSync(`${out}/evidence.json`,JSON.stringify({taskId,appId,evidence},null,2));
}finally{
 if(appId){const r=await fetch(new URL('v1/apps/'+appId,base),{method:'DELETE'});assert.ok(r.ok,'清理本轮本地应用')}
 if(taskId){const r=await fetch(new URL('v1/tasks/'+taskId,base),{method:'DELETE'});assert.ok(r.ok,'清理本轮本地任务')}
 close();
 assert.deepEqual((await read('v1/tasks')).map(t=>t.id).sort(),original.tasks,'保留原有本地任务');assert.deepEqual((await read('v1/apps')).map(a=>a.id).sort(),original.apps,'保留原有本地应用');
 console.log('PASS 原有本地任务和应用逐项保留');
}
