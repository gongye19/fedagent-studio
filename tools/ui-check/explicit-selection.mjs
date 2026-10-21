// 资源必须主动选择；分类取消／切换、单选项、旧草稿与未来多任务。禁止业务写入。
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch,viewport,open,evaluate,sleep,SELECT} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8880/';
const local=['localhost','127.0.0.1'].includes(new URL(base).hostname);
const out=process.env.CDP_OUT??'/tmp/fedagent-explicit-selection';mkdirSync(out,{recursive:true});
const evidence=[],check=(label,ok)=>{assert.ok(ok,label);evidence.push(label);console.log('PASS',label)};
const endpoints=await(await fetch(new URL('v1/endpoints',base))).json();
const endpoint=endpoints.find(e=>e.configured&&(e.resourceSpace==='workspace'||e.shared));assert.ok(endpoint);
const model=endpoint.id==='default'?'default':endpoint.id+':'+endpoint.models[0];
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9447),profile:'/tmp/fedagent-explicit-profile'});
const draft="JSON.parse(localStorage.getItem('fedagent-studio:draft'))";
async function click(label){await evaluate(send,`(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled);if(!e)throw Error('missing '+${JSON.stringify(label)});e.click()})()`);await sleep(180)}
async function algorithm(){await evaluate(send,"document.getElementById('algorithm-fot').click()");await sleep(180)}
async function until(expr){for(let i=0;i<100;i++){if(await evaluate(send,`Boolean(${expr})`))return;await sleep(local?100:300)}throw Error('timeout '+expr)}
async function models(){await evaluate(send,SELECT('client-model',model));await evaluate(send,SELECT('server-model',model))}
async function space(selector){await evaluate(send,`document.querySelector(${JSON.stringify(selector)}).focus()`);for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:' ',code:'Space',windowsVirtualKeyCode:32,nativeVirtualKeyCode:32});await sleep(200)}
async function shot(name){await evaluate(send,"document.getElementById('participants').scrollIntoView({block:'start'})");await sleep(250);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
try{
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=fetch.bind(window);window.__writes=0;window.fetch=async(input,init)=>{const method=init?.method??'GET',path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;if(!['GET','HEAD'].includes(method)&&path!='/v1/tasks/validate'){window.__writes++;throw Error('read-only')}const response=await original(input,init);const count=Number(new URLSearchParams(location.search).get('qaTaskChoices'));if(${local}&&count>1&&path==='/v1/registry'&&response.ok){const data=await response.json(),sample=data.taskTypes.find(t=>t.id==='math-reasoning');const extra=Array.from({length:count-1},(_,i)=>({...sample,id:'qa-task-'+(i+1),label:'回归任务 '+(i+1)}));data.taskTypes.push(...extra);data.algorithms.find(a=>a.id==='fot').accepts=['math-reasoning',...extra.map(t=>t.id)];return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}})}return response}})()`});
 for(const width of [1280,390]){
  await viewport(send,{width,height:width===390?844:900,mobile:width===390});await open(send,base+'#/tasks/new',local?1400:4000);
  await click('横向联邦');await algorithm();await click('数学推理');
  check('数学数据与两个模型都不预选 '+width,await evaluate(send,`${draft}.participants.length===0&&${draft}.clientModel===''&&${draft}.serverModel===''&&[...document.querySelectorAll('[data-model-name]')].every(e=>e.textContent.includes('请选择模型'))`));
  await shot('empty-'+width);
  await evaluate(send,"[...document.querySelectorAll('input[id^=pick-]')].slice(0,2).forEach(e=>e.click())");
  await evaluate(send,"(innerWidth>1180?document.querySelector('.summary-start'):document.querySelector('.order-bar .button--primary')).click()");await sleep(350);
  check('缺少模型时原位提示且不能测试或创建 '+width,await evaluate(send,"document.getElementById('client-model-error')?.textContent.includes('请选择运行模型')&&document.getElementById('server-model-error')?.textContent.includes('请选择汇总模型')&&document.querySelector('.config-test-trigger').dataset.ready==='false'&&window.__writes===0"));
  await evaluate(send,SELECT('client-model',model));
  check('选运行模型不替用户选汇总模型 '+width,await evaluate(send,`${draft}.clientModel===${JSON.stringify(model)}&&${draft}.serverModel===''`));
  await evaluate(send,SELECT('server-model',model));await until("document.querySelector('.config-test-trigger[data-ready=true]')");
  check('显式选择后配置可测试 '+width,true);
  await evaluate(send,SELECT('client-model',''));
  check('清除模型后保留其他选择且无自动回填 '+width,await evaluate(send,`${draft}.clientModel===''&&${draft}.serverModel===${JSON.stringify(model)}&&document.getElementById('client-model').textContent.includes('请选择模型')`));
  await models();await open(send,base+'#/tasks/new',local?1200:4000,{reset:false});
  check('刷新保留本版主动选择的模型 '+width,await evaluate(send,`${draft}.clientModel===${JSON.stringify(model)}&&${draft}.serverModel===${JSON.stringify(model)}`));
  await click('数学推理');
  check('重复点击任务可取消并清理数据和模型 '+width,await evaluate(send,`${draft}.taskType===null&&${draft}.algorithm==='fot'&&${draft}.participants.length===0&&${draft}.clientModel===''&&${draft}.serverModel===''&&document.getElementById('client-model').disabled`));
  await click('数学推理');await space('[aria-labelledby=task-type-label] [role=radio]');
  check('空格键也能取消任务类型 '+width,await evaluate(send,`${draft}.taskType===null`));
  await click('数学推理');await algorithm();
  check('重复点击算法可取消并清空后续配置 '+width,await evaluate(send,`${draft}.algorithm===null&&${draft}.taskType===null&&!document.querySelector('input[name=algorithm]:checked')`));
  await algorithm();await space('#algorithm-fot');
  check('空格键取消算法且控件状态一致 '+width,await evaluate(send,`${draft}.algorithm===null&&!document.querySelector('input[name=algorithm]:checked')`));
  await click('横向联邦');
  check('场景可取消且清理入口预选地址 '+width,await evaluate(send,`${draft}.scenario===null&&location.hash==='#/tasks/new'`));
  await open(send,base+'#/tasks/new',local?1200:4000,{reset:false});check('刷新不会恢复已取消的场景 '+width,await evaluate(send,`${draft}.scenario===null`));
  await evaluate(send,`localStorage.setItem('fedagent-studio:draft',JSON.stringify({name:'旧草稿验证',scenario:'horizontal',algorithm:'fot',taskType:'math-reasoning',touched:true,clientModel:'default',serverModel:'default'}))`);
  await open(send,base+'#/tasks/new',local?1200:4000,{reset:false});
  check('旧草稿保留分类名称，模型默认值要求重选 '+width,await evaluate(send,`${draft}.name==='旧草稿验证'&&${draft}.algorithm==='fot'&&${draft}.clientModel===''&&${draft}.serverModel===''&&!document.querySelector('.notice')`));
  await evaluate(send,"document.getElementById('algorithm-evomedclaw').click()");await sleep(180);await click('医疗诊断');
  const [datasets,agents]=await Promise.all(['datasets','agents'].map(p=>fetch(new URL('v1/'+p,base)).then(r=>r.json())));
  const agent=agents.find(a=>a.capabilities&&datasets.some(d=>d.ready&&d.taskType==='medical-diagnosis'&&d.ownerId===a.ownerId));
  if(agent){const data=datasets.find(d=>d.ready&&d.taskType==='medical-diagnosis'&&d.ownerId===agent.ownerId);const key=await evaluate(send,`${draft}.agentGroups[0].key`);await evaluate(send,SELECT('system-'+key+'-agent',agent.id));await evaluate(send,SELECT('system-'+key+'-data',data.id));await until(`${draft}.agentGroups[0].agentId===${JSON.stringify(agent.id)}&&${draft}.agentGroups[0].datasetId===${JSON.stringify(data.id)}`);await evaluate(send,SELECT('system-'+key+'-data','__clear'));await until(`${draft}.agentGroups[0].datasetId===''`);
   check('医疗数据可清除而保留Agent '+width,await evaluate(send,`${draft}.agentGroups[0].datasetId===''&&${draft}.agentGroups[0].agentId===${JSON.stringify(agent.id)}`));
   await evaluate(send,SELECT('system-'+key+'-data',data.id));await evaluate(send,SELECT('system-'+key+'-agent','__clear'));await until(`${draft}.agentGroups[0].agentId===''`);
   check('医疗Agent可清除并清理关联数据 '+width,await evaluate(send,`${draft}.agentGroups[0].agentId===''&&${draft}.agentGroups[0].datasetId===''&&document.getElementById('system-${key}-data').disabled`));
  }
  check('无横向溢出或业务写入 '+width,await evaluate(send,"document.documentElement.scrollWidth<=innerWidth&&window.__writes===0"));
 }
 if(local)for(const count of [2,4]){
  await open(send,base+'?qaTaskChoices='+count+'#/tasks/new/horizontal');await algorithm();
  if(count===2){await click('数学推理');await models();await click('回归任务 1');check('未来多个任务可直接切换且清理模型',await evaluate(send,`${draft}.taskType==='qa-task-1'&&${draft}.algorithm==='fot'&&${draft}.clientModel===''&&${draft}.serverModel===''`));await click('回归任务 1');check('其他任务同样可以重复点击取消',await evaluate(send,`${draft}.taskType===null`));}
  else{await evaluate(send,SELECT('task-type','qa-task-2'));check('超过三种任务收进菜单且可选择',await evaluate(send,`${draft}.taskType==='qa-task-2'`));await evaluate(send,SELECT('task-type','__clear'));check('任务菜单同样可以清除选择',await evaluate(send,`${draft}.taskType===null&&document.querySelector('[data-select-name=task-type]').textContent.includes('请选择')`));}
 }
 writeFileSync(out+'/evidence.json',JSON.stringify({base,local,evidence},null,2));
}finally{close()}
