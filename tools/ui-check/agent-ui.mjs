// 只读检查三类资源入口、接入说明下载与上传窗口；不保存接口或调用模型。
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {launch,viewport,open,evaluate,sleep} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8880/';
const out=process.env.CDP_OUT??'/tmp/fedagent-agent-ui';mkdirSync(out,{recursive:true});
const evidence=[];const check=(label,value)=>{assert.ok(value,label);evidence.push(label);console.log('PASS',label)};
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9432),profile:'/tmp/fedagent-agent-ui-profile'});
async function click(text){await evaluate(send,`(()=>{const root=document.querySelector('.resource-dialog')??document;const e=[...root.querySelectorAll('button,a')].find(x=>x.textContent.trim()===${JSON.stringify(text)}&&!x.disabled);if(!e)throw Error('missing '+${JSON.stringify(text)});e.focus();e.click()})()`);await sleep(250)}
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'))}
try{
 await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=fetch.bind(window);window.fetch=(input,init)=>{const method=init?.method??'GET';if(method!=='GET'&&method!=='HEAD')throw Error('Read-only check blocks '+method);return original(input,init)}})()`});
 for(const width of [1280,390]){
   await viewport(send,{width,height:width===390?844:900,mobile:width===390});await open(send,base+'#/agents');
   check(`三类资源导航与 Agent 页一致 ${width}`,await evaluate(send,"document.querySelector('main h1').textContent==='Agent 接口'&&document.querySelectorAll('.nav-link--active').length===1"));
   await click('接入 Agent');check(`Agent 登记仅有名称、地址、可选密钥 ${width}`,await evaluate(send,"['agent-name','agent-url','agent-key'].every(id=>document.getElementById(id))&&!document.querySelector('.resource-dialog [data-model-name]')"));
   check(`下载协议按钮可通过键盘访问 ${width}`,await evaluate(send,"[...document.querySelectorAll('.resource-dialog button')].some(b=>b.textContent==='下载接入协议'&&b.tabIndex>=0)"));
   if(width===1280){await click('下载接入协议');for(let i=0;i<100&&!existsSync(`${out}/fedagent-agent-v1.json`);i++)await sleep(200);const spec=JSON.parse(readFileSync(`${out}/fedagent-agent-v1.json`,'utf8'));check('下载当前协议、两算法清单与结构定义',spec.protocol==='fedagent-agent/1'&&spec.algorithms.fot&&spec.algorithms.evomedclaw&&spec.requestSchema.properties.items)}
   await shot('agent-intake-'+width);check(`接入窗口不溢出 ${width}`,await evaluate(send,"document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.resource-dialog').getBoundingClientRect().right<=innerWidth"));
   await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape'});await sleep(200);
   check(`关闭恢复 Agent 入口焦点 ${width}`,await evaluate(send,"!document.querySelector('.resource-dialog')&&document.activeElement.textContent.includes('接入 Agent')"));
   await open(send,base+'#/resources/mine/data');await click('上传数据');check(`普通上传只有文件配置 ${width}`,await evaluate(send,"!document.getElementById('resource-hosting-label')&&!document.getElementById('resource-source')&&Boolean(document.querySelector('input[name=dataset-file]'))"));await shot('upload-'+width);
 }
 await open(send,base+'#/models/public');
 const editable=await evaluate(send,"document.querySelector('tbody a')?.getAttribute('href')??null");
 if(editable){await open(send,base+editable);await click('取消');check('公用 LLM 编辑取消回到公用接口',await evaluate(send,"location.hash==='#/models/public'"))}
 const agents=await(await fetch(new URL('v1/agents',base))).json();
 await open(send,base+'#/tasks/new');await click('横向联邦');
 await evaluate(send,"document.getElementById('algorithm-fot').click()");await sleep(200);await click('数学推理');
 check('FoT 只配置运行及汇总 LLM，不出现 Agent 或执行方式',await evaluate(send,"!document.getElementById('task-agent')&&!document.getElementById('execution-mode')&&Boolean(document.getElementById('client-model'))&&Boolean(document.getElementById('server-model'))"));
 await evaluate(send,"document.getElementById('algorithm-evomedclaw').click()");await sleep(200);await click('医疗诊断');
 check('医疗要求 Agent，运行与汇总 LLM 控件不出现',await evaluate(send,"Boolean(document.getElementById('task-agent'))&&!document.getElementById('client-model')&&!document.getElementById('server-model')&&![...document.querySelectorAll('button[role=radio]')].some(b=>b.textContent.includes('平台内置流程'))"));
 if(!agents.length)check('没有 Agent 时明确提示并提供接入入口',await evaluate(send,"document.getElementById('task-agent').disabled&&document.getElementById('task-agent').textContent.includes('暂无匹配的 Agent')&&[...document.querySelectorAll('button')].some(b=>b.textContent.includes('接入 Agent')&&!b.disabled)"));
 const registry=await(await fetch(new URL('v1/registry',base))).json();
 const medical=registry.algorithms.find(a=>a.id==='evomedclaw');
 check('医疗默认问诊上限为已验证的12回合，注册表只允许Agent',medical.requirements.executionModes.join(',')==='agent'&&medical.params.find(p=>p.key==='maxTurns').default===12);
 writeFileSync(`${out}/evidence.json`,JSON.stringify({readOnly:true,base,evidence},null,2));
}finally{close()}
