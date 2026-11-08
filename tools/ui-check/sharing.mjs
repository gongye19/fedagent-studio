// 本地真实 HTTP：上传自动共享，接口仍可独立共享和撤回；不发模型请求。
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch,viewport,open,evaluate,sleep} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8880/';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname),'仅本地');
const out=process.env.CDP_OUT??'/tmp/fedagent-sharing';mkdirSync(out,{recursive:true});
const evidence=[],owned=[];let close;
const check=(name,ok)=>{assert.ok(ok,name);evidence.push(name);console.log('PASS',name)};
async function req(path,method='GET',body){const r=await fetch(new URL('v1/'+path,base),{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,await r.clone().text());return r.status===204?null:r.json()}
try{
 const agent=await req('agents','POST',{name:'共享接口回归（本地）',baseUrl:'http://127.0.0.1:9031'});owned.push(['agents',agent.id]);
 const llm=await req('endpoints','POST',{name:'共享LLM回归（本地）',baseUrl:'http://127.0.0.1:9999/v1',models:['local-only']});owned.push(['endpoints',llm.id]);
 const f=new FormData();f.set('name','共享数据回归（本地）');f.set('taskType','medical-records');f.set('hosting','platform');
 const record={id:'sharing-check',input:{patient:'只供内部处理的记录',objective:'identify diagnosis',tests:{},examination:{}},
  events:[{role:'doctor',content:'follow-up question'}],output:'Pneumonia',answer:'Pneumonia'};
 f.set('file',new Blob([JSON.stringify(record)]),'record.jsonl');
 const uploaded=await fetch(new URL('v1/resources/data',base),{method:'POST',body:f});assert.ok(uploaded.ok,await uploaded.clone().text());const data=(await uploaded.json()).dataset;owned.push(['resources/data',data.id]);
 check('上传直接共享，上传响应与列表不含样本',data.shared&&data.sample===null&&(await req('datasets')).find(d=>d.id===data.id)?.sample===null);
 const browser=await launch({port:9441,profile:'/tmp/fedagent-sharing-profile'});const {send}=browser;close=browser.close;
 async function click(text,root='document'){await evaluate(send,`(()=>{const e=[...${root}.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled);if(!e)throw Error('Missing '+${JSON.stringify(text)});e.click()})()`);await sleep(300)}
 async function until(expression){for(let i=0;i<60;i++){if(await evaluate(send,`Boolean(${expression})`))return;await sleep(100)}throw Error(expression)}
 for(const width of [1280,390]){
  await viewport(send,{width,height:900,mobile:width===390});
  await open(send,base+'#/resources/public/data');
  await click(data.name);
  check(`旧入口使用同一数据目录，详情仅展示基本信息 ${width}`,await evaluate(send,
   "Boolean(document.querySelector('.participant-detail'))&&!document.querySelector('.resource-space-bar')&&!document.querySelector('.sample-preview')&&!document.querySelector('main').textContent.includes('只供内部处理的记录')"));
  for(const [kind,item,route] of [['agent',agent,'#/agents'],['llm',llm,'#/models']]){
   await open(send,base+route);
   const root=`[...document.querySelectorAll('tbody tr')].find(e=>e.textContent.includes(${JSON.stringify(item.name)}))`;
   await click('共享',root);
   check(`${kind}共享确认居中 ${width}`,await evaluate(send,"(()=>{const r=document.querySelector('[role=alertdialog]').getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2)<2&&Math.abs(r.y+r.height/2-innerHeight/2)<2})()"));
   if(kind==='agent'&&width===1280){
    await evaluate(send,"window.__originalFetch=window.fetch;window.fetch=(input,init)=>String(input).includes('/sharing')?Promise.resolve(new Response(JSON.stringify({detail:'仅本地失败反馈验证'}),{status:503,headers:{'content-type':'application/json'}})):window.__originalFetch(input,init)");
    await click('共享',"document.querySelector('[role=alertdialog]')");
    check('共享失败原位保留确认框并允许重试',await evaluate(send,"document.querySelector('[role=alertdialog]').textContent.includes('仅本地失败反馈验证')"));
    await evaluate(send,"window.fetch=window.__originalFetch");
   }
   await click('共享',"document.querySelector('[role=alertdialog]')");await until("!document.querySelector('[role=alertdialog]')");
   const list=await req(kind==='agent'?'agents':'endpoints');const row=list.find(r=>r.id===item.id);
   check(`${kind}共享后保留工作区归属 ${width}`,row.shared&&row.resourceSpace==='workspace'&&row.ownerId==='workspace');
   await click('共享资源');await until(`document.querySelector('main').textContent.includes(${JSON.stringify(item.name)})`);
   check(`${kind}共享目录可见 ${width}`,true);
   await click('取消共享',root);await click('取消共享',"document.querySelector('[role=alertdialog]')");await until("!document.querySelector('[role=alertdialog]')");
   await until(`!document.querySelector('main table').textContent.includes(${JSON.stringify(item.name)})`);
   check(`${kind}撤回后从共享目录移除 ${width}`,true);
   await click('我的资源');await until(`document.querySelector('main').textContent.includes(${JSON.stringify(item.name)})`);
   check(`${kind}撤回后自己的资源仍保留 ${width}`,true);
   check(`${kind}无横向溢出 ${width}`,await evaluate(send,'document.documentElement.scrollWidth<=innerWidth'));
  }
 }
 writeFileSync(`${out}/evidence.json`,JSON.stringify(evidence,null,2));
}finally{
 close?.();
 for(const [path,id] of owned.reverse())await req(`${path}/${id}`,'DELETE');
}
