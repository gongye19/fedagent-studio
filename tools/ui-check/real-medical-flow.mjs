// 仅显式真实模型核验运行；保留真实病例，只清理本次已结束的任务／应用。
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {launch,viewport,open,evaluate,sleep,SELECT} from './lib.mjs';
assert.equal(process.env.REAL_MODEL_VERIFY,'1','Explicit real-model verification required');
const base='http://100.111.198.54:8880/',out=process.env.CDP_OUT??'/tmp/fedagent-t75-real';mkdirSync(out,{recursive:true});
const read=async p=>{const r=await fetch(base+p);assert.ok(r.ok,p);return r.json()};
const endpoints=await read('v1/endpoints');assert.equal(endpoints.length,1);assert.ok(endpoints[0].kind!=='fake'&&endpoints[0].configured);
const resume=process.env.RESUME_OWNED_TASK?JSON.parse(readFileSync(out+'/owned.json','utf8')).taskId:undefined;
if(resume)assert.equal(process.env.RESUME_OWNED_TASK,resume,'Resume only the task recorded by this verification');
const original=Object.fromEntries(await Promise.all(['tasks','apps','datasets'].map(async k=>[k,(await read('v1/'+k)).map(x=>x.id).filter(id=>k!=='tasks'||id!==resume).sort()])));
const medical=(await read('v1/datasets')).filter(x=>x.taskType==='medical-diagnosis');assert.equal(medical.length,2);assert.equal(medical.reduce((n,x)=>n+x.count,0),107);
const port=Number(process.env.CDP_PORT??9409);
const {send,close}=await launch({port,profile:`/tmp/fedagent-t75-real-profile-${port}`});let taskId,appId,completed=false;
async function until(expr,seconds=45){const end=Date.now()+seconds*1000;while(Date.now()<end){if(await evaluate(send,expr))return;await sleep(250)}throw Error('Timeout '+expr)}
async function click(text){await evaluate(send,`(()=>{const b=[...document.querySelectorAll('button,a')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);if(!b)throw Error('Missing action '+${JSON.stringify(text)});b.click()})()`);await sleep(300)}
async function set(id,value){await evaluate(send,`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)throw Error('Missing field');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await sleep(200)}
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
try{
 if(!resume){
 await viewport(send,{width:1280,height:900});await open(send,base+'#/tasks/new/horizontal',4000);await click('医疗诊断');await evaluate(send,"document.getElementById('algorithm-evomedclaw').click()");await sleep(200);
 await evaluate(send,"document.querySelector('input[aria-label=全选]').click()");await evaluate(send,SELECT('rounds','2'));await set('trial-cap','2');await set('task-name','T75 医疗接入核验（完成后清理）');
 await until("document.querySelector('.summary-start').dataset.ready==='true'");await shot('configured');await click('创建并试跑');await until("location.hash.includes('/tasks/task-')");taskId=await evaluate(send,"location.hash.split('/')[2]");writeFileSync(out+'/owned.json',JSON.stringify({taskId}));console.log('CREATED',taskId);
 }else{taskId=resume;await viewport(send,{width:1280,height:900});console.log('RESUMED',taskId)}
 const deadline=Date.now()+30*60*1000;let last='';
 while(Date.now()<deadline){const t=await read('v1/tasks/'+taskId);const progress=JSON.stringify({status:t.status,cursor:t.cursor});if(progress!==last){console.log('PROGRESS',progress);last=progress}assert.notEqual(t.status,'paused',t.error);assert.notEqual(t.status,'canceled',t.error);if(t.status==='completed'){completed=true;assert.equal(t.fake,false);assert.equal(t.config.rounds,2);assert.equal(t.config.algorithm,'evomedclaw');assert.ok(t.members.every(x=>x.problems===2&&x.answered===1));writeFileSync(out+'/task.json',JSON.stringify(t,null,2));break}await sleep(5000)}
 assert.ok(completed,'Real task completed');await open(send,base+'#/tasks/'+taskId+'/output',4000);await shot('output');await click('发布为应用');await set('publish-name','T75 医疗核验应用（完成后清理）');await click('发布');await until("[...document.querySelectorAll('a')].some(a=>a.textContent==='立即试用')");await click('立即试用');await until("Boolean(document.getElementById('try-patient'))");appId=await evaluate(send,"location.hash.split('/')[2]");writeFileSync(out+'/owned.json',JSON.stringify({taskId,appId}));
 const src=JSON.parse(readFileSync(resolve('../../.references/medical/medqa-group-1.jsonl'),'utf8').split('\n')[0]).OSCE_Examination,txt=x=>typeof x==='string'?x:JSON.stringify(x,null,2);
 await set('try-patient',txt(src.Patient_Actor));await set('try-objective',txt(src.Objective_for_Doctor));await set('try-examination',txt(src.Physical_Examination_Findings));await set('try-tests',JSON.stringify(src.Test_Results,null,2));await set('try-answer',src.Correct_Diagnosis);
 await click('运行对比');await until("Boolean(document.getElementById('try-result'))",600);assert.equal(await evaluate(send,"document.querySelectorAll('.compare-item').length"),2);await shot('comparison');
 const exported=await read('v1/apps/'+appId+'/export');assert.ok(exported.cards&&exported.memory);assert.ok(!JSON.stringify(exported).includes('heldout_lift'));
 const r=await fetch(base+'v1/apps/'+appId+'/invoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:{patient:src.Patient_Actor,objective:src.Objective_for_Doctor,examination:src.Physical_Examination_Findings,tests:src.Test_Results},answer:src.Correct_Diagnosis,model:endpoints[0].id+':'+endpoints[0].models[0]})});assert.ok(r.ok,await r.clone().text());const invoked=await r.json();assert.ok(invoked.output&&invoked.details.num_turns>0);
 writeFileSync(out+'/evidence.json',JSON.stringify({taskId,appId,completed:true,model:endpoints[0].models[0],invoked,exportCards:exported.cards.length},null,2));console.log('PASS real task -> publish -> compare -> invoke -> export');
 await viewport(send,{width:390,height:844,mobile:true});await shot('comparison-mobile');
}finally{
 if(appId)assert.ok((await fetch(base+'v1/apps/'+appId,{method:'DELETE'})).ok,'Remove own application');
 if(taskId&&completed)assert.ok((await fetch(base+'v1/tasks/'+taskId,{method:'DELETE'})).ok,'Remove own completed task');
 close();if(completed){for(const k of ['tasks','apps','datasets'])assert.deepEqual((await read('v1/'+k)).map(x=>x.id).sort(),original[k]);console.log('PASS own validation records removed; original resources preserved')}
}
