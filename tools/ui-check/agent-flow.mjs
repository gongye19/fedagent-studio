// 旧入口兼容：统一执行当前成组接入流程，避免维护过期的全局 Agent 表单。
process.env.RUN_FLOW ??= '1';
await import('./collaboration-flow.mjs');
