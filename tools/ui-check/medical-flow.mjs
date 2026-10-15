// 仅限本地：真实上传与 runner，使用公开 MedQA 数据与假模型；只清理本次资源。
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {launch,viewport,open,evaluate,sleep,SELECT} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8880/';assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const data=resolve(process.env.MEDICAL_DATA_DIR??'../../.references/medical'),out=process.env.CDP_OUT??'/tmp/fedagent-t75-browser';mkdirSync(out,{recursive:true});
const read=async(p)=>{const r=await fetch(new URL(p,base));assert.ok(r.ok,p);return r.json()};
assert.ok((await read('v1/endpoints')).some(x=>x.id==='fake'&&x.kind==='fake'));
const original=Object.fromEntries(await Promise.all(['tasks','apps','datasets'].map(async k=>[k,(await read(`v1/${k}`)).map(x=>x.id).sort()])));
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9397),profile:'/tmp/fedagent-t75-browser-profile'});
const evidence=[],owned=[];let taskId,appId;
function check(name,ok){assert.ok(ok,name);evidence.push(name);console.log('PASS',name)}
async function until(s){const end=Date.now()+30000;while(Date.now()<end){if(await evaluate(send,s))return;await sleep(150)}throw Error(s)}
async function click(label){await evaluate(send,`(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled);if(!e)throw Error('missing '+${JSON.stringify(label)});e.click()})()`);await sleep(250)}
async function set(selector,value){await evaluate(send,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing input');const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(100)}
async function file(path){const d=await send('DOM.getDocument'),n=await send('DOM.querySelector',{nodeId:d.root.nodeId,selector:'input[name=dataset-file]'});await send('DOM.setFileInputFiles',{nodeId:n.nodeId,files:[path]})}
async function shot(name){const m=await send('Page.getLayoutMetrics');const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:Math.ceil(m.cssLayoutViewport.clientWidth),height:Math.ceil(m.cssContentSize.height),scale:1}});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
try{
 await viewport(send,{width:1280,height:900});await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out});
 for(let group=1;group<=2;group++){
  const pid=group===1?'p-a':'p-b',before=new Set((await read('v1/datasets')).map(x=>x.id));
  await open(send,base+`#/datasets/new?participant=${pid}`);await click('横向联邦');await click('医疗诊断');
  if(group===1){await click('下载数据模板');await sleep(300);check('下载空结构模板',readFileSync(`${out}/dataset-template.jsonl`,'utf8').includes('"patient"'));
   const line=readFileSync(`${data}/medqa-group-1.jsonl`,'utf8').split('\n')[0];writeFileSync(`${out}/bad.jsonl`,line+'\n'+line+'\n');
   await file(`${out}/bad.jsonl`);await until("Boolean(document.querySelector('.check-result--failed'))");check('错误原位反馈且禁止保存',await evaluate(send,"document.querySelector('.check-result--failed').textContent.includes('id 与第 1 行重复')&&[...document.querySelectorAll('button')].find(b=>b.textContent==='保存数据集').disabled"));await shot('upload-error');}
  await file(`${data}/medqa-group-${group}.jsonl`);await until("document.querySelector('.check-result')?.textContent.includes('检查通过')");
  await set('input[name=dataset-name]',`MedQA · 分组 ${group}`);await shot(`upload-group-${group}`);await click('保存数据集');await until("location.hash.startsWith('#/participants')");
  const ds=(await read('v1/datasets')).find(x=>!before.has(x.id));assert.ok(ds);owned.push(ds.id);check('保存真实医疗病例与结构化预览',ds.taskType==='medical-diagnosis'&&ds.sample.fields.some(f=>f.label==='病人信息')&&ds.count===(group===1?54:53));
 }
 await open(send,base+'#/tasks/new/horizontal');await click('医疗诊断');await evaluate(send,"document.getElementById('algorithm-evomedclaw').click()");await sleep(200);await evaluate(send,"document.querySelector('input[aria-label=全选]').click()");
 await set('#trial-cap','2');await set('#task-name','医疗流程验证（仅本地）');await evaluate(send,SELECT('client-model','fake:fake'));await until("Boolean(document.querySelector('.config-test-trigger[data-ready=true]:not(:disabled)'))");await click('测试配置');await until("Boolean(document.querySelector('.summary-start[data-ready=true]:not(:disabled)'))");
 check('医疗配置无需服务端模型',await evaluate(send,"!document.querySelector('[data-model-name=server-model],[data-select-name=server-model]')"));await shot('medical-config');await click('创建并试跑');await until("location.hash.includes('/tasks/task-')");taskId=await evaluate(send,"location.hash.split('/')[2]");
 let task;for(let i=0;i<100;i++){task=await read(`v1/tasks/${taskId}`);assert.notEqual(task.status,'paused',task.error);if(task.status==='completed')break;await sleep(200)}check('runner 两轮完成且只评测留出病例',task.status==='completed'&&task.members.every(x=>x.problems===2&&x.answered===1));
 await open(send,base+`#/tasks/${taskId}/output`);await shot('medical-output');await click('发布为应用');await set('#publish-name','医疗流程验证应用（仅本地）');await click('发布');await until("[...document.querySelectorAll('a')].some(a=>a.textContent==='立即试用')");await click('立即试用');await until("Boolean(document.getElementById('try-patient'))");appId=await evaluate(send,"location.hash.split('/')[2]");
 const src=JSON.parse(readFileSync(`${data}/medqa-group-1.jsonl`,'utf8').split('\n')[0]).OSCE_Examination,txt=x=>typeof x==='string'?x:JSON.stringify(x,null,2);
 await set('#try-patient',txt(src.Patient_Actor));await set('#try-objective',txt(src.Objective_for_Doctor));await set('#try-examination',txt(src.Physical_Examination_Findings));await set('#try-tests','{broken');
 check('JSON 字段错误原位显示且禁止运行',await evaluate(send,"document.getElementById('try-tests-error').textContent.includes('JSON')&&[...document.querySelectorAll('button')].find(b=>b.textContent==='运行对比').disabled"));
 await set('#try-tests',JSON.stringify(typeof src.Test_Results==='object'?src.Test_Results:{results:src.Test_Results},null,2));await set('#try-answer',src.Correct_Diagnosis);
 if(await evaluate(send,"Boolean(document.querySelector('[data-select-name=try-model]'))"))await evaluate(send,SELECT('try-model','fake:fake'));
 await shot('medical-try-desktop');await viewport(send,{width:390,height:844,mobile:true});await shot('medical-try-mobile');await click('运行对比');await until("Boolean(document.getElementById('try-result'))");check('结构化输入返回对比与判分',await evaluate(send,"document.querySelectorAll('.compare-item').length===2&&document.querySelectorAll('.compare-usage').length===2"));await shot('medical-comparison');
 await viewport(send,{width:1280,height:900});await open(send,base+`#/apps/${appId}/integrate`);await until("document.body.textContent.includes('复制完整 JSON')");check('接入使用单次 API 和完整医疗经验格式',await evaluate(send,"document.body.textContent.includes('/invoke')&&document.body.textContent.includes('cards')&&document.body.textContent.includes('patient')"));await shot('medical-integrate');
 writeFileSync(`${out}/evidence.json`,JSON.stringify({taskId,appId,datasets:owned,evidence},null,2));
}finally{
 if(appId)assert.ok((await fetch(new URL(`v1/apps/${appId}`,base),{method:'DELETE'})).ok);
 if(taskId){const t=await read(`v1/tasks/${taskId}`);if(['queued','running','paused'].includes(t.status))await fetch(new URL(`v1/tasks/${taskId}/cancel`,base),{method:'POST'});await sleep(200);assert.ok((await fetch(new URL(`v1/tasks/${taskId}`,base),{method:'DELETE'})).ok)}
 for(const id of owned)assert.ok((await fetch(new URL(`v1/datasets/${id}`,base),{method:'DELETE'})).ok);close();
 for(const k of ['tasks','apps','datasets'])assert.deepEqual((await read(`v1/${k}`)).map(x=>x.id).sort(),original[k],`保留原有 ${k}`);console.log('PASS 只清理本次资源');
}
