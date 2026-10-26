# T94 验证记录

- production-task-ready-1280／390：线上当前医疗配置，只显示资源短名与绿色勾，没有成功段落。
- production-agent-running-1280：线上接入阶段的真实诊断进度；完整检查留在此处。
- local-running／ready／failed：隔离延时接口演示实际转圈、完成与503错误；错误只在对应接口下提示，修正后可重试。local-failed为开发过程中捕获，最终删掉了重复的泛化错误句。
- local-agent-verified-1280：浏览器实际登记Agent、选择已有数据并验证完整输出。
- layout-verification.json：线上五宽度无横向溢出，成功段落为0。
- zero-calls.json：任务快速检查前后调用／Agent运行数完全不变；没有推理请求。
- real-evidence.json：真实LLM、双Agent接入及FoT两轮；接入报告是资源凭据，保留而不当临时数据清理。
- data-verification.json：原字段与文件保留；新增schema0008验证列、72调用、平台Agent运行6、资源接入报告2和当前页面连接报告1。私有原始五库／密钥不提交git。
- assets-verification.json：17份构建产物与线上字节一致。

前端43／后端121及门禁通过，完整快照20261026T162835036033Z与重启前后线上一致。本轮没有重复医疗完整联邦两轮或应用，也不声称效果提升。
