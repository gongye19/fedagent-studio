// 三类资源分离 → 独立 HTTP Agent → 配置测试 → 两轮 → 发布与试用。真实调用必须显式授权。
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {launch,viewport,open,evaluate,sleep,SELECT} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8880/';
const local=['127.0.0.1','localhost'].includes(new URL(base).hostname);
if(!local)assert.equal(process.env.REAL_MODEL_VERIFY,'1');
const out=process.env.CDP_OUT??'/tmp/fedagent-agent-flow';mkdirSync(out,{recursive:true});
async function request(path,method='GET',body){const response=await fetch(new URL('v1/'+path,base),{method,headers:body instanceof FormData?{}:{'content-type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});assert.ok(response.ok,`${method} ${path}: ${response.status} ${response.ok?'':await response.text()}`);return response.status===204?null:response.json()}
const kinds=['tasks','apps','datasets','participants','endpoints','agents'];
const original=Object.fromEntries(await Promise.all(kinds.map(async k=>[k,(await request(k)).map(x=>x.id).sort()])));
const endpoint=(await request('endpoints')).find(e=>local?e.kind==='fake':e.configured&&e.kind!=='fake');assert.ok(endpoint);
const model=endpoint.id==='default'?'default':`${endpoint.id}:${endpoint.models[0]}`;
const evidence=[],owned={agents:[],tasks:[],apps:[],datasets:[],checks:[]};
const stamp=Date.now();
const save=()=>writeFileSync(`${out}/owned.json`,JSON.stringify(owned,null,2));
function check(label,value){assert.ok(value,label);evidence.push(label);console.log('PASS',label)}
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9418),profile:'/tmp/fedagent-agent-flow-profile'});
async function until(expression,ms=local?60000:360000){const end=Date.now()+ms;while(Date.now()<end){if(await evaluate(send,`Boolean(${expression})`))return;await sleep(local?180:700)}throw Error('Timeout '+expression)}
async function click(label){await evaluate(send,`(()=>{const root=document.querySelector('.resource-dialog')??document.querySelector('dialog[open]')??document;const b=[...root.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled);if(!b)throw Error('Missing '+${JSON.stringify(label)});b.focus({preventScroll:true});b.click()})()`);await sleep(220)}
async function set(id,value){await evaluate(send,`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(150)}
async function shot(name,width=1280){const m=await send('Page.getLayoutMetrics');const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:Math.ceil(m.cssContentSize.height),scale:1}});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
try{
 await viewport(send,{width:1280,height:900});await open(send,base+'#/agents',local?1400:4000);
 check('数据／LLM／Agent 三类导航平级',await evaluate(send,"['数据资源','LLM 接口','Agent 接口'].every(t=>[...document.querySelectorAll('.side-nav>a')].some(a=>a.textContent.trim()===t))"));
 await click('接入 Agent');await set('agent-name',`Agent 接入验证 ${stamp}`);await set('agent-url',process.env.AGENT_URL??'http://127.0.0.1:9020');await shot('agent-form');await click('保存并检查');await until("!document.querySelector('.resource-dialog')");
 const agent=(await request('agents')).find(a=>a.name===`Agent 接入验证 ${stamp}`);assert.ok(agent);owned.agents.push(agent.id);save();
 await evaluate(send,`[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('Agent 接入验证')).querySelector('button').click()`);await until("[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('Agent 接入验证'))?.textContent.includes('已读取能力')");
 check('注册的 Agent 声明支持两种算法，未要求登记内部 LLM',Boolean((await request('agents')).find(a=>a.id===agent.id).capabilities.algorithms.evomedclaw));
 let datasets=await request('datasets');
 if(local&&!datasets.some(d=>d.taskType==='medical-diagnosis')){
   for(const n of [1,2]){const form=new FormData();form.set('hosting','platform');form.set('taskType','medical-diagnosis');form.set('name',`公开病例联调 ${stamp}-${n}`);form.set('file',new Blob([readFileSync(`.references/medical/medqa-group-${n}.jsonl`)]),`medqa-${n}.jsonl`);const r=await request('resources/data','POST',form);owned.datasets.push(r.dataset.id);save()}
   datasets=await request('datasets');
 }
 {
   const type='medical-diagnosis',algorithm='evomedclaw';
   const compatible=datasets.filter(d=>d.taskType===type);const selected=compatible.slice(0,2);assert.equal(selected.length,2);
   await open(send,base+'#/tasks/new',local?1300:4000);await click('横向联邦');await evaluate(send,`document.getElementById('algorithm-${algorithm}').click()`);await sleep(180);await click('医疗诊断');
   for(const dataset of selected){await click(dataset.resourceSpace==='public'?'公用资源':'我的资源');await evaluate(send,`document.getElementById('pick-${dataset.participantId}').click()`);await sleep(150)}
   await evaluate(send,SELECT('task-agent',agent.id));
   check(`${algorithm}选择 Agent 后不再要求本方 LLM`,await evaluate(send,`!document.getElementById('client-model')&&!document.getElementById('server-model')`));
   await evaluate(send,SELECT('rounds','2'));await set('trial-cap',2);await set('task-name',`Agent ${algorithm} 验证 ${stamp}`);
   await until("document.querySelector('.config-test-trigger[data-ready=true]:not(:disabled)')");
   await click('创建并试跑');check(`${algorithm}未测试时在配置测试区域提示`,await evaluate(send,"document.getElementById('check-error')?.textContent.includes('先测试')&&!document.querySelector('.notice')"));
   await click('测试配置');await until("document.querySelector('.summary-start[data-ready=true]:not(:disabled)')");
   const checkId=await evaluate(send,"JSON.parse(sessionStorage.getItem('fedagent-studio:config-check')).id");owned.checks.push(checkId);save();
   check(`${algorithm}测试实际执行样本且通过`,(await request('task-checks/'+checkId)).results.some(r=>r.message.includes('全部本方步骤')));
   await send('Page.reload');await sleep(local?1500:4000);await until("document.querySelector('.summary-start[data-ready=true]:not(:disabled)')");
   check(`${algorithm}刷新后保留报告和已选配置`,await evaluate(send,`document.querySelector('input[name=task-agent]').value==='${agent.id}'&&Boolean(document.querySelector('.config-check-success'))`));
   await set('trial-cap',3);check(`${algorithm}改配置后旧测试失效`,await evaluate(send,"document.querySelector('.summary-start').dataset.ready==='false'&&document.querySelector('.config-check-results').textContent.includes('配置已更改')"));await set('trial-cap',2);await until("document.querySelector('.summary-start[data-ready=true]:not(:disabled)')");
   await shot(`${algorithm}-configured`);
   await viewport(send,{width:390,height:844,mobile:true});await shot(`${algorithm}-configured-mobile`,390);
   check(`${algorithm}手机配置无横向溢出`,await evaluate(send,"document.documentElement.scrollWidth<=390"));
   await viewport(send,{width:1280,height:900});await click('创建并试跑');await until("location.hash.includes('/tasks/task-')");
   const taskId=await evaluate(send,"location.hash.split('/')[2]");owned.tasks.push(taskId);save();
   let task;const deadline=Date.now()+(local?150000:25*60*1000);let last='';
   while(Date.now()<deadline){task=await request('tasks/'+taskId);if(task.status==='completed')break;assert.notEqual(task.status,'paused',task.error);assert.notEqual(task.status,'canceled');if(task.cursor?.stage!==last){last=task.cursor?.stage;console.log(algorithm,'stage',last)}await sleep(local?400:3000)}
   check(`${algorithm}独立 HTTP Agent 完成两轮与共享产出`,task.status==='completed'&&task.config.execution==='agent'&&task.rounds.filter(r=>r.output).length===2&&task.members.every(m=>m.agentName===agent.name));
   await open(send,base+`#/tasks/${taskId}/config`,local?1300:4000);check(`${algorithm}配置详情展示冻结的 Agent 名称`,await evaluate(send,`document.querySelector('main').textContent.includes(${JSON.stringify(agent.name)})&&!document.querySelector('main').textContent.includes('absent:')`));await shot(`${algorithm}-task-config`);
   await open(send,base+`#/tasks/${taskId}/output`,local?1300:4000);await click('发布为应用');await set('publish-name',`Agent ${algorithm} 应用验证 ${stamp}`);await click('发布');await until("[...document.querySelectorAll('a')].some(a=>a.textContent==='立即试用')");
   const app=(await request('apps')).find(a=>a.taskId===taskId);assert.ok(app);owned.apps.push(app.id);save();
   const input=JSON.parse(readFileSync('.references/medical/medqa-group-1.jsonl','utf8').trim().split('\n')[1]);
   const invoke=await request(`apps/${app.id}/invoke`,'POST',{input,model});
   check(`${algorithm}发布的经验成果可通过应用接口使用`,Boolean(invoke.output));
   const exported=await fetch(new URL(`v1/apps/${app.id}/export`,base));check(`${algorithm}成果可导出`,exported.ok&&Boolean(await exported.text()));
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
   for(const id of owned.agents)await request('agents/'+id,'DELETE');
   for(const id of owned.datasets)await request('resources/data/'+id,'DELETE');
   for(const kind of kinds){const ids=(await request(kind)).map(x=>x.id);for(const id of original[kind])assert.ok(ids.includes(id),`保留已有 ${kind} ${id}`);for(const id of owned[kind]??[])assert.ok(!ids.includes(id),`清理本轮 ${kind} ${id}`)}
 }
 if(!retained.length)console.log('PASS 只清理本轮验证资源，原有资源逐项保留');
}
