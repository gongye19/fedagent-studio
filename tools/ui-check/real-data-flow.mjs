// 兼容旧命令：统一使用当前任务内上传→测试→两轮→发布→试用流程，避免维护两套过期操作。
import assert from 'node:assert/strict';
assert.equal(process.env.REAL_MODEL_VERIFY, '1', 'Explicit real-model verification required');
process.env.BASE ??= 'http://100.111.198.54:8880/';
await import('./resource-flow.mjs');
