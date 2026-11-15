// LifeStyle 布局验收：包含首次打开和空状态，测量坐标、间距与对齐，而非只看溢出。
// 全程只改隔离 Chrome 的 mock 状态；禁止 HTTP 写入。
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch,viewport,open,evaluate,sleep,SELECT} from './lib.mjs';
const base=process.env.BASE??'http://127.0.0.1:8894/';
const out=process.env.OUT??'/tmp/fedagent-lifestyle-layout';mkdirSync(out,{recursive:true});
const widths=(process.env.WIDTHS??'1440,1280,1024,768,640,390').split(',').map(Number);
const {send,close}=await launch({port:Number(process.env.CDP_PORT??9510),profile:out+'/chrome'});
const report=[];
const read=`(() => {
 const errors=[];const root=document.querySelector('.lifestyle-demo');if(!root)return {errors:['LifeStyle 未加载']};
 const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2}};
 const visible=e=>{const r=box(e);return r.width>0&&r.height>0&&!e.closest('[hidden]')};
 const near=(a,b,name)=>{if(Math.abs(a-b)>1.2)errors.push(name+': '+a.toFixed(1)+' / '+b.toFixed(1))};
 const bounds=box(root);
 const directDetail=root.querySelector(':scope > .lifestyle-detail');if(directDetail)near(box(directDetail).top-box(root.querySelector('.page-head')).bottom,24,'详情页头正文间距');
 const title=root.querySelector('.page-title-row h1'),reset=root.querySelector('.page-head .page-actions > button');if(title&&reset)near(box(title).cy,box(reset).cy,'页标题与重置按钮垂直居中');
 if(document.documentElement.scrollWidth>innerWidth+1)errors.push('页面横向溢出');
 const controls=[...root.querySelectorAll('button,a,[role=combobox]')].filter(visible);
 for(const e of controls){const r=box(e);if(r.left<-1||r.right>innerWidth+1)errors.push('控件越界');if(!(e.getAttribute('aria-label')||e.textContent.trim()))errors.push('控件无名称');if(innerWidth<=640&&r.height<39)errors.push('触屏控件高度不足');}
 for(const e of root.querySelectorAll('[aria-controls]'))if(!document.getElementById(e.getAttribute('aria-controls')))errors.push('控件指向不存在的内容');
 const panels=[];
 for(const panel of root.querySelectorAll('.panel')){
  const p=box(panel);near(p.left,bounds.left,'面板左缘');near(p.right,bounds.right,'面板右缘');
  const head=panel.querySelector(':scope > .panel-head'),body=panel.querySelector(':scope > .panel-body');
  if(head&&body?.firstElementChild){const h=box(head.querySelector('h2')),child=box(body.firstElementChild),inset=parseFloat(getComputedStyle(body).paddingLeft);near(h.left,child.left,'标题与内容左缘');near(child.left,p.left+1+inset,'内容内边距');near(child.top,box(head).bottom+parseFloat(getComputedStyle(body).paddingTop),'面板正文上边距');
   const actions=head.querySelector('.panel-actions');if(actions&&visible(actions)){const a=box(actions);if(a.top<box(head.querySelector('h2')).bottom)near(a.cy,h.cy,'标题与操作垂直居中');}
  }
  panels.push(p);
 }
 const tab=root.querySelector(':scope > .tab-panel');if(tab){const bar=root.querySelector('.tab-bar');near(box(tab).top,box(bar).bottom,'页签内容起点');const first=tab.firstElementChild;near(box(first).top,box(tab).top+24,'页签下间距');}
 for(const dl of root.querySelectorAll('.lifestyle-facts,.lifestyle-package-meta')){
  const items=[...dl.children];for(const item of items){const dt=item.querySelector('dt'),dd=item.querySelector('dd');if(!dt||!dd)continue;if(dl.classList.contains('lifestyle-package-meta')){near(box(dt).left,box(dd).left,'统计标签与数值左缘');near(box(dd).top-box(dt).bottom,8,'统计标签数值间距');}else near(box(dd).left-box(dt).left,112,'资料标签值轴线');}
 }
 const empty=root.querySelector('.lifestyle-package-empty .panel-empty');let emptyGap=null;
 if(empty){const p=box(empty.querySelector('p')),b=box(empty.querySelector('.button'));if(getComputedStyle(empty).flexDirection==='column'){emptyGap=b.top-p.bottom;near(p.left,b.left,'空状态文字按钮左缘');if(emptyGap<15)errors.push('空状态纵向间距不足');}else{emptyGap=b.left-p.right;if(emptyGap<23)errors.push('空状态横向间距不足');near(p.cy,b.cy,'空状态说明与按钮垂直居中');}}
 const stage=root.querySelector('.lifestyle-preview-stage'),phone=root.querySelector('.lifestyle-phone');let phoneBox=null;
 if(stage&&phone){phoneBox=box(phone);near(phoneBox.cx,box(stage).cx,'App 预览居中');if(phoneBox.width>421)errors.push('App 预览过宽');const icon=phone.querySelector('header > .lifestyle-app-icon'),heading=phone.querySelector('.lifestyle-phone-body > h2');near(box(icon).left,box(heading).left,'App 顶部与内容左轴');const card=phone.querySelector('.lifestyle-notification');if(card){near(box(card).left,box(heading).left,'通知与分区标题左缘');const edges=[...card.children].filter(e=>visible(e)&&!e.classList.contains('lifestyle-notice-detail')).map(e=>box(e).left);for(const x of edges)near(x,edges[0],'通知内部内容左轴');}if(phone.querySelector('.lifestyle-preview-empty')&&innerWidth>640&&phoneBox.height>400)errors.push('空预览有过多留白');}
 const picker=root.querySelector('.lifestyle-preview-controls');if(picker){const label=box(picker.querySelector('label')),select=box(picker.querySelector('[role=combobox]'));near(label.cy,select.cy,'用户选择标签垂直居中');near(select.left-label.right,8,'用户选择标签控件间距');}
 const table=root.querySelector('.lifestyle-users');if(table&&getComputedStyle(table.tHead).display!=='none'){
  const headers=[...table.tHead.rows[0].cells];for(const row of table.tBodies[0].rows)for(let i=0;i<row.cells.length;i++){const c=row.cells[i],h=headers[i];near(box(c).left,box(h).left,'表头行列起点');near(box(c).right,box(h).right,'表头行列终点');}
 }else if(table){for(const row of table.tBodies[0].rows){const h=row.querySelector('th'),action=row.querySelector('.cell-action a');near(box(h).cy,box(action).cy,'窄屏姓名与操作垂直居中');near(box(action).right,box(row).right-16,'窄屏操作右边距');}}
 return {errors,bounds,panels,emptyGap,phoneBox};
})()`;
const click=async(text)=>{await evaluate(send,`(()=>{const e=[...document.querySelectorAll('main button,main a,[role=alertdialog] button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('missing '+${JSON.stringify(text)});e.focus();e.click()})()`);await sleep(300)};
const capture=async(width,state)=>{
 await evaluate(send,'document.fonts.ready');await sleep(100);
 const measured=await evaluate(send,read);
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(out+'/'+state+'-'+width+'.png',Buffer.from(shot.data,'base64'));
 report.push({width,state,...measured});console.log(measured.errors.length?'FAIL':'PASS',width,state,measured.errors.join('; '));
};
try{
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__layoutWrites=[];const original=fetch.bind(window);window.fetch=(input,init)=>{const m=(init?.method??input?.method??'GET').toUpperCase();if(!['GET','HEAD'].includes(m)){window.__layoutWrites.push(m);throw Error('layout audit blocked HTTP write');}return original(input,init);};`});
 for(const width of widths){
  await viewport(send,{width,height:1000,mobile:width<=640});
  await open(send,base+'#/apps/lifestyle',700);await capture(width,'users');
  await click('演示经验包');await capture(width,'experience-empty');
  await click('App 提示预览');await capture(width,'preview-empty');
  // 空状态按钮必须能直接进入下一步，不能只有说明文字。
  await click('生成演示经验包');await capture(width,'experience-ready');
  await click('App 提示预览');await capture(width,'preview-ready-to-match');await click('匹配用户');
  await capture(width,'preview-notice');await click('查看提示');await capture(width,'preview-notice-open');
  for(const [id,state] of [['ls-05','preview-unmatched'],['ls-06','preview-incomplete'],['ls-01','preview-reported']]){await evaluate(send,SELECT('lifestyle-preview-user',id));await capture(width,state);}
  await open(send,base+'#/apps/lifestyle/users/ls-01',600,{reset:false});await capture(width,'detail-report');
  await open(send,base+'#/apps/lifestyle/users/ls-04',600,{reset:false});await capture(width,'detail-no-report');
  await click('模拟上传报告');await evaluate(send,"document.querySelector('.page-back a').click()");await sleep(300);
  await click('演示经验包');await capture(width,'experience-outdated');
  await click('重置演示');await sleep(100);
  const dialog=await evaluate(send,"(()=>{const r=document.querySelector('dialog').getBoundingClientRect();return {cx:r.left+r.width/2,cy:r.top+r.height/2,w:innerWidth,h:innerHeight}})()");
  if(Math.abs(dialog.cx-dialog.w/2)>2||Math.abs(dialog.cy-dialog.h/2)>2)throw Error('reset dialog not centered');
  await click('取消');await capture(width,'after-reset-cancel');
  if(await evaluate(send,'window.__layoutWrites.length'))throw Error('layout audit attempted HTTP write');
 }
}finally{writeFileSync(out+'/report.json',JSON.stringify(report,null,2));close()}
if(report.some(x=>x.errors.length))process.exitCode=1;
