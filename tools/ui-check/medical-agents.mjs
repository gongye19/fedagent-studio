// 两算法的兼容验收入口；资源、分组和清理只在统一流程里维护。
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const root=resolve(process.env.CDP_OUT??'/tmp/fedagent-medical-agents');
const only=process.env.ONLY_ALGORITHM;
assert.ok(!only||['fot','evomedclaw'].includes(only));
const base=process.env.BASE??'http://127.0.0.1:8880/';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))assert.equal(process.env.REAL_MODEL_VERIFY,'1');
if(only!=='fot'){
 const r=await fetch(new URL('v1/datasets',base));assert.ok(r.ok);
 const data=await r.json();for(const space of ['workspace','public'])assert.ok(data.some(d=>d.taskType==='medical-diagnosis'&&d.resourceSpace===space&&d.agentId),'先准备我的接入与公用协作组');
}
if(only!=='evomedclaw'){process.env.CDP_OUT=root+'/fot';await import('./resource-flow.mjs')}
if(only!=='fot'){process.env.CDP_OUT=root+'/medical';process.env.RUN_FLOW='1';await import('./collaboration-flow.mjs')}
