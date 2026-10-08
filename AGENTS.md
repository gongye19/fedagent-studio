# 给接手开发的 AI 的说明

FedAgent Studio 是通用的联邦 Agent 平台：多个参与方的 Agent 在不交出原始数据和标注的前提下协作变强。前后端第一版已完成，部署在实验室服务器上（只在 Tailscale 内网访问），接的是真实大模型。

**先读 [docs/HANDOFF.md](docs/HANDOFF.md)**（现状、部署、服务器怎么连、待办），再按 [docs/README.md](docs/README.md) 查其他文档。

## 和用户协作

- 回复、文档、界面文案都用中文，说人话，少用术语；长任务的总结也用中文。
- 用户要一次查清、一次改完：改完自己端到端复测（本地测试 → 部署 → 在部署的平台上用真实模型走一遍），复测中发现的新问题一并修好，通过后再汇报；汇报写清测了什么、发现了什么。
- 界面有较大改动时，先截图给用户看、讨论没问题再接着做后端。
- 选主流、成熟的做法；能复用现成方案就不自己造。
- 每次改动同步文档：`docs/HISTORY.md` 记一条任务（T 编号接着往下），有取舍时在 `docs/DECISIONS.md` 记一条决策（D 编号），`docs/PROGRESS.md` 写现状；相关时改 ARCHITECTURE、DEVELOPMENT、FLOW、GOAL。
- git 只在本地提交（仓库没有远端），Conventional Commit，不改已有的历史。
- Python 虚拟环境用 uv 建在项目目录里（`server/.venv`），不要全局安装任何东西。

## 安全红线

- 服务器只用 SSH 密钥登录（`ssh -o BatchMode=yes -p 10022 poly-zhu@100.111.198.54`），绝不用密码；不在聊天、文件、提交里写任何密码、密钥、令牌。
- 模型 API 密钥只由用户自己在平台"基础管理 → 模型接口 → 编辑 → API 密钥"里粘贴（只能写入、不能读出，加密保存在服务器）。不要替用户在第三方控制台创建密钥，也不要自己输入密钥。检查接口用平台的"测试连接"或服务器上的 `POST /v1/endpoints/default/test`，密钥不经过你。
- 平台只在 Tailscale 内网访问；对公网开放（隧道等）、开启访问令牌、加 crontab，都要用户同意。
- 真实模型调用要花钱：试跑先用小规模（每份 1–2 条、2 轮，约 $0.1），写明预计费用。

## 产品规则（用户反复强调过）

- **通用平台**：场景 → 任务类型 → 算法插件 → 数据。FoT 只是第一个接入的算法（横向场景），界面和代码都不为它写死。
- **分类统一两层**：所有列表先按场景（横向 / 纵向 / 迁移）分块，任务类型是表格的一列。
- **新建任务每一步由用户选**：场景、任务类型、算法、参与方都不预先选好；固定配置区域和通用字段从首次打开起全部展示，未满足前置条件时置灰或写明先选什么，不要逐块出现；选项最后留"待接入"的空位，表示以后还有别的。
- **界面**：沿用控制台布局（面板、字段名在上的两栏表单、选项按钮、带勾选的表格、右侧配置摘要），T62 用户已确认 Braintrust／LangSmith／ElevenAgents，T64 补充确认 Relevance AI 操作反馈和 Replit／Higgsfield 首页方向，见 [docs/UI-REFERENCES.md](docs/UI-REFERENCES.md)。只改善现有流程，不因为参考增加多余功能；简洁，控件下方不放说明小字（填错时才显示）；中文不能出现一两个字被折到下一行；左右边缘对齐。资源展开行先显示分区概况，状态不重复，样本／连接指南按需展开，操作跟随对应内容（T65／D61）。规范写在 `app/src/styles.css` 开头和 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。
- **动效**：沿用 T66／D62 的 150–180ms 轻量反馈；不靠 key 重挂载页面，不随后台轮询重播，不改变固定底栏、焦点或任务进度；支持减少动态，需验证生产构建（CSS 压缩会改写时长单位）。
- **用词**：FoT 的产出叫"经验库"，trace 叫"解题经验"，不用"洞见"。
- **模型接口**：部署的平台上只登记真实接口（测试用假模型只在本地开发和自动测试里有）；每个接口选用一个模型，列表只写接口名称和这个模型。
- FoT 的作者是团队成员，不用考虑授权问题。

## 代码和命令

```text
app/        前端：React 19 + TypeScript 6 + Vite 8、TanStack Query、ECharts（命令在 app/）
server/     后端：Python 3.12、FastAPI、SQLAlchemy 2 + Alembic（SQLite）、httpx；uv workspace（命令在 server/）
  fedagent/   平台核心：API、注册表、编排、runner、模型网关、存储
  sdk/        插件开发包 fedagent-sdk（算法基类、清单、步骤上下文、OpenAI 兼容的请求规则）
  plugins/    FoT 算法插件、数学推理任务类型
  client/     参与方本地客户端 fedagent-client
deploy/     部署到实验室服务器：deploy.sh（在本机运行）、serve.sh（在服务器上运行）
tools/ui-check/  界面检查脚本：截图、可访问性、断行
docs/       目标、使用流程、架构、开发说明、进展、决策、任务记录、交接说明
```

```bash
cd server && uv sync && uv run fedagent dev --port 8000   # 后端（带测试用假模型），数据在 server/.data
cd app && npm install && npm run dev                       # 前端 http://127.0.0.1:8880/，/v1 转给 8000
cd app && npm run check                                    # lint、类型、测试、构建
cd server && uv run pytest && uv run ruff check . && uv run pyright
cd app && npm run api:types                                # 后端接口改了以后重新生成前端类型
bash deploy/deploy.sh                                      # 在仓库根目录：跑完全部检查后部署到服务器
```

改了页面：用 `tools/ui-check` 截桌面 1280 和手机 390 的图并扫可访问性、断行（见 [tools/ui-check/README.md](tools/ui-check/README.md)）。改了模型调用或编排：本地测试之外，部署后在平台上跑一次小试跑。

详细的开发说明见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)，架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
