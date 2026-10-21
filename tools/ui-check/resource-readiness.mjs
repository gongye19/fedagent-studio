// 本地资源管理页完成接入／校验，任务只选择可用资源；不发模型请求。
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch,open,evaluate,sleep,SELECT} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8880/';assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const out=process.env.CDP_OUT??'/tmp/fedagent-resource-readiness';mkdirSync(out,{recursive:true});
async function req(path,method='GET'){const r=await fetch(new URL('v1/'+path,base),{method});assert.ok(r.ok,await r.clone().text());return r.status===204?null:r.json()}
const original={agents:await req('agents'),datasets:await req('datasets')},owned={};
const evidence=[],check=(n,v)=>{assert.ok(v,n);evidence.push(n);console.log('PASS',n)};
const {send,close}=await launch({port:9442,profile:'/tmp/fedagent-readiness-profile'});
async function click(text){await evaluate(send,`(()=>{const root=document.querySelector('.resource-dialog')??document;const e=[...root.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled);if(!e)throw Error('missing '+${JSON.stringify(text)});e.click()})()`);await sleep(200)}
async function set(id,value){await evaluate(send,`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await sleep(100)}
async function until(s){for(let i=0;i<100;i++){if(await evaluate(send,`Boolean(${s})`))return;await sleep(100)}throw Error('timeout '+s)}
async function task(){await open(send,base+'#/tasks/new/horizontal',1300,{reset:false});if(!await evaluate(send,"document.getElementById('algorithm-evomedclaw').checked")){await evaluate(send,"document.getElementById('algorithm-evomedclaw').click()");await sleep(150);await click('医疗诊断')}}
try{
 await open(send,base+'#/agents');await click('接入 Agent');await set('agent-name','资源页检查验证（本地）');await set('agent-url','http://127.0.0.1:1');await click('保存并检查');
 await until("document.querySelector('.resource-dialog')?.textContent.includes('能力检查未通过')");
 owned.agent=(await req('agents')).find(a=>!original.agents.some(o=>o.id===a.id)).id;
 check('资源页检查失败保留同一待修正记录',!(await req('agents')).find(a=>a.id===owned.agent).capabilities);await click('取消');
 await task();let key=await evaluate(send,"JSON.parse(localStorage.getItem('fedagent-studio:draft')).agentGroups[0].key");
 await evaluate(send,`document.getElementById('system-${key}-agent').focus();document.getElementById('system-${key}-agent').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);await sleep(200);
 check('未通过检查的接口不进入任务菜单',await evaluate(send,`![...document.querySelectorAll('[role=option]')].some(e=>e.dataset.optionValue===${JSON.stringify(owned.agent)})`));
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape'});
 await open(send,base+'#/agents',1300,{reset:false});await evaluate(send,`[...document.querySelectorAll('tbody tr')].find(e=>e.textContent.includes('资源页检查验证')).querySelectorAll('button').forEach(b=>{if(b.textContent.trim()==='编辑')b.click()})`);await sleep(200);
 await set('agent-url','http://127.0.0.1:9031');await click('保存并检查');await until("!document.querySelector('.resource-dialog')");
 check('修正后通过能力检查且没有重复登记',(await req('agents')).filter(a=>a.name==='资源页检查验证（本地）').length===1&&Boolean((await req('agents')).find(a=>a.id===owned.agent).capabilities));
 await task();await evaluate(send,SELECT('system-'+key+'-agent',owned.agent));
 check('自己的已验证接口可与共享接口统一选择',await evaluate(send,`document.querySelector('input[name="system-${key}-agent"]').value===${JSON.stringify(owned.agent)}`));
 await open(send,base+'#/resources',1300,{reset:false});await click('上传数据');await click('医疗诊断');
 const dom=await send('DOM.getDocument'),input=await send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'input[name=dataset-file]'});
 await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[resolve('.references/medical/medqa-group-1.jsonl')]});await until("document.querySelector('.check-result--ok')?.textContent.includes('检查通过')");await click('保存数据');await until("!document.querySelector('.resource-dialog')");
 owned.data=(await req('datasets')).find(d=>!original.datasets.some(o=>o.id===d.id)).id;
 await task();await evaluate(send,SELECT('system-'+key+'-data',owned.data));
 check('资源页上传校验后可在任务选择且草稿保留',await evaluate(send,`JSON.parse(localStorage.getItem('fedagent-studio:draft')).agentGroups[0].datasetId===${JSON.stringify(owned.data)}`));
 check('任务无现场上传、接入和来源切换',await evaluate(send,"!document.querySelector('input[type=file],.resource-dialog,#participants .resource-space-bar')&&![...document.querySelectorAll('#participants button')].some(b=>['接入','上传'].includes(b.textContent.trim()))"));
 await evaluate(send,SELECT('system-'+key+'-agent',original.agents[0].id));
 check('更换Agent清空该组数据',await evaluate(send,"JSON.parse(localStorage.getItem('fedagent-studio:draft')).agentGroups[0].datasetId===''") );
 writeFileSync(out+'/evidence.json',JSON.stringify(evidence,null,2));
}finally{close();if(owned.data)await req('resources/data/'+owned.data,'DELETE');if(owned.agent)await req('agents/'+owned.agent,'DELETE')}
