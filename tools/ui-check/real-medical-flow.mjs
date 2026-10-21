// 真实医疗验收沿用当前成组接入；线上调用必须显式确认。
import assert from 'node:assert/strict';
assert.equal(process.env.REAL_MODEL_VERIFY, '1', 'Explicit real-model verification required');
process.env.BASE ??= 'http://100.111.198.54:8880/';
process.env.RUN_FLOW = '1';
await import('./collaboration-flow.mjs');
