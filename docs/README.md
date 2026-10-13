# 文档索引

接手开发先读 [交接说明](./HANDOFF.md)（现状、部署、服务器怎么连、待办）和仓库根目录的 [AGENTS.md](../AGENTS.md)（协作规则和安全红线）。其余建议按以下顺序阅读：

1. [项目目标](./GOAL.md)：平台要解决什么、第一版范围、验收标准和当前不承诺什么。
2. [使用流程](./FLOW.md)：谁在用，怎么发起任务、看结果、用经验库，参与方怎么加入；T74 方案覆盖用户自有数据／本地环境／Agent 服务以及两个算法的接入。
3. [系统架构](./ARCHITECTURE.md)：后端设计。插件体系与扩展点、三种场景、任务编排、执行器（参与方的运行位置）、数据、评测、产出与应用、模型网关、API、存储、安全、开发测试与部署、FoT 插件；§22 是尚未实现的用户接入与跨任务类型契约。
4. [当前进展](./PROGRESS.md)：已经完成和还没做的能力、服务器情况，以及风险。
5. [开发说明](./DEVELOPMENT.md)：本地启动、常用命令、代码结构、如何增加算法、部署、测试约定和界面规范。
6. [关键设计决策](./DECISIONS.md)：背后的取舍，以及哪些决定已被废弃。
7. [任务记录](./HISTORY.md)：按时间顺序的 T 任务。
8. [界面参考研究](./UI-REFERENCES.md)：Mobbin Pro 中适合联邦实验、运行、结果比较和应用发布的产品与流程。
9. [Mobbin 使用与接入](./MOBBIN.md)：网页筛选、官方 MCP OAuth、搜索、下载和额度；[来源清单](./ui-reference-manifest.json)保留原图顺序及校验值。
10. [数学基准数据](./MATH-DATA.md)：八份审计题库、原始哈希、导入与旧占位资源清理。
11. [EvoMedClaw 接入调研](./EVOMEDCLAW.md)：固定源码版本、医疗数据结构、横向／纵向实现边界与SDK适配步骤。

`agent-platform-design.svg/png` 是整体架构图（由 `agent-platform-design.gen.py` 生成），若与文字冲突，以 `ARCHITECTURE.md` 为准。截图在 `screenshots/`，用 `tools/ui-check/docshots.json` 重新生成。
