// Requires an explicit real-model run flag; cleans only its own records.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch,viewport,open,evaluate,sleep,PICK,SELECT,SEARCH} from './lib.mjs';
assert.equal(process.env.REAL_MODEL_VERIFY,'1','Explicit real-model verification required');
const base='http://100.111.198.54:8880/';
const out=process.env.CDP_OUT??'/tmp/fedagent-real-data-flow';mkdirSync(out,{recursive:true});
const read=async p=>{const r=await fetch(base+p);assert.ok(r.ok,p);return r.json()};
const endpoints=await read('v1/endpoints');assert.equal(endpoints.length,1);assert.ok(endpoints[0].kind!=='fake'&&endpoints[0].hasKey);
const original={tasks:(await read('v1/tasks')).map(x=>x.id).sort(),apps:(await read('v1/apps')).map(x=>x.id).sort()};
const {send,close}=await launch({port:9397,profile:'/tmp/fedagent-t72-real-profile'});let taskId,appId,completed=false;
async function until(expr,seconds=45){const end=Date.now()+seconds*1000;while(Date.now()<end){if(await evaluate(send,expr))return;await sleep(250)}throw Error('Timeout '+expr)}
async function click(text){await evaluate(send,`(()=>{const b=[...document.querySelectorAll('button,a')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);if(!b)throw Error('Missing action');b.click()})()`);await sleep(300)}
async function set(id,value){await evaluate(send,`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await sleep(200)}
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
try{
 await viewport(send,{width:1280,height:900});await open(send,base+'#/tasks/new/horizontal',4000);
 await evaluate(send,PICK(['数学推理']));await evaluate(send,"document.getElementById('algorithm-fot').click();void 0");await sleep(200);
 await evaluate(send,"document.getElementById('pick-p-c').click();document.getElementById('pick-p-h').click();void 0");
 await evaluate(send,SELECT('rounds','2'));await set('trial-cap','1');await set('task-name','T72 数据导入核验（完成后清理）');
 await until("document.querySelector('.summary-start').dataset.ready==='true'");await shot('configured');await click('创建并试跑');await until("location.hash.includes('/tasks/task-')");taskId=await evaluate(send,"location.hash.split('/')[2]");writeFileSync(out+'/owned.json',JSON.stringify({taskId}));console.log('CREATED',taskId);
 const deadline=Date.now()+25*60*1000;let last='';
 while(Date.now()<deadline){const t=await read('v1/tasks/'+taskId);const progress=JSON.stringify({status:t.status,cursor:t.cursor});if(progress!==last){console.log('PROGRESS',progress);last=progress}assert.notEqual(t.status,'paused',t.error);assert.notEqual(t.status,'canceled',t.error);if(t.status==='completed'){completed=true;assert.equal(t.fake,false);assert.equal(t.config.rounds,2);assert.deepEqual(t.config.participants.map(p=>p.participantId).sort(),['p-c','p-h']);break}await sleep(5000)}
 assert.ok(completed,'Real task completed');await open(send,base+'#/tasks/'+taskId+'/output',4000);await shot('output');await click('发布为应用');await set('publish-name','T72 数据核验应用（完成后清理）');await click('发布');await until("[...document.querySelectorAll('a')].some(a=>a.textContent==='立即试用')");await click('立即试用');await until("Boolean(document.getElementById('try-question'))");appId=await evaluate(send,"location.hash.split('/')[2]");writeFileSync(out+'/owned.json',JSON.stringify({taskId,appId}));await set('try-question','1 + 1');await set('try-answer','2');await click('运行对比');await until("Boolean(document.getElementById('try-result'))",180);assert.equal(await evaluate(send,"document.querySelectorAll('.compare-item').length"),2);await shot('comparison');writeFileSync(out+'/evidence.json',JSON.stringify({taskId,appId,completed:true,model:endpoints[0].models[0]},null,2));console.log('PASS real task -> publish -> compare');
}finally{
 if(appId){const r=await fetch(base+'v1/apps/'+appId,{method:'DELETE'});assert.ok(r.ok,'Remove owned validation application')}
 if(taskId&&completed){const r=await fetch(base+'v1/tasks/'+taskId,{method:'DELETE'});assert.ok(r.ok,'Remove owned completed validation task')}
 close();
 if(completed){assert.deepEqual((await read('v1/tasks')).map(x=>x.id).sort(),original.tasks);assert.deepEqual((await read('v1/apps')).map(x=>x.id).sort(),original.apps);console.log('PASS own validation records removed; other records preserved')}
}
