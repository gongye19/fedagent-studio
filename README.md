# FedAgent Studio

应用经验协作平台：用户上传已完成的医疗问诊或数学推理过程，平台使用算法提取和聚合经验，再供应用处理新问题。

## 开发协作

私有仓库：[gongye19/fedagent-studio](https://github.com/gongye19/fedagent-studio)。协作者需先获得仓库访问权限。

```bash
git clone git@github.com:gongye19/fedagent-studio.git
cd fedagent-studio
git switch -c feat/your-change
```

使用功能分支提交修改并通过 Pull Request 合并到 `main`。接手开发先读 [交接说明](./docs/HANDOFF.md)。

## 当前能力

- **应用**：医疗问诊与数学推理，先选应用，再选兼容算法、过程数据与模型。
- **FoT**：两种应用均可用；原反思／提取／归类／paper-auto 聚合读取已完成的过程，不重新生成过程。
- **EvoMedClaw**：从上传问诊轨迹校验、编译与签名聚合经验卡；不再要求用户登记 Agent API。
- **经验库**：任务生成后发布，应用可试用、对比不用经验／使用经验、导出及 API 调用。
- **资源与扩展**：上传校验、已验证 LLM、共享资源；算法与数据合同仍通过插件扩展。当前共用工作区，尚无账号权限隔离。

详见 [过程记录规范与适配范围](./docs/PROCESS-RECORDS.md)。原八份数学基准与医疗原始数据、历史任务及旧 Agent API 保留；新入口不把原始病例或题库当成过程记录。不宣称完整原论文复现或小样本效果提升。

## 本地运行

前端：React 19、TypeScript、Vite；后端：Python 3.12、FastAPI、SQLAlchemy／SQLite。需要 Node.js 20.19+ 或 22.12+ 和 uv。

```bash
cd server
uv sync --frozen
uv run fedagent dev --port 8000
```

另开终端启动前端：

```bash
cd app
npm ci
npm run dev
```

访问 <http://127.0.0.1:8880/>。本地开发命令使用测试模型，数据位于 `server/.data/`；正式模型在平台 LLM 接口页配置，不要把凭据提交到 Git。

## 验证与部署

```bash
(cd app && npm run check)
(cd server && uv run --frozen pytest -q && uv run --frozen ruff check . && uv run --frozen pyright)

# 提交后，在干净的 main 分支部署
bash deploy/deploy.sh
```

部署顺序为 **检查 → 推送 GitHub → 服务器获取同一提交 → 构建 → 空闲检查与备份 → 更新和健康检查**，不再从本机直接同步源码。完整流程见 [开发与部署说明](./docs/DEVELOPMENT.md)。

实验室平台：<http://100.111.198.54:8880/>，仅 Tailscale 内网可访问。GitHub 仓库权限和实验室服务器权限分别管理；生产数据、密钥和备份不在 GitHub 中。

## 目录与文档

| 目录 | 内容 |
|---|---|
| `app/` | 前端、组件、状态及 API 类型 |
| `server/fedagent/` | 平台 API、资源、任务编排、模型网关及持久化 |
| `server/sdk/`、`server/plugins/` | 插件 SDK、FoT、数学任务及 EvoMedClaw 适配 |
| `server/client/` | 本地参与方客户端 |
| `deploy/` | GitHub 部署、进程管理及完整备份 |
| `tools/` | 结构检查、算法图生成及界面验证辅助 |
| `docs/` | 需求、架构、开发、算法、验收和交接 |

- [文档索引](./docs/README.md) · [项目目标](./docs/GOAL.md) · [使用流程](./docs/FLOW.md)
- [架构](./docs/ARCHITECTURE.md) · [开发说明](./docs/DEVELOPMENT.md) · [进展](./docs/PROGRESS.md)
- [决策](./docs/DECISIONS.md) · [任务记录](./docs/HISTORY.md) · [界面参考](./docs/UI-REFERENCES.md)
