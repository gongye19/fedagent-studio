// 参与方界面回归：安装包和令牌响应使用明确夹具，不签发真实令牌或访问模型。
// 本地后端须有参与方 A；本地客户端为只读浏览器夹具；shell 只解析命令或调用临时替身函数。
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch,viewport,open,evaluate,sleep,LOCAL_CONNECTION_SOURCE} from './lib.mjs';
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9376),profile:'/tmp/fedagent-participants-profile'});const evidence=[];const out=process.env.CDP_OUT??'/tmp/fedagent-participants';mkdirSync(out,{recursive:true});
function check(name,ok){assert.ok(ok,name);evidence.push(name);console.log('PASS',name)}
async function until(expr){for(let i=0;i<100;i++){if(await evaluate(send,expr))return;await sleep(150)}throw Error('Timeout '+expr)}
async function shot(name){const v=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(out+'/'+name+'.png',Buffer.from(v.data,'base64'))}
const source=`(()=>{const original=fetch.bind(window);window.__metaMode='success';window.__tokenMode='error';window.fetch=async(input,init)=>{const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;if(path==='/v1/meta'){if(window.__metaMode==='loading')await new Promise(r=>window.__resolveMeta=r);if(window.__metaMode==='error')return new Response(JSON.stringify({detail:'fixture unavailable'}),{status:503});return new Response(JSON.stringify({clientPackages:['fedagent_client-fixture.whl','fedagent_sdk-fixture.whl']}),{headers:{'Content-Type':'application/json'}})}if(path.endsWith('/client-tokens')){if(window.__tokenMode==='error')return new Response(JSON.stringify({detail:'验证：签发失败，请重试'}),{status:409});return new Response(JSON.stringify({token:'fixture_not_a_real_token'}),{headers:{'Content-Type':'application/json'}})}return original(input,init)}})()`;
await send('Page.addScriptToEvaluateOnNewDocument',{source:LOCAL_CONNECTION_SOURCE});
await send('Page.addScriptToEvaluateOnNewDocument',{source});
try{
 for(const width of [1280,390]){
  await viewport(send,{width,height:width===390?844:900,mobile:width===390});await open(send,'http://127.0.0.1:8880/#/participants/horizontal/qa-local-client');
  check('默认两块信息且连接折叠 '+width,await evaluate(send,"document.querySelectorAll('.participant-section').length===2&&!document.querySelector('.participant-connect').open&&document.querySelector('.participant-connect').getBoundingClientRect().height<90"));
  check('机构与名称分行，状态是独立列 '+width,await evaluate(send,"Boolean(document.querySelector('.participant-identity .cell-note'))&&document.querySelector('.row--open [data-label=状态]').textContent==='等待连接'&&!document.querySelector('.participant-identity .tag')"));
  await evaluate(send,"document.querySelector('.participant-connect summary').focus({preventScroll:true})");
  await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});await sleep(200);
  check('键盘展开三段连接命令 '+width,await evaluate(send,"document.querySelector('.participant-connect').open&&document.querySelectorAll('.participant-connect .code').length===3"));
  check('安装包来自平台地址 '+width,await evaluate(send,"document.querySelector('.participant-connect pre').textContent.includes(location.origin+'/client/fedagent_client-fixture.whl')"));
  const snippets=await evaluate(send,"[...document.querySelectorAll('.participant-connect pre')].map(x=>x.textContent)");
  for(const code of snippets){const syntax=spawnSync('/bin/bash',['-n'],{input:code,encoding:'utf8'});check('连接命令可被 shell 解析 '+width,syntax.status===0)}
  const result=spawnSync('/bin/bash',['-c','fedagent-client(){ printf "%s\\0" "$@"; };\n'+snippets[2]],{encoding:'utf8'});const args=result.stdout.split('\0').filter(Boolean);
  check('连接参数及占位符不会变成重定向 '+width,result.status===0&&args.includes('--dataset')&&args.includes('qa-local-data=./qa-local-data.jsonl')&&args.includes('https://<本方模型的地址>/v1')&&args.includes('<模型名>')&&args.includes('--review'));
  await evaluate(send,"Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{window.__copied=text}}});document.querySelector('.connect-environment .code-actions button:last-child').click()");await sleep(200);
  check('复制只取对应环境变量 '+width,await evaluate(send,"window.__copied===document.querySelector('.connect-environment pre').textContent&&!window.__copied.includes('pip install')"));
  await evaluate(send,"[...document.querySelectorAll('.connect-environment button')].find(x=>x.textContent==='签发客户端令牌').click()");await until("Boolean(document.querySelector('.connect-environment .notice--warning'))");
  check('签发失败靠近操作并可重试 '+width,await evaluate(send,"document.querySelector('.connect-environment .notice').textContent.includes('签发失败')&&[...document.querySelectorAll('.connect-environment button')].some(x=>x.textContent==='签发客户端令牌'&&!x.disabled)"));
  await evaluate(send,"window.__tokenMode='success';[...document.querySelectorAll('.connect-environment button')].find(x=>x.textContent==='签发客户端令牌').click()");await until("document.querySelector('.connect-environment pre').textContent.includes('fixture_not_a_real_token')");
  check('一次性令牌进入对应代码段并提示保存 '+width,await evaluate(send,"document.querySelector('.connect-environment .tag').textContent==='仅显示一次'&&!document.querySelector('.connect-environment .notice')"));
  await evaluate(send,"document.querySelector('.participant-connect').open=false;document.querySelector('.participant-connect').open=true;void 0");
  check('折叠再展开保留本次令牌 '+width,await evaluate(send,"document.querySelector('.connect-environment pre').textContent.includes('fixture_not_a_real_token')"));
  check('页面与标题栏不横向溢出 '+width,await evaluate(send,"document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.participant-connect .code-bar')].every(x=>x.scrollWidth<=x.clientWidth)"));
  await evaluate(send,"document.querySelector('.participant-connect').scrollIntoView({block:'start'})");await shot('connection-'+width);
 }
 await viewport(send,{width:1280,height:900});await open(send,'http://127.0.0.1:8880/#/participants/horizontal/p-a');
 check('样本默认折叠且分母正确',await evaluate(send,"!document.querySelector('.sample-preview').open&&document.querySelector('.participant-section .facts').textContent.includes('30 / 30')"));
 await evaluate(send,"document.querySelector('.sample-preview').open=true;void 0");check('需要时可读取样本',await evaluate(send,"document.querySelector('.sample-question').getClientRects().length>0&&document.querySelector('.sample-question p').textContent.length>0"));
 await send('Page.navigate',{url:'about:blank'});await send('Page.navigate',{url:'http://127.0.0.1:8880/#/participants'});await sleep(1200);
 await evaluate(send,"window.__metaMode='loading';location.hash='#/participants/horizontal/qa-local-client'");await until("Boolean(document.querySelector('.participant-connect'))");await evaluate(send,"document.querySelector('.participant-connect').open=true;void 0");
 check('读取安装包时准确显示加载状态',await evaluate(send,"document.querySelector('.participant-connect [role=status]')?.textContent.includes('正在读取安装包')"));
 await evaluate(send,"window.__metaMode='error';window.__resolveMeta?.();void 0");await until("document.querySelector('.participant-connect .notice')?.textContent.includes('无法读取')");
 check('读取安装包失败可原位重试',await evaluate(send,"Boolean(document.querySelector('.participant-connect .notice button'))"));await evaluate(send,"window.__metaMode='success';document.querySelector('.participant-connect .notice button').click()");await until("document.querySelector('.participant-connect pre')?.textContent.includes('pip install')");check('重试恢复安装命令',true);
 writeFileSync(out+'/evidence.json',JSON.stringify({fixtureOnly:true,evidence},null,2));
}finally{close()}
