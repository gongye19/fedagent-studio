// T83：只读检查算法先行、资源边界、跨算法清理与旧草稿；禁止付费及业务写入。
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch,viewport,open,evaluate,sleep} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8880/';
const out=process.env.CDP_OUT??'/tmp/fedagent-algorithm-config';mkdirSync(out,{recursive:true});
const evidence=[];const check=(name,ok)=>{assert.ok(ok,name);evidence.push(name);console.log('PASS',name)};
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9435),profile:'/tmp/fedagent-algorithm-config-profile'});
async function click(selector){await evaluate(send,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('disabled/missing '+${JSON.stringify(selector)});e.click()})()`);await sleep(180)}
async function pick(label){await evaluate(send,`(()=>{const e=[...document.querySelectorAll('button[role=radio]')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e||e.disabled)throw Error('disabled/missing '+${JSON.stringify(label)});e.click()})()`);await sleep(180)}
async function shot(name){await evaluate(send,'scrollTo(0,0)');const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
const draft="JSON.parse(localStorage.getItem('fedagent-studio:draft'))";
try{
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const f=fetch.bind(window);window.__writes=0;window.fetch=(input,init)=>{const method=init?.method??'GET',url=new URL(typeof input==='string'?input:input.url,location.origin);if(!['GET','HEAD'].includes(method)&&url.pathname!=='/v1/tasks/validate'){window.__writes++;throw Error('read-only')}return f(input,init)}})()`});
 for(const width of [1280,390]){
  await viewport(send,{width,height:width===390?844:900,mobile:width===390});await open(send,base+'#/tasks/new');
  check('固定字段按场景→算法→任务排列 '+width,await evaluate(send,"[...document.querySelectorAll('#scenario .field-label')].map(e=>e.textContent).join(',')==='任务名称,场景,算法,任务类型'"));
  check('未选场景时算法及任务均禁用 '+width,await evaluate(send,"[...document.querySelectorAll('input[name=algorithm]')].every(e=>e.disabled)&&[...document.querySelectorAll('[aria-labelledby=task-type-label] button')].every(e=>e.disabled)"));
  await pick('横向联邦');await click('#algorithm-fot');
  check('FoT可先选择，不替用户选任务 '+width,await evaluate(send,`${draft}.algorithm==='fot'&&${draft}.taskType===null`));
  check('FoT只列数学任务与两个LLM选择，没有执行方式 '+width,await evaluate(send,"document.querySelector('[aria-labelledby=task-type-label]').textContent.includes('数学推理')&&!document.querySelector('[aria-labelledby=task-type-label]').textContent.includes('医疗诊断')&&Boolean(document.getElementById('client-model'))&&Boolean(document.getElementById('server-model'))&&!document.getElementById('task-agent')&&!document.getElementById('execution-mode')"));
  await pick('数学推理');await shot('fot-'+width);
  await click('#algorithm-evomedclaw');
  check('更换算法清空任务与数据，自动采用Agent资源 '+width,await evaluate(send,`${draft}.taskType===null&&${draft}.participants.length===0&&${draft}.execution==='agent'&&${draft}.agentId===null&&Object.keys(${draft}.agentOverrides).length===0`));
  check('医疗只列医疗任务与Agent接口 '+width,await evaluate(send,"document.querySelector('[aria-labelledby=task-type-label]').textContent.includes('医疗诊断')&&!document.querySelector('[aria-labelledby=task-type-label]').textContent.includes('数学推理')&&!document.getElementById('task-agent')&&document.getElementById('participants').textContent.includes('数据与 Agent')&&!document.getElementById('client-model')&&!document.getElementById('server-model')&&!document.getElementById('execution-mode')"));
  await pick('医疗诊断');await shot('medical-'+width);
  await open(send,base+'#/tasks/new',undefined,{reset:false});
  check('刷新保留医疗算法、任务和Agent执行 '+width,await evaluate(send,`${draft}.algorithm==='evomedclaw'&&${draft}.taskType==='medical-diagnosis'&&${draft}.execution==='agent'&&document.getElementById('algorithm-evomedclaw').checked`));
  await click('#algorithm-fot');await pick('数学推理');
  await evaluate(send,`localStorage.setItem('fedagent-studio:draft',JSON.stringify({...${draft},execution:'agent',agentId:'old-agent',agentOverrides:{'p-a':'old-agent'}}))`);
  await open(send,base+'#/tasks/new',undefined,{reset:false});
  check('旧FoT Agent草稿静默转回LLM并清除残留 '+width,await evaluate(send,`${draft}.execution==='builtin'&&${draft}.agentId===null&&Object.keys(${draft}.agentOverrides).length===0&&!document.getElementById('task-agent')&&!document.querySelector('.notice')`));
  check('无横向溢出或业务写入 '+width,await evaluate(send,'document.documentElement.scrollWidth<=innerWidth&&window.__writes===0'));
 }
 const registry=await(await fetch(new URL('v1/registry',base))).json();
 check('注册表执行能力与页面一致',!registry.algorithms.find(a=>a.id==='fot').requirements.executionModes.includes('agent')&&registry.algorithms.find(a=>a.id==='evomedclaw').requirements.executionModes.join(',')==='agent');
 writeFileSync(`${out}/evidence.json`,JSON.stringify({base,readOnly:true,evidence},null,2));
}finally{close()}
