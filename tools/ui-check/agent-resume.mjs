// 明确安排真实验证后，从 owned.json 中的医疗检查点续跑；不重建已完成的任务。
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {launch,viewport,open,evaluate,sleep} from './lib.mjs';
assert.equal(process.env.REAL_MODEL_VERIFY,'1');
const base=process.env.BASE??'http://100.111.198.54:8880/';
const file=process.env.OWNED_FILE;assert.ok(file,'需要本轮 owned.json');
const owned=JSON.parse(readFileSync(file,'utf8'));
const out=process.env.CDP_OUT??'/tmp/fedagent-agent-resume';mkdirSync(out,{recursive:true});
async function request(path,method='GET',body){const r=await fetch(new URL('v1/'+path,base),{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(r.ok,`${path}: ${r.status} ${r.ok?'':await r.text()}`);return r.status===204?null:r.json()}
const tasks=await request('tasks');const task=tasks.find(t=>owned.tasks.includes(t.id)&&t.config.algorithm==='evomedclaw');assert.ok(task&&task.config.execution==='agent'&&owned.agents.includes(task.config.agentId));
const evidence=[];const check=(s,v)=>{assert.ok(v,s);evidence.push(s);console.log('PASS',s)};
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9434),profile:'/tmp/fedagent-agent-resume-profile'});
async function click(text){await evaluate(send,`(()=>{const b=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled);if(!b)throw Error('missing '+${JSON.stringify(text)});b.click()})()`);await sleep(250)}
async function shot(name){const m=await send('Page.getLayoutMetrics');const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:1280,height:Math.ceil(m.cssContentSize.height),scale:1}});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
let appId;
try{
 await viewport(send,{width:1280,height:900});await open(send,base+`#/tasks/${task.id}/progress`,4000);
 if(task.status==='paused')await click('继续');
 let current,last='';const deadline=Date.now()+25*60*1000;
 while(Date.now()<deadline){current=await request('tasks/'+task.id);assert.notEqual(current.status,'paused',current.error);if(current.status==='completed')break;if(current.cursor?.stage+current.cursor?.round!==last){last=current.cursor?.stage+current.cursor?.round;console.log('medical',last)}await sleep(2500)}
 check('医疗真实 Agent 从检查点完成三组对照',current.status==='completed'&&current.config.rounds===3&&current.rounds.filter(r=>r.output).length===1);
 check('留出病例独立判分',current.members.every(m=>m.problems===2&&m.answered===1));
 await open(send,base+`#/tasks/${task.id}/output`,4000);await shot('medical-output');await click('发布为应用');
 await evaluate(send,"(()=>{const e=document.getElementById('publish-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'医疗 Agent 联调成果（验证后清理）');e.dispatchEvent(new Event('input',{bubbles:true}));})()");await sleep(150);await click('发布');
 for(let i=0;i<100;i++){const app=(await request('apps')).find(a=>a.taskId===task.id);if(app){appId=app.id;break}await sleep(500)}
 assert.ok(appId);owned.apps.push(appId);writeFileSync(file,JSON.stringify(owned,null,2));
 const input=JSON.parse(readFileSync('.references/medical/medqa-group-1.jsonl','utf8').trim().split('\n')[1]);
 const result=await request(`apps/${appId}/invoke`,'POST',{input,model:'default'});check('医疗共享成果发布后真实 invoke 可用',Boolean(result.output));
 const exported=await fetch(new URL(`v1/apps/${appId}/export`,base));check('医疗成果可导出',exported.ok&&Boolean(await exported.text()));
 await open(send,base+`#/tasks/${task.id}/config`,4000);await shot('medical-config');
 writeFileSync(`${out}/evidence.json`,JSON.stringify({taskId:task.id,appId,recovered:true,evidence},null,2));
 for(const id of owned.apps){const all=await request('apps');if(all.some(x=>x.id===id))await request('apps/'+id,'DELETE')}
 for(const id of owned.tasks){const all=await request('tasks');const t=all.find(x=>x.id===id);if(t){assert.ok(['completed','canceled'].includes(t.status));await request('tasks/'+id,'DELETE')}}
 for(const id of owned.checks)await request('task-checks/'+id,'DELETE');
 for(const id of owned.agents)await request('agents/'+id,'DELETE');
 for(const id of owned.datasets)await request('resources/data/'+id,'DELETE');
 check('本轮任务、应用、Agent 与报告已清理',!(await request('tasks')).some(t=>owned.tasks.includes(t.id))&&!(await request('agents')).some(a=>owned.agents.includes(a.id)));
}finally{close()}
