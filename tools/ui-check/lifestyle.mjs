// 仅操作浏览器中的 LifeStyle 演示；拦截所有 HTTP 写请求，禁止生产资源写入。
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch,viewport,open,evaluate,sleep,SELECT} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8893/';
const out=process.env.OUT??'/tmp/fedagent-lifestyle-ui';mkdirSync(out,{recursive:true});
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9500),profile:out+'/chrome'});
const assertions=[];
const check=async(expression,label)=>{if(!await evaluate(send,expression))throw Error(label);assertions.push(label);console.log('PASS',label)};
const click=async(text)=>{await evaluate(send,`(()=>{const b=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('missing control '+${JSON.stringify(text)});b.focus();b.click()})()`);await sleep(250)};
const shot=async(name)=>{const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`${out}/${name}.png`,Buffer.from(image.data,'base64'))};
const geometry=async()=>{await check("document.documentElement.scrollWidth<=innerWidth+1",'no horizontal overflow');await check("[...document.querySelectorAll('main button,main a,main [role=combobox]')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height}).every(e=>{const r=e.getBoundingClientRect();return r.right<=innerWidth+1&&r.left>=-1})",'controls stay within viewport')};
try{
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__demoWrites=[];const original=fetch.bind(window);window.fetch=(input,init)=>{const method=(init?.method??input?.method??'GET').toUpperCase();if(!['GET','HEAD'].includes(method)){window.__demoWrites.push(method);throw Error('Read-only demo verification blocked HTTP write');}return original(input,init);};`});
 for(const width of [1440,1280,768,390]){
  await viewport(send,{width,height:1000,mobile:width===390});await open(send,base+'#/apps/lifestyle',700);
  await check("document.querySelector('h1')?.textContent==='LifeStyle'&&document.querySelectorAll('.lifestyle-users tbody tr').length===6",'six fictional users are visible');
  await check("document.body.textContent.includes('不运行真实联邦算法')&&document.querySelectorAll('.lifestyle-users [aria-expanded]').length===0",'mock scope explicit and data list flat');
  await geometry();await shot('users-'+width);
  if(width===1440){
   await check("[...document.querySelectorAll('.side-nav a')].some(a=>a.textContent==='LifeStyle'&&a.getAttribute('aria-current')==='page')",'second application highlighted in sidebar');
  }
  await click('生成演示经验包');
  await check("location.hash.endsWith('/experience')&&document.body.textContent.includes('3 份')&&document.body.textContent.includes('2 人')&&document.body.textContent.includes('1 人')",'package evidence includes supporting and counterexample reports');
  await geometry();await shot('experience-'+width);
  await click('匹配用户');await check("location.hash.endsWith('/preview')&&Boolean(document.querySelector('.lifestyle-notification'))",'matched other user receives mock App prompt');
  await click('查看提示');await check("document.querySelector('#lifestyle-notice-detail')?.textContent.includes('不代表已经患病')",'prompt details distinguish matching from diagnosis');
  await geometry();await shot('preview-'+width);
  if(width===1440){
   for(const [id,text] of [['ls-05','没有匹配到演示经验'],['ls-06','资料不足'],['ls-01','已有模拟体检结果']]){
    await evaluate(send,SELECT('lifestyle-preview-user',id));await check(`document.querySelector('.lifestyle-preview-empty')?.textContent.includes(${JSON.stringify(text)})`,'preview state '+id);
   }
   await evaluate(send,SELECT('lifestyle-preview-user','ls-04'));
   await open(send,base+'#/apps/lifestyle/preview',700,{reset:false});
   await check("Boolean(document.querySelector('.lifestyle-notification'))",'refresh preserves browser-only demo results');
   await open(send,base+'#/apps/lifestyle/users/ls-04',700,{reset:false});
   await check("document.querySelector('.page-back a')?.getAttribute('href')==='#/apps/lifestyle'",'user detail has parent return');
   await click('模拟上传报告');await check("document.body.textContent.includes('1.9 mmol/L')&&!document.body.textContent.includes('模拟上传报告')",'simulated upload shows report and timestamp');
   await open(send,base+'#/apps/lifestyle/experience',700,{reset:false});
   await check("document.body.textContent.includes('有新的可用报告')",'new reports invalidate stale matching');
   await click('重新生成演示包');await check("document.body.textContent.includes('4 份')",'new package includes eligible uploaded report');
   await click('匹配用户');await check("document.querySelector('.lifestyle-preview-empty')?.textContent.includes('已有模拟体检结果')",'known result avoids repeated unknown-result prompts');
   await click('重置演示');await click('取消');await check("!document.querySelector('[role=alertdialog]')",'reset can be cancelled');
   await click('重置演示');await evaluate(send,"document.querySelector('[role=alertdialog] .button--primary').click()");await sleep(250);
   await check("location.hash==='#/apps/lifestyle'&&document.body.textContent.includes('3 份体检报告')&&document.body.textContent.includes('生成演示经验包')",'reset clears only mock session');
   await open(send,base+'#/apps/lifestyle/users/not-found',500,{reset:false});
   await check("document.body.textContent.includes('演示用户')&&!document.querySelector('.lifestyle-detail')",'unknown user does not substitute another profile');
  }
  await check("window.__demoWrites.length===0",'no HTTP writes or real model calls');
 }
 writeFileSync(out+'/report.json',JSON.stringify({assertions},null,2));
}finally{close()}
