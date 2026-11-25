# 文档索引

最新T158：[案例专属饮食两组对照](./LIFESTYLE-CASE-EVAL.md)，标准与匹配已冻结；7次派发因连续上游错误停止，仅1完整配对、尚无正式评分。正常25次、硬限48，旧实验保留，不部署。

最新T157已完成[CGMacros饮食推荐小试](./LIFESTYLE-DIET-TRIAL.md)：修复上游过载恢复及评分格式兼容，6学习→18候选→10经验，6位留出用户12回答全完成；两组实用／安全均100%，未见额外收益，非临床准确率。60派发含22过载，评分值与旧数据未改，完成复验全离线；未部署、未跑全量或LifeSnaps。以下T156为此前停止阶段历史。

本轮新增[CGMacros饮食推荐小试](./LIFESTYLE-DIET-TRIAL.md)：独立把生成任务调整为实际饮食建议，同题／同模型／同公开依据比较经验的边际作用；正常36次、硬限40，不部署。实际模型上游错误5次导致第6份建议触发停止，只有5/6学习过程，未提取经验或对比；缓存／账本保留，先排查上游再明确恢复预算。以下T155为此前独立观测预测实验。

LifeStyle 最新为[CGMacros观测经验小试](./LIFESTYLE-SENSOR-TRIAL.md)：T155保留旧检查点后完成六学六测，生成13条经验；无经验6/6数值、MAE5196.65，有经验6/6拒答，未体现预期预测／推荐收益。合计33/40，201测试及离线复验通过，不跑全量、不部署；后续先调整推荐经验目标。输入来自[观测样本、用户留出与调用预算](./LIFESTYLE-SAMPLES.md)及[CGMacros／LifeSnaps清理结果](./LIFESTYLE-SENSORS.md)。此前[444条提取与五包两组评测](./LIFESTYLE-FULL.md)已完成，未见总体提升；[公开资料链路](./LIFESTYLE.md)／[语料与预算](./LIFESTYLE-CORPUS.md)保留原阶段记录。

接手开发先读 [交接说明](./HANDOFF.md)（现状、部署、服务器怎么连、待办）。其余建议按以下顺序阅读：

1. [项目目标](./GOAL.md)：平台要解决什么、第一版范围、验收标准和当前不承诺什么。
2. [使用流程](./FLOW.md)：当前先选应用、兼容算法，再主动选择已校验的过程记录和模型，任务开始前只检查连接。T110记录本流程的五项设计输出。
3. [系统架构](./ARCHITECTURE.md)：插件、编排、执行、数据与应用；§40记录T100轻量进度与回答案例，§32记录T89算法流程图，§31记录T87显式选择及取消，§30记录任务选择与资源准入，§29记录独立共享和任务内组合；多用户隔离仍未实现。
4. [当前进展](./PROGRESS.md)：已经完成和还没做的能力、服务器情况，以及风险。
5. [开发说明](./DEVELOPMENT.md)：本地启动、常用命令、代码结构、如何增加算法、部署、测试约定和界面规范。
6. [关键设计决策](./DECISIONS.md)：背后的取舍，以及哪些决定已被废弃。
7. [任务记录](./HISTORY.md)：按时间顺序的 T 任务。
8. [界面参考研究](./UI-REFERENCES.md)：Mobbin Pro 中适合联邦实验、运行、结果比较和应用发布的产品与流程。
9. [Mobbin 使用与接入](./MOBBIN.md)：网页筛选、官方 MCP OAuth、搜索、下载和额度；[来源清单](./ui-reference-manifest.json)保留原图顺序及校验值。
10. [数学基准数据](./MATH-DATA.md)：八份审计题库、原始哈希、导入与旧占位资源清理。
11. [EvoMedClaw 接入调研](./EVOMEDCLAW.md)：固定源码版本、医疗数据结构、横向／纵向边界及T88原版差异；[源码比对指纹](./algorithm-source-audit.json)，FoT差异见ARCHITECTURE §20。
12. [医疗数据接入](./MEDICAL-DATA.md)：用户上传／本地接入、MedAgentSim OSCE 转换、独立评测、公开 MedQA 来源与数据哈希。

13. [过程记录与应用经验库](./PROCESS-RECORDS.md)：当前记录合同、本地生成与原算法适配范围。
14. [历史自有 Agent 接入](./AGENT-API.md)：数据／LLM／Agent边界、工作单元HTTP协议、测试与参考服务。

`agent-platform-design.svg/png` 是整体架构图（由 `agent-platform-design.gen.py` 生成），若与文字冲突，以 `ARCHITECTURE.md` 为准。算法详情页的动态示意由 [algorithm-diagrams](../tools/algorithm-diagrams/README.md) 生成，原版与适配范围在页面折叠说明中区分。截图在 `screenshots/`，常规页面用 `tools/ui-check/docshots.json` 重新生成。
