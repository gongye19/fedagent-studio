// 仅本地：真实保存绑定、原位失败反馈和恢复，不发模型请求。
import assert from 'node:assert/strict';
import {launch,open,evaluate,sleep,SELECT} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8880/';assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const read=async p=>(await fetch(new URL('v1/'+p,base))).json();
const data=await read('datasets'),agents=await read('agents');
const own=data.find(d=>d.taskType==='medical-diagnosis'&&d.resourceSpace==='workspace'&&d.agentId),peer=data.find(d=>d.taskType==='medical-diagnosis'&&d.resourceSpace==='public'&&d.agentId);assert.ok(own&&peer);
const alternative=agents.find(a=>a.id!==own.agentId&&a.capabilities?.algorithms.evomedclaw);assert.ok(alternative);
const {send,close}=await launch({port:9460,profile:'/tmp/fedagent-binding-profile'});
const check=(label,ok)=>{assert.ok(ok,label);console.log('PASS',label)};
async function wait(expr){const end=Date.now()+15000;while(Date.now()<end){if(await evaluate(send,`Boolean(${expr})`))return;await sleep(150)}throw Error(expr)}
try{
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const f=fetch.bind(window);window.fetch=async(input,init)=>{const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;if(path==='/v1/task-checks')throw Error('禁止模型调用');if(init?.method==='PATCH'&&window.__bindingFail)return new Response(JSON.stringify({detail:'绑定验证失败，请重试'}),{status:422,headers:{'content-type':'application/json'}});return f(input,init)}})()`});
 await open(send,base+'#/tasks/new/horizontal');await evaluate(send,"document.getElementById('algorithm-evomedclaw').click()");await sleep(180);await evaluate(send,"[...document.querySelectorAll('button[role=radio]')].find(b=>b.textContent==='医疗诊断').click()");await sleep(200);
 await evaluate(send,`document.getElementById('pick-${own.participantId}').click()`);await evaluate(send,SELECT('data-agent-'+own.id,''));await wait(`document.querySelector('[data-select-name="data-agent-${own.id}"]').textContent.includes('选择 Agent')`);
 check('解除绑定真实保存且界面同步',(await read('datasets')).find(d=>d.id===own.id).agentId===null);
 await evaluate(send,SELECT('data-agent-'+own.id,own.agentId));await wait(`document.querySelector('[name="data-agent-${own.id}"]').value===${JSON.stringify(own.agentId)}`);
 check('选择Agent真实保存并恢复绑定',(await read('datasets')).find(d=>d.id===own.id).agentId===own.agentId);
 await evaluate(send,'window.__bindingFail=true');await evaluate(send,SELECT('data-agent-'+own.id,alternative.id));await wait(`document.getElementById('binding-${own.id}-error')`);
 check('失败在对应行反馈且不覆盖原绑定',await evaluate(send,`document.getElementById('binding-${own.id}-error').textContent.includes('绑定验证失败')&&document.querySelector('[name="data-agent-${own.id}"]').value===${JSON.stringify(own.agentId)}`));
 await evaluate(send,'window.__bindingFail=false');
 await evaluate(send,`[...document.querySelectorAll('button')].find(b=>b.textContent==='公用协作').click()`);await sleep(200);
 check('公用组不展示可改写的Agent菜单',await evaluate(send,'!document.querySelector(".agent-data-agent [role=combobox]")'));
}finally{
 close();await fetch(new URL('v1/resources/data/'+own.id+'/agent',base),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({agentId:own.agentId})});
}
