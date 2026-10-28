# T98 医疗判分修复验收

- real-result-desktop.png／mobile.png：真实gpt-5.6-luna、双独立HTTP服务，每方1 learn＋1 eval、2轮，A／B均1/1→1/1，7卡，任务已清理。
- real-run.json：冻结判分器／模型、数量和实际耗时；小样本仅验证链路和评分，不能据此声称联邦效果提升。
- real-moderator.json：真实语义判分分支，Hansen disease对Leprosy通过，252＋9 token。
- service-evidence.json：本站学习正确标记、卡类型、版本加载和中心只留加载凭据；没有保存病例问诊全文。
- upstream-functions.json：两个上游判分函数AST SHA256，与固定原仓库完全一致；异常和重试语义由适配层另行处理。
- local-http-result.png／local-frozen-config.png：隔离本地假模型任务及模型／规则记录，明确标为假模型。
- config-*.png、config-responsive.json／results-responsive.json：本地配置320／390／768／1024／1280，单个评测模型、无重复全局Agent选择；结果同宽度无溢出。
- 前端48／后端138测试、类型、lint、构建、结构检查通过。
- 新增296调用全ok，共405368 token；全部账本保留，模型未设置单价，实际费用以供应商结算为准。
- 原三任务与全部旧数据保留；仅两Agent capabilities／verifications更新。当前准入报告check-79ba0c1b／check-d746b8a4保留。
- 最终备份20261028T133516405262Z与线上五库行／文件哈希一致；16份产物字节匹配，schema仍0008。
