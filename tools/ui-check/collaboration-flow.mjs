// 医疗成组接入；只读默认，RUN_FLOW=1 才执行任务，线上额外明确开启真实模型验证。
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch,viewport,open,evaluate,sleep,SELECT} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8880/';
const local=['127.0.0.1','localhost'].includes(new URL(base).hostname),run=process.env.RUN_FLOW==='1';
if(run&&!local)assert.equal(process.env.REAL_MODEL_VERIFY,'1');
const out=process.env.CDP_OUT??'/tmp/fedagent-collaboration';mkdirSync(out,{recursive:true});
const evidence=[],owned={};const check=(label,value)=>{assert.ok(value,label);evidence.push(label);console.log('PASS',label)};
async function req(p,method='GET',body){const r=await fetch(new URL('v1/'+p,base),{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,`${p}: ${await r.clone().text()}`);return r.status===204?null:r.json()}
const [datasets,agents,oldTasks,oldApps]=await Promise.all(['datasets','agents','tasks','apps'].map(p=>req(p)));
const pairs=agents.filter(a=>a.capabilities&&(a.resourceSpace==='workspace'||a.shared)).flatMap(a=>{
 const data=datasets.find(d=>d.ready&&d.taskType==='medical-diagnosis'&&d.ownerId===a.ownerId&&(d.resourceSpace==='workspace'||d.shared));
 return data?[{agent:a,data}]:[];
});
assert.ok(pairs.length>=2,'至少两套通过检查的资源');
const [{agent:mineAgent,data:mine},{agent:peerAgent,data:peer}]=pairs;
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9438),profile:'/tmp/fedagent-collaboration-profile'});
async function click(label){await evaluate(send,`(()=>{const b=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled);if(!b)throw Error('Missing '+${JSON.stringify(label)});b.click()})()`);await sleep(220)}
async function until(expr,limit=60000){const end=Date.now()+limit;while(Date.now()<end){if(await evaluate(send,`Boolean(${expr})`))return;await sleep(local?200:1000)}throw Error('Timeout '+expr)}
async function set(id,value){await evaluate(send,`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await sleep(150)}
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
const save=()=>writeFileSync(`${out}/owned.json`,JSON.stringify(owned,null,2));
try{
 if(!run)await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const f=fetch.bind(window);window.fetch=(input,init)=>{const method=init?.method??'GET',path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;if(!['GET','HEAD'].includes(method)&&path!='/v1/tasks/validate')throw Error('read-only');return f(input,init)}})()`});
 for(const width of [1280,390]){
  await viewport(send,{width,height:width===390?844:900,mobile:width===390});await open(send,base+'#/tasks/new',local?1400:4000);
  await click('横向联邦');await evaluate(send,"document.getElementById('algorithm-evomedclaw').click()");await sleep(180);await click('医疗诊断');
  check('医疗没有全局默认Agent或数据嵌套菜单 '+width,await evaluate(send,"!document.getElementById('task-agent')&&!document.getElementById('client-model')&&!document.getElementById('server-model')&&Boolean(document.querySelector('.participation-list'))&&!document.querySelector('.agent-data-list')"));
  check('默认两组且不分来源、没有现场登记 '+width,await evaluate(send,"document.querySelectorAll('.participation-row').length===2&&!document.querySelector('#participants .resource-space-bar')&&![...document.querySelectorAll('#participants button')].some(b=>['上传','接入','添加我的系统','添加共享协作方'].includes(b.textContent.trim()))&&!document.querySelector('input[type=file]')"));
  const keys=await evaluate(send,"JSON.parse(localStorage.getItem('fedagent-studio:draft')).agentGroups.map(g=>g.key)");
  check('先选Agent，数据字段保留禁用 '+width,await evaluate(send,`document.getElementById('system-${keys[0]}-data').disabled&&!document.getElementById('system-${keys[0]}-agent').disabled`));
  await evaluate(send,SELECT('system-'+keys[0]+'-agent',mineAgent.id));
  await evaluate(send,SELECT('system-'+keys[0]+'-data',mine.id));
  const groupKey=keys[1];
  await evaluate(send,SELECT('system-'+groupKey+'-agent',peerAgent.id));
  await evaluate(send,SELECT('system-'+groupKey+'-data',peer.id));
  check('Agent与任务数据为同级字段 '+width,await evaluate(send,"[...document.querySelectorAll('.participation-fields')].every(e=>e.children.length===2&&e.children[0].querySelector('[role=combobox]')&&e.children[1].querySelector('[role=combobox]'))"));
  check('两组可用资源统一选择 '+width,await evaluate(send,"JSON.parse(localStorage.getItem('fedagent-studio:draft')).agentGroups.filter(g=>g.agentId&&g.datasetId).length===2"));
  await open(send,base+'#/tasks/new',local?1000:4000,{reset:false});
  check('刷新保留任务内组合 '+width,await evaluate(send,"document.querySelectorAll('.participation-row').length===2&&JSON.parse(localStorage.getItem('fedagent-studio:draft')).agentGroups.every(g=>g.agentId&&g.datasetId)"));
  await click('添加资源');await evaluate(send,"document.querySelector('[aria-label=\"移除资源 3\"]').click()");
  check('增加行只改草稿，不登记资源 '+width,await evaluate(send,"document.querySelectorAll('.participation-row').length===2"));
  await evaluate(send,SELECT('rounds',2));await set('trial-cap',2);
  await click('正式运行');await until("document.querySelector('.config-test-trigger[data-ready=true]:not(:disabled)')");
  check('已有共享资源可组成正式配置 '+width,true);await click('试跑');
  await until("document.querySelector('.config-test-trigger[data-ready=true]:not(:disabled)')");
  await evaluate(send,"document.getElementById('participants').scrollIntoView({block:'start'})");await sleep(300);await shot('groups-'+width);
  check('所需资源不横向溢出 '+width,await evaluate(send,'document.documentElement.scrollWidth<=innerWidth'));
 }
 if(run){
  await viewport(send,{width:1280,height:900});await set('task-name','医疗协作接入验证（完成后清理）');
  await until("document.querySelector('.config-test-trigger[data-ready=true]:not(:disabled)')");await click('测试配置');
  await until("JSON.parse(sessionStorage.getItem('fedagent-studio:config-check')??'null')?.id");owned.checkId=await evaluate(send,"JSON.parse(sessionStorage.getItem('fedagent-studio:config-check')).id");save();
  const deadline=Date.now()+(local?180000:1200000);let report;
  while(Date.now()<deadline){report=await req('task-checks/'+owned.checkId);if(!['queued','running'].includes(report.status))break;await sleep(local?250:2000)}
  check('两组数据与实际Agent全部步骤测试通过',report.status==='passed');
  await until("document.querySelector('.summary-start[data-ready=true]:not(:disabled)')");await click('创建并试跑');await until("location.hash.includes('/tasks/task-')");owned.taskId=await evaluate(send,"location.hash.split('/')[2]");save();
  let task;const end=Date.now()+(local?180000:1500000);
  while(Date.now()<end){task=await req('tasks/'+owned.taskId);assert.ok(!['paused','canceled'].includes(task.status),task.error);if(task.status==='completed')break;await sleep(local?300:3000)}
  check('两组独立Agent完成两轮联邦与聚合',task.status==='completed'&&task.rounds.filter(r=>r.output).length===2&&new Set(task.members.map(m=>m.model)).size===2);
  check('任务冻结对应组的Agent接口',task.members.some(m=>m.datasetId===mine.id&&m.model==='agent:'+mineAgent.id)&&task.members.some(m=>m.datasetId===peer.id&&m.model==='agent:'+peerAgent.id));
  const app=await req('apps','POST',{taskId:owned.taskId,builtAfterRound:2,name:'医疗协作成果验证（完成后清理）'});owned.appId=app.id;save();
  const exported=await fetch(new URL('v1/apps/'+app.id+'/export',base));check('联邦成果可发布与导出',exported.ok&&Boolean(await exported.text()));
 }
 writeFileSync(`${out}/evidence.json`,JSON.stringify({base,run,evidence,owned},null,2));
}finally{
 close();
 if(owned.appId)await req('apps/'+owned.appId,'DELETE');
 if(owned.taskId){const task=await req('tasks/'+owned.taskId);if(!['completed','canceled'].includes(task.status)){console.error('保留未结束任务和报告',owned);process.exitCode=1}else{await req('tasks/'+owned.taskId,'DELETE');if(owned.checkId)await req('task-checks/'+owned.checkId,'DELETE')}}
 else if(owned.checkId)await req('task-checks/'+owned.checkId,'DELETE');
 for(const [kind,old,id] of [['tasks',oldTasks,owned.taskId],['apps',oldApps,owned.appId]]){
  const current=(await req(kind)).map(t=>t.id);for(const row of old)assert.ok(current.includes(row.id),'保留原有 '+kind+' '+row.id);
  if(id)assert.ok(!current.includes(id),'清理本轮 '+kind+' '+id);
 }
}
