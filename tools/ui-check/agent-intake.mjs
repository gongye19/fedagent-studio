// 本地医疗任务内登记Agent、上传、换选与草稿；不发真实模型请求。
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {launch,open,evaluate,sleep,SELECT} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8880/';assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const out=process.env.CDP_OUT??'/tmp/fedagent-agent-intake';mkdirSync(out,{recursive:true});
async function req(path,method='GET'){const r=await fetch(new URL('v1/'+path,base),{method});assert.ok(r.ok,await r.clone().text());return r.status===204?null:r.json()}
const original={agents:await req('agents'),datasets:await req('datasets')},owned={};
const {send,close}=await launch({port:9442,profile:'/tmp/fedagent-agent-intake-profile'});
const evidence=[],check=(n,v)=>{assert.ok(v,n);evidence.push(n);console.log('PASS',n)};
async function until(s){for(let i=0;i<100;i++){if(await evaluate(send,`Boolean(${s})`))return;await sleep(100)}throw Error(s)}
async function click(label){await evaluate(send,`(()=>{const root=document.querySelector('.resource-dialog')??document;const e=[...root.querySelectorAll('button')].find(e=>(e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)})&&!e.disabled);if(!e)throw Error('missing '+${JSON.stringify(label)});e.click()})()`);await sleep(200)}
async function set(id,value){await evaluate(send,`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await sleep(100)}
try{
 await open(send,base+'#/tasks/new/horizontal');await evaluate(send,"document.getElementById('algorithm-evomedclaw').click()");await sleep(200);await click('医疗诊断');
 await click('创建并试跑');
 check('缺项在该组字段下提示',await evaluate(send,"document.getElementById('system-mine-agent-error')?.textContent.includes('请选择 Agent')&&document.getElementById('system-mine-data-error')?.textContent.includes('请选择任务数据')"));
 await click('为参与系统 1 接入 Agent');await set('agent-name','任务内医疗接入（本地）');await set('agent-url','http://127.0.0.1:9031');await click('保存并检查');await until("!document.querySelector('.resource-dialog')");
 owned.agent=(await req('agents')).find(a=>!original.agents.some(o=>o.id===a.id)).id;
 check('Agent写回当前系统，不绑定数据',await evaluate(send,`JSON.parse(localStorage.getItem('fedagent-studio:draft')).agentGroups[0].agentId===${JSON.stringify(owned.agent)}&&JSON.parse(localStorage.getItem('fedagent-studio:draft')).agentGroups[0].datasetId===''`));
 await click('为参与系统 1 上传数据');
 const dom=await send('DOM.getDocument'),input=await send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'input[name=dataset-file]'});
 await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[resolve('.references/medical/medqa-group-1.jsonl')]});await until("document.querySelector('.check-result--ok')?.textContent.includes('检查通过')");await click('保存数据');await until("!document.querySelector('.resource-dialog')");
 owned.data=(await req('datasets')).find(a=>!original.datasets.some(o=>o.id===a.id)).id;
 check('上传直接写回当前系统，数据资源无Agent字段',await evaluate(send,`JSON.parse(localStorage.getItem('fedagent-studio:draft')).agentGroups[0].datasetId===${JSON.stringify(owned.data)}`)&&!(await req('datasets')).some(d=>'agentId'in d));
 const other=original.agents.find(a=>a.resourceSpace==='workspace');assert.ok(other);
 await evaluate(send,SELECT('system-mine-agent',other.id));
 check('换Agent清空该组旧数据选择',await evaluate(send,"JSON.parse(localStorage.getItem('fedagent-studio:draft')).agentGroups[0].datasetId===''&&document.querySelector('input[name=system-mine-data]').value===''"));
 await evaluate(send,SELECT('system-mine-data',owned.data));await click('添加共享协作方');
 const key=await evaluate(send,"JSON.parse(localStorage.getItem('fedagent-studio:draft')).agentGroups[1].key");
 const peer=original.agents.find(a=>a.resourceSpace==='public'&&a.shared);await evaluate(send,SELECT('system-'+key+'-agent',peer.id));
 await evaluate(send,`document.getElementById('system-${key}-data').focus();document.getElementById('system-${key}-data').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);await sleep(200);
 check('共享数据菜单排除我方病例',await evaluate(send,`![...document.querySelectorAll('[role=option]')].some(e=>e.dataset.optionValue===${JSON.stringify(owned.data)})`));
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
 await click('移除参与系统 2');
 check('移除仅改草稿，资源保留',(await req('datasets')).some(d=>d.id===owned.data)&&await evaluate(send,"document.querySelectorAll('.participation-row').length===1"));
 writeFileSync(out+'/evidence.json',JSON.stringify(evidence,null,2));
}finally{close();if(owned.data)await req('resources/data/'+owned.data,'DELETE');if(owned.agent)await req('agents/'+owned.agent,'DELETE')}
