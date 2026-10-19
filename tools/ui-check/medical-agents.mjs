// FoT 使用 LLM；医疗按两份数据分别接入两个独立 Agent，并验证用户侧经验回用。
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {launch,viewport,open,evaluate,sleep,SELECT} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8880/';
const local=['127.0.0.1','localhost'].includes(new URL(base).hostname);
if(!local)assert.equal(process.env.REAL_MODEL_VERIFY,'1');
const out=process.env.CDP_OUT??'/tmp/fedagent-medical-agents';mkdirSync(out,{recursive:true});
async function request(path,method='GET',body){const response=await fetch(new URL('v1/'+path,base),{method,headers:body instanceof FormData?{}:{'content-type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});assert.ok(response.ok,`${method} ${path}: ${response.status} ${response.ok?'':await response.text()}`);return response.status===204?null:response.json()}
const kinds=['tasks','apps','datasets','participants','endpoints','agents'];
const original=Object.fromEntries(await Promise.all(kinds.map(async k=>[k,(await request(k)).map(x=>x.id).sort()])));
const endpoint=(await request('endpoints')).find(e=>local?e.kind==='fake':e.configured&&e.kind!=='fake');assert.ok(endpoint);
const model=endpoint.id==='default'?'default':`${endpoint.id}:${endpoint.models[0]}`;
const evidence=[],owned={agents:[],tasks:[],apps:[],datasets:[],checks:[]};
const stamp=Date.now();
const save=()=>writeFileSync(`${out}/owned.json`,JSON.stringify(owned,null,2));
function check(label,value){assert.ok(value,label);evidence.push(label);console.log('PASS',label)}
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9418),profile:'/tmp/fedagent-medical-agents-profile'});
async function until(expression,ms=local?60000:360000){const end=Date.now()+ms;while(Date.now()<end){if(await evaluate(send,`Boolean(${expression})`))return;await sleep(local?180:700)}throw Error('Timeout '+expression)}
async function click(label){await evaluate(send,`(()=>{const root=document.querySelector('.resource-dialog')??document.querySelector('dialog[open]')??document;const b=[...root.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled);if(!b)throw Error('Missing '+${JSON.stringify(label)});b.focus({preventScroll:true});b.click()})()`);await sleep(220)}
async function set(id,value){await evaluate(send,`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(150)}
async function shot(name,width=1280){const m=await send('Page.getLayoutMetrics');const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:Math.ceil(m.cssContentSize.height),scale:1}});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
try{
 await viewport(send,{width:1280,height:900});await open(send,base+'#/agents',local?1400:4000);
 check('数据／LLM／Agent 三类导航平级',await evaluate(send,"['数据资源','LLM 接口','Agent 接口'].every(t=>[...document.querySelectorAll('.side-nav>a')].some(a=>a.textContent.trim()===t))"));
 const agents=[];
 for(const [index,url] of [process.env.AGENT_A_URL??'http://127.0.0.1:9031',process.env.AGENT_B_URL??'http://127.0.0.1:9032'].entries()){
   const name=`医疗 Agent ${index===0?'A':'B'}`;
   let agent=(await request('agents')).find(a=>a.baseUrl===url&&a.name===name);
   if(!agent){await click('接入 Agent');await set('agent-name',name);await set('agent-url',url);await click('保存并检查');
     await until("!document.querySelector('.resource-dialog')");agent=(await request('agents')).find(a=>a.name===name&&a.baseUrl===url);assert.ok(agent);owned.agents.push(agent.id);save();}
   agents.push(agent);
   check(`${name}实际返回医疗能力，未假装支持数学`,Object.keys(agent.capabilities.algorithms).join(',')==='evomedclaw');
 }
 await shot('medical-agents');
 let datasets=await request('datasets');
 if(local&&!datasets.some(d=>d.taskType==='medical-diagnosis')){
   for(const n of [1,2]){const form=new FormData();form.set('hosting','platform');form.set('taskType','medical-diagnosis');form.set('name',`公开病例联调 ${stamp}-${n}`);form.set('file',new Blob([readFileSync(`.references/medical/medqa-group-${n}.jsonl`)]),`medqa-${n}.jsonl`);const r=await request('resources/data','POST',form);owned.datasets.push(r.dataset.id);save()}
   datasets=await request('datasets');
 }
 for(const medical of [false,true].filter(m=>!process.env.ONLY_ALGORITHM||process.env.ONLY_ALGORITHM===(m?'evomedclaw':'fot'))){
   const type=medical?'medical-diagnosis':'math-reasoning',algorithm=medical?'evomedclaw':'fot';
   const compatible=datasets.filter(d=>d.taskType===type);const selected=(medical?compatible:compatible.sort((a,b)=>a.name.localeCompare(b.name))).slice(0,2);assert.equal(selected.length,2);
   await open(send,base+'#/tasks/new',local?1300:4000);await click('横向联邦');await evaluate(send,`document.getElementById('algorithm-${algorithm}').click()`);await sleep(180);await click(medical?'医疗诊断':'数学推理');
   for(const dataset of selected){await click(dataset.resourceSpace==='public'?'公用资源':'我的资源');await evaluate(send,`document.getElementById('pick-${dataset.participantId}').click()`);await sleep(150)}
   if(medical){
     check('医疗自动要求用户侧 Agent，隐藏平台内置诊断选项',await evaluate(send,"!document.querySelector('[name=client-model]')&&![...document.querySelectorAll('button[role=radio]')].some(b=>b.textContent.includes('平台内置流程'))"));
     await evaluate(send,SELECT('task-agent',agents[0].id));
     await evaluate(send,SELECT('agent-override-source',selected[1].participantId));
     await evaluate(send,SELECT(`agent-override-${selected[1].participantId}`,agents[1].id));
     check('不同数据分别指定两个 Agent，配置位于资源区',await evaluate(send,"document.querySelector('#participants .override-row')&&!document.querySelector('details .override-row')"));
   }else{
     check('FoT 默认使用 LLM，无需部署 Agent',await evaluate(send,"Boolean(document.getElementById('client-model'))&&!document.getElementById('task-agent')"));
     await evaluate(send,SELECT('client-model',model));await evaluate(send,SELECT('server-model',model));
   }
   if(medical&&process.env.MAX_TURNS){await evaluate(send,"document.querySelector('details.panel--collapsible').open=true");await set('param-maxTurns',Number(process.env.MAX_TURNS));}
   await evaluate(send,SELECT('rounds','2'));await set('trial-cap',medical?2:1);await set('task-name',`Agent ${algorithm} 验证 ${stamp}`);
   await until("document.querySelector('.config-test-trigger[data-ready=true]:not(:disabled)')");
   await click('创建并试跑');check(`${algorithm}未测试时在配置测试区域提示`,await evaluate(send,"document.getElementById('check-error')?.textContent.includes('先测试')&&!document.querySelector('.notice')"));
   await click('测试配置');await until("sessionStorage.getItem('fedagent-studio:config-check')");
   const checkId=await evaluate(send,"JSON.parse(sessionStorage.getItem('fedagent-studio:config-check')).id");owned.checks.push(checkId);save();
   const checkDeadline=Date.now()+(local?120000:20*60*1000);let report;
   while(Date.now()<checkDeadline){report=await request('task-checks/'+checkId);if(!['queued','running'].includes(report.status))break;await sleep(local?250:1500)}
   assert.equal(report.status,'passed',JSON.stringify(report.results));
   await until("document.querySelector('.summary-start[data-ready=true]:not(:disabled)')");
   check(`${algorithm}测试完整数据与实际接口输出`,(await request('task-checks/'+checkId)).results.some(r=>r.message.includes(medical?'全部本方步骤':'实际推理')));
   await send('Page.reload');await sleep(local?1500:4000);await until("document.querySelector('.summary-start[data-ready=true]:not(:disabled)')");
   check(`${algorithm}刷新后保留报告和已选配置`,await evaluate(send,`Boolean(document.querySelector('.config-check-success'))`));
   await set('trial-cap',medical?3:2);check(`${algorithm}改配置后旧测试失效`,await evaluate(send,"document.querySelector('.summary-start').dataset.ready==='false'&&document.querySelector('.config-check-results').textContent.includes('配置已更改')"));await set('trial-cap',medical?2:1);await until("document.querySelector('.summary-start[data-ready=true]:not(:disabled)')");
   await shot(`${algorithm}-configured`);
   await viewport(send,{width:390,height:844,mobile:true});await shot(`${algorithm}-configured-mobile`,390);
   check(`${algorithm}手机配置无横向溢出`,await evaluate(send,"document.documentElement.scrollWidth<=390"));
   await viewport(send,{width:1280,height:900});await click('创建并试跑');await until("location.hash.includes('/tasks/task-')");
   const taskId=await evaluate(send,"location.hash.split('/')[2]");owned.tasks.push(taskId);save();
   let task;const deadline=Date.now()+(local?150000:25*60*1000);let last='';
   while(Date.now()<deadline){task=await request('tasks/'+taskId);if(task.status==='completed')break;assert.notEqual(task.status,'paused',task.error);assert.notEqual(task.status,'canceled');if(task.cursor?.stage!==last){last=task.cursor?.stage;console.log(algorithm,'stage',last)}await sleep(local?400:3000)}
   check(`${algorithm}完成两轮与共享产出`,task.status==='completed'&&task.config.execution===(medical?'agent':'builtin')&&task.rounds.filter(r=>r.output).length===2&&(!medical||new Set(task.members.map(m=>m.model)).size===2));
   await open(send,base+`#/tasks/${taskId}/config`,local?1300:4000);check(`${algorithm}配置详情展示实际使用的接口`,await evaluate(send,`document.querySelector('main').textContent.includes(${JSON.stringify(medical?'医疗 Agent A':endpoint.name)})`));await shot(`${algorithm}-task-config`);
   await open(send,base+`#/tasks/${taskId}/output`,local?1300:4000);await click('发布为应用');await set('publish-name',`Agent ${algorithm} 应用验证 ${stamp}`);await click('发布');await until("[...document.querySelectorAll('a')].some(a=>a.textContent==='立即试用')");
   const app=(await request('apps')).find(a=>a.taskId===taskId);assert.ok(app);owned.apps.push(app.id);save();
   const input=medical?JSON.parse(readFileSync('.references/medical/medqa-group-1.jsonl','utf8').trim().split('\n')[1]):'1 + 1';
   const exported=await request(`apps/${app.id}/export`);
   check(`${algorithm}成果可导出`,Boolean(exported));
   if(medical){
     const directUrls=[process.env.DIRECT_AGENT_A??process.env.AGENT_A_URL??'http://127.0.0.1:9031',process.env.DIRECT_AGENT_B??process.env.AGENT_B_URL??'http://127.0.0.1:9032'];
     for(const [n,member] of task.members.entries()){
       const agentIndex=agents.findIndex(a=>a.id===member.model.replace(/^agent:/,''));assert.ok(agentIndex>=0);
       const url=directUrls[agentIndex];
       let r=await fetch(url+'/experience',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({task_id:taskId,site_id:member.participantId,artifact:{version:2,round:2,kind:'clinical-memory',content:exported}})});
       assert.ok(r.ok,await r.text());
       r=await fetch(url+'/diagnose',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({task_id:taskId,site_id:member.participantId,case:input,turns:12})});
       const response=await r.json();assert.ok(r.ok,JSON.stringify(response));
       console.log('医疗 Agent',n+1,'retrieved experience references',response.trajectory.dialogue_history.flatMap(e=>e.memory_entry_ids??[]).length);
       check(`用户原医疗 Agent ${n+1} API加载最终第2版经验并返回真实诊断`,response.experience_version===2&&Boolean(response.diagnosis));
     }
   }else{
     const invoke=await request(`apps/${app.id}/invoke`,'POST',{input,answer:'2',model});
     check('FoT经验可用于模型推理',Boolean(invoke.output));
   }
 }
 writeFileSync(`${out}/evidence.json`,JSON.stringify({evidence,owned},null,2));
}finally{
 close();
 for(const id of owned.apps)await request('apps/'+id,'DELETE');
 const retained=[];
 for(const id of owned.tasks){const task=await request('tasks/'+id);if(!['completed','canceled'].includes(task.status)){retained.push(id);continue}await request('tasks/'+id,'DELETE')}
 if(retained.length){console.error('保留未结束任务及其 Agent／报告／数据以便排查：',retained.join('、'))}
 else {
   for(const id of owned.checks)await request('task-checks/'+id,'DELETE');
   if(process.env.KEEP_AGENTS!=='1')for(const id of owned.agents)await request('agents/'+id,'DELETE');
   for(const id of owned.datasets)await request('resources/data/'+id,'DELETE');
   for(const kind of kinds){const ids=(await request(kind)).map(x=>x.id);for(const id of original[kind])assert.ok(ids.includes(id),`保留已有 ${kind} ${id}`);for(const id of (kind==='agents'&&process.env.KEEP_AGENTS==='1'?[]:owned[kind]??[]))assert.ok(!ids.includes(id),`清理本轮 ${kind} ${id}`)}
 }
 if(!retained.length)console.log('PASS 只清理本轮验证资源，原有资源逐项保留');
}
