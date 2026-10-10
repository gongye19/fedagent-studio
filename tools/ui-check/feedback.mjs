// 确认与反馈的浏览器回归。真实读取本地模板，写请求只返回夹具错误，不修改数据库。
// BASE 仅允许本地开发；需要一个任务和一个应用作为模板。输出明确标记 fixtureOnly。
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch,viewport,evaluate,sleep,NEW_TASK_ALL,SELECT} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8880/';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Local development only');
const [tasks,apps,participants,datasets,endpoints]=await Promise.all(['tasks','apps','participants','datasets','endpoints'].map(async p=>(await fetch(base+'v1/'+p)).json()));
assert.ok(tasks.length&&apps.length,'Requires one local task and app as read-only fixture templates');
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9366),profile:'/tmp/fedagent-feedback-profile'});
const out=process.env.CDP_OUT??'/tmp/fedagent-feedback';mkdirSync(out,{recursive:true});
const evidence=[];let script;
const check=(name,ok)=>{assert.ok(ok,name);console.log('PASS',name);evidence.push(name)};
async function until(expression){for(let i=0;i<80;i++){if(await evaluate(send,expression))return;await sleep(150)}throw Error('Timeout '+expression)}
async function shot(name){const v=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(out+'/'+name+'.png',Buffer.from(v.data,'base64'))}
async function click(label){await evaluate(send,`(()=>{const root=document.querySelector('dialog[open]')??document;const b=[...root.querySelectorAll('button,a')].find(x=>x.textContent.trim()===${JSON.stringify(label)}&&!x.disabled);if(!b)throw Error('missing '+${JSON.stringify(label)});b.focus({preventScroll:true});window.__trigger=b;b.click()})()`);await sleep(200)}
async function load(route,fixture={}){
 if(script)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:script});
 const source=`(()=>{const f=${JSON.stringify(fixture)},original=fetch.bind(window);window.fetch=async(input,init)=>{const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;const method=init?.method??'GET';if(method!=='GET'&&path.startsWith('/v1/')&&path!=='/v1/tasks/validate'){if(path==='/v1/endpoints/models')return new Response(JSON.stringify({models:[]}),{headers:{'Content-Type':'application/json'}});return new Response(JSON.stringify({detail:'验证：请求失败，可重试'}),{status:409,headers:{'Content-Type':'application/json'}})}const kind=path.slice(4),v=f[kind]??(kind.startsWith('tasks/')&&kind.split('/').length===2?f.tasks?.find(x=>x.id===kind.split('/')[1]):undefined);return v?new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}}):original(input,init)}})()`;
 script=(await send('Page.addScriptToEvaluateOnNewDocument',{source})).identifier;
 await send('Page.navigate',{url:'about:blank'});await sleep(80);await send('Storage.clearDataForOrigin',{origin:base.slice(0,-1),storageTypes:'local_storage,session_storage'});await send('Page.navigate',{url:base+route});await until("Boolean(document.querySelector('main h1'))");await sleep(200);
}
try{
 await viewport(send,{width:1280,height:900});await load('#/');
 check('首页仅横向有入口，两个规划中不能误点',await evaluate(send,"document.querySelectorAll('a.scenario-card').length===1&&document.querySelectorAll('.scenario-card--planned').length===2&&!document.querySelector('.scenario-card--planned a')"));
 await evaluate(send,"document.querySelector('a.scenario-card').focus()");await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 check('减少动态偏好关闭图形和卡片位移',await evaluate(send,"getComputedStyle(document.querySelector('a.scenario-card')).transform==='none'&&parseFloat(getComputedStyle(document.querySelector('.scenario-visual')).transitionDuration)<0.001"));
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 const qt={...tasks[0],status:'paused',cursor:{round:1,stage:'solve',done:{},ticks:0},error:null};
 await load('#/tasks/'+qt.id+'/progress',{tasks:[qt]});await click('取消任务');await shot('cancel-modal');await click('取消任务');await until("Boolean(document.querySelector('.confirm-error'))");check('取消任务失败保留确认与任务状态',await evaluate(send,"Boolean(document.querySelector('dialog[open] .confirm-error'))&&document.body.textContent.includes('已暂停')"));await evaluate(send,"document.querySelector('.dialog-close').click()");await sleep(150);
 check('关闭取消确认恢复原操作焦点',await evaluate(send,"document.activeElement.textContent==='取消任务'"));
 await load('#/apps/'+apps[0].id);await click('撤下应用');await shot('withdraw-modal');await click('撤下');await until("Boolean(document.querySelector('.confirm-error'))");check('撤下失败留在确认中可重试',await evaluate(send,"Boolean(document.querySelector('dialog[open] .confirm-error'))"));await evaluate(send,"document.querySelector('.dialog-close').click()");await sleep(150);check('撤下取消返回原按钮',await evaluate(send,"document.activeElement.textContent==='撤下应用'"));
 const qp={...participants[0],id:'qa-participant',name:'验证参与方',builtin:false,hosting:'platform'};
 const qd={...datasets[1],id:'qa-dataset',participantId:qp.id,name:'验证数据集',source:'upload'};
 await load('#/participants/horizontal/'+qp.id,{participants:[qp],datasets:[qd,{...qd,id:'qa-dataset2',name:'验证数据集二'}],tasks:[]});
 await click('删除数据集');await shot('dataset-modal');await click('删除');await until("Boolean(document.querySelector('.confirm-error'))");check('数据集失败保留对话框和原行',await evaluate(send,"Boolean(document.querySelector('dialog[open] .confirm-error'))&&document.body.textContent.includes('验证数据集')"));await evaluate(send,"document.querySelector('.dialog-close').click()");await sleep(150);check('数据集取消恢复焦点',await evaluate(send,"document.activeElement.textContent==='删除数据集'"));
 await click('删除参与方');await click('删除');await until("Boolean(document.querySelector('.confirm-error'))");check('参与方失败留在确认中',await evaluate(send,"Boolean(document.querySelector('dialog[open] .confirm-error'))"));
 const qe={...endpoints[0],id:'qa-endpoint',name:'验证接口',builtin:false,models:['qa-model']};
 await load('#/models/'+qe.id+'/edit',{endpoints:[...endpoints,qe]});await click('删除接口');await shot('endpoint-modal');await click('删除');await until("Boolean(document.querySelector('.confirm-error'))");check('接口失败保留确认和原表单',await evaluate(send,"Boolean(document.querySelector('dialog[open] .confirm-error'))&&Boolean(document.getElementById('endpoint-name'))"));
 await load('#/tasks/new/horizontal');await evaluate(send,NEW_TASK_ALL);await click('正式运行');
 for(const name of ['client-model','server-model']) await evaluate(send,SELECT(name,'fake:fake'));
 await until("Boolean(document.querySelector('.summary-start:not(:disabled)'))");
 for(const width of [1280,390]){await viewport(send,{width,height:width===390?844:900,mobile:width===390});await click('创建并正式运行');check('正式运行只渲染一个模态 '+width,await evaluate(send,"document.querySelectorAll('dialog').length===1&&document.querySelector('dialog').textContent.includes('参与方')"));await shot('full-modal-'+width);await click('确认开始');await until("Boolean(document.querySelector('.confirm-error'))");check('正式运行创建失败保持配置和确认 '+width,await evaluate(send,"Boolean(document.querySelector('dialog[open] .confirm-error'))&&Boolean(document.querySelector('#participants input:checked'))"));await evaluate(send,"document.querySelector('.dialog-close').click()");await sleep(150);}
 await evaluate(send,"window.__configY=document.getElementById('scenario').getBoundingClientRect().top+scrollY;void 0");await click('重置配置');
 check('失败后打开重置保留错误提示与配置位置',await evaluate(send,"Boolean(document.querySelector('.notice--warning'))&&document.querySelectorAll('dialog[open]').length===1&&Math.abs(document.getElementById('scenario').getBoundingClientRect().top+scrollY-window.__configY)<1"));
 await click('继续编辑');check('取消重置保留创建错误和已选配置',await evaluate(send,"Boolean(document.querySelector('.notice--warning'))&&Boolean(document.querySelector('#participants input:checked'))"));
 await click('重置配置');await click('重置');check('确认重置同时清除旧创建错误',await evaluate(send,"!document.querySelector('.notice--warning')&&!document.querySelector('dialog[open]')&&document.getElementById('rounds-pending').disabled"));
 await load('#/tasks');
 await evaluate(send,"document.querySelector('.list-toolbar').style.marginBottom='1400px';const b=[...document.querySelectorAll('.table--tasks button')].find(x=>!x.disabled);b.scrollIntoView({block:'center'});b.focus({preventScroll:true});window.__scroll=scrollY;window.__originalTrigger=b;void 0");
 await click('删除');
 check('长页面底部打开确认不跳顶',await evaluate(send,"scrollY===window.__scroll&&document.activeElement.textContent==='取消'"));
 for(let i=0;i<8;i++){
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:i>4?8:0});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  check('正反 Tab 留在模态 '+i,await evaluate(send,"document.querySelector('dialog').contains(document.activeElement)"));
 }
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(150);
 check('Esc 取消恢复原按钮且不滚动',await evaluate(send,"!document.querySelector('dialog[open]')&&document.activeElement===window.__originalTrigger&&scrollY===window.__scroll"));
 await click('删除');
 await evaluate(send,"const original=window.fetch;window.fetch=async(...args)=>{if(args[1]?.method==='DELETE')await new Promise(r=>setTimeout(r,1200));return original(...args)}");
 await click('删除任务');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 check('提交中阻止 Esc 和重复提交',await evaluate(send,"Boolean(document.querySelector('dialog[open]'))&&[...document.querySelectorAll('dialog button')].every(x=>x.disabled)"));
 await until("Boolean(document.querySelector('.confirm-error'))");
 check('错误后仍可重试',await evaluate(send,"Boolean(document.querySelector('dialog[open] .confirm-error'))&&[...document.querySelectorAll('dialog button')].some(x=>x.textContent==='删除任务'&&!x.disabled)"));
 const dialogMessage='长名称'.repeat(30);const longTasks=[{...tasks[0],name:dialogMessage}];await load('#/tasks',{tasks:longTasks});await click('删除');
 for(const width of [1280,1180,1120,1024,900,800,768,600,390]){await viewport(send,{width,height:844,mobile:width<700});check('长确认内容不溢出 '+width,await evaluate(send,"(()=>{const r=document.querySelector('dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&document.querySelector('dialog').scrollWidth<=document.querySelector('dialog').clientWidth})()"));}
 await shot('long-name-modal-mobile');
 writeFileSync(out+'/evidence.json',JSON.stringify({fixtureOnly:true,evidence},null,2));
}finally{close()}
