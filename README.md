# FedAgent Studio

通用联邦 Agent 平台：用户选择场景、算法及任务类型，再选择已验证的数据、LLM 或 Agent 服务，运行协作任务、比较结果，并将产出发布为应用。

## 开发协作

私有仓库：[gongye19/fedagent-studio](https://github.com/gongye19/fedagent-studio)。协作者需先获得仓库访问权限。

```bash
git clone git@github.com:gongye19/fedagent-studio.git
cd fedagent-studio
git switch -c feat/your-change
```

使用功能分支提交修改并通过 Pull Request 合并到 `main`。接手开发先读 [交接说明](./docs/HANDOFF.md)。

## 当前能力

- **FoT／数学推理**：选择数据集和 LLM，平台执行解题、反思、经验提取、归类和共享经验库生成。默认每题最多 3 条精选经验，最终库条数由 `paper-auto` 决定；支持多轮评测。
- **EvoMedClaw／医疗诊断**：选择多个接入方的 Agent 服务及相应病例数据，生成本地经验、聚合，再比较无经验、本地经验、联邦经验三组结果。这是平台适配协议，原版与适配范围见 [调研说明](./docs/EVOMEDCLAW.md)。
- **资源管理**：数据资源、LLM 接口、Agent 接口分别接入和验证，可共享已有资源。当前仍是共用工作区，归属标签不代表账号权限隔离。
- **任务与应用**：真实模型运行、阶段状态、暂停／恢复／取消、评测案例和结果图、产出发布／试用／导出及 API。
- **扩展**：算法、任务类型和判分通过 Python 插件注册。横向场景已有两种算法；纵向和迁移尚未接入可运行算法。

数学基准八份共 300 题，医疗数据来源及格式见 [数学数据](./docs/MATH-DATA.md) 和 [医疗数据](./docs/MEDICAL-DATA.md)。平台托管资源在服务器运行；外部医疗服务按 [Agent 规范](./docs/AGENT-API.md) 接入。

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
