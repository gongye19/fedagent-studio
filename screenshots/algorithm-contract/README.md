# T96 算法接入与共享资源验证

参考沿用既有控制台规范，组件复用Collapsible／Facts／InfoTip／Radix与统一下载，无新依赖。

- local-contract.png：本地接入规范布局；使用系统保存框实际下载两份JSON，解析确认1.1.0和三个本站步骤，文件留/tmp/fedagent-t96。
- local-responsive.json：本地320／390／768／1024／1280，无溢出。
- local-flow.json：浏览器自己一组＋共享一组通过连接后开始，经两个独立HTTP服务完成；本地假模型仅用于测试。中心SiteState只有memory_receipt，两方服务记忆版本1。
- production-contract.png／production-mobile.png：线上规范与流程图。
- production-responsive.json／production-task-responsive.json：线上详情和真实任务五种宽度无横向溢出。
- production-flow.png／production-output.png：真实任务完成和7张经验卡。任务已按授权清理，截图留作验证。
- production-flow.json：本轮新增且非check的服务审计，各6次执行，公开输出只保留加载凭据；两次评测报告版本null→1。只回报本地医生路径命中，本次为空，不推断专科全部未命中。并非中心数据库原始导出；中心边界由公开响应、版本守门及自动化回归共同验证。
- production-calls.json：339份新调用记录，451050 token。首次A接入超时已如实记录，无虚构费用或提升。
- assets.json：17份最终产物字节匹配。

前端45／后端126、lint／类型／构建及结构检查通过。单方接入、自有加共享、eval答案隔离、服务私有输出、加载拒错、旧1.0.0展示、逐轮计划和最终成果均覆盖。线上真实任务50%→50%，耗时约393秒；任务检查约0.748秒且不生成。

两旧任务和所有原数据保留，自己的临时任务／报告及服务侧状态清理；两份当前接入报告须保留。原五库行／文件审计在本地忽略目录.backups/t96，凭据不公开。完整验收后备份20261027T152106053007Z在服务器与Mac。
