# 开发说明

## 环境

- Node.js 20.19+ 或 22.12+，npm 10+
- Python 3.12 和 uv：虚拟环境建在项目目录里（`server/.venv`），不全局安装

## 本地运行

后端（API 和 runner 在同一个进程里，数据在 `server/.data`，删掉这个目录就回到初始数据）：

```bash
cd server
uv sync
uv run fedagent dev --port 8000
```

前端（另开一个终端）：

```bash
cd app
npm install
npm run dev
```

打开 <http://127.0.0.1:8880/>。前端开发服务器把 `/v1` 和 `/healthz` 转给 `127.0.0.1:8000`，要换地址时设环境变量 `FEDAGENT_API`。

- `fedagent dev` 带一个"测试用假模型"接口，不花钱就能从新建任务跑到发布应用；部署的平台（`fedagent serve`）没有它，只登记真实接口。开关是 `FEDAGENT_FAKE_ENDPOINT`，每次启动按它补上或删掉。真实模型在"模型接口"里配置（OpenAI 兼容），每个接口从接口提供的模型里选一个。
- 第一次启动时写入初始数据：参与方 A–H 和它们的数据集（A、B 的 AIME 题库随代码一起；C–H 的 6 份 LiveMathBench 题库要从 FoT 代码包导入：`uv run fedagent datasets import-fot-bundle <zip>`）、一个等待连接的本地参与方示例、默认 LLM 接口（待配置）。
- 后端的其他命令：`uv run fedagent --help`（`serve`、`runner` 分开启动、`db upgrade`、`seed`、`openapi`、`contract` 等）。

## 常用命令

前端（在 `app/`）：

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run check
npm run api:types
```

- `check` 按顺序执行 lint、类型检查、测试和生产构建，提交前应完整通过；
- `api:types` 从后端导出 OpenAPI 定义（`src/api/openapi.json`），再生成前端类型（`src/api/schema.d.ts`）。改了后端的接口或结构就运行一次，前端类型检查会指出要改的地方。

后端（在 `server/`）：

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run fedagent contract fot
```

`contract` 在内置题库的前几题上用假模型把算法跑完，检查只用了声明的通道、标注没有离开持有方、每轮都有产出、暂停后续跑和不中断的结果一致。

## 代码结构

后端见 [ARCHITECTURE.md](./ARCHITECTURE.md) §17。前端：

```text
app/src/
├── api/
│   ├── client.ts       调用后端的函数和错误类型（ApiError 带后端写明的原因）；访问令牌保存在这个浏览器里
│   ├── openapi.json    后端导出的 OpenAPI 定义
│   └── schema.d.ts     由 openapi.json 生成的类型（npm run api:types），不要手改
├── domain/
│   ├── catalog.ts      场景、任务类型和算法注册表：启动时从 GET /v1/registry 读（installRegistry），页面按清单生成
│   ├── resources.ts    参与方、数据集、模型接口的类型和规则（能不能选入任务、模型引用、显示名）
│   ├── config.ts       新建任务的草稿：默认值、即时的必填检查、选场景 / 任务类型 / 算法 / 参与方（每方一份数据集）
│   ├── task.ts         任务的类型、状态（含"排队中"）和显示用的计算
│   └── validate.ts     数据集 JSONL 检查（和后端同一套规则，上传前先在浏览器里查一遍）
├── state/
│   ├── server.ts       TanStack Query：读参与方、数据集、模型接口、任务、应用；有运行中的任务时每 2 秒刷新
│   ├── actions.ts      写操作（创建任务、暂停 / 继续 / 取消、发布、登记参与方和数据集、保存接口……），成功后刷新相关数据
│   ├── store.ts / draft.ts  新建任务的草稿（reducer），保存在浏览器里
│   ├── route.ts        hash 路由
│   └── flash.ts / ids.ts
├── ui/
│   ├── HomePage.tsx         首页：居中的三张场景卡片（可用的点进去新建这个场景的任务）
│   ├── ScenarioArt.tsx      场景卡片上的示意图（横向按行分、纵向按列分、迁移从已有领域到新领域）
│   ├── TasksPage.tsx        联邦任务：按场景分块列出任务（任务类型是一列），每块一个"新建联邦任务"；名称搜索、任务类型和状态筛选对所有块生效
│   ├── HorizontalTaskPage.tsx 横向联邦的任务配置页（控制台风格的配置面板 + 右侧配置摘要 + 窄屏吸底操作栏）；校验和预估由后端做
│   ├── TaskPage.tsx         任务详情（task/ 下是概览、进度、产出、配置四个标签）
│   ├── AppsPage.tsx         应用列表：和联邦任务一样按场景分块，任务类型是一列；名称搜索、任务类型筛选
│   ├── AppPage.tsx          应用详情：试用（真实调用，带 / 不带应用对比并判分）、内容、接入（导出 JSON、API）
│   ├── ParticipantsPage.tsx 参与方与数据：按场景分块，每块一张表（一行一份数据集）；详情里有数据集、本地客户端的连接令牌和命令、新增和删除
│   ├── NewParticipantPage.tsx 新增参与方（独立页面，同时登记第一份数据集）
│   ├── NewDatasetPage.tsx   新增数据集（独立页面：参与方 → 场景 → 任务类型 → 文件或名称）
│   ├── DatasetFields.tsx / datasetForm.ts 登记数据集的字段和规则（新增参与方和新增数据集共用）
│   ├── AlgorithmsPage.tsx   算法：按场景分三栏的算法卡片，每栏最后是"待接入"的空位；可以按任务类型筛选
│   ├── AlgorithmPage.tsx    算法详情：概况、每轮步骤、参数（默认值和说明）、来源
│   ├── ModelsPage.tsx       模型接口列表
│   ├── EndpointPage.tsx     新增、编辑模型接口（独立页面；密钥只能写入，可以测试连接）
│   ├── Chart.tsx            ECharts 封装（按需加载，概览页的哑铃图）
│   ├── OutputGroups.tsx     按类别列出产出里的条目（任务产出和应用内容共用）
│   ├── console.tsx          控制台风格的表单组件：Panel、Field / FieldGroup、UnitInput、Choices
│   ├── common.tsx           共用组件：Tag、PageHead、Confirm、Notice、FormActions、Meta、CodeBlock、Collapsible、PanelEmpty、Stat、Facts 等
│   ├── filters.tsx          列表页共用的任务类型筛选
│   ├── TaskTable.tsx / labels.ts / format.ts / icons.tsx
├── test/               测试用的注册表和数据（registry.json 是后端注册表的快照）
├── App.tsx             外框与侧栏导航；读不到数据时的加载、出错和填访问令牌的页面
├── main.tsx
└── styles.css
```

## 增加一个算法

算法是后端的插件，前端不用改：注册表、新建任务的选项、高级配置里的参数、预估、进度页、产出页和算法页都按插件的清单生成。

1. 在 `server/plugins/<名称>/` 建一个包：`pyproject.toml` 里用 entry point 登记（组名 `fedagent.algorithms`），包里放 `manifest.yaml`（角色、每轮步骤、交换通道、产出、评估、参数、轮次）和继承 `fedagent_sdk.Algorithm` 的类，每一步一个方法，用 `@step` 对应到清单。写法见 [ARCHITECTURE.md](./ARCHITECTURE.md) §4，FoT 插件（`server/plugins/fot`）是完整的例子。
2. 把包加进 `server/pyproject.toml` 的 workspace 成员和依赖，运行 `uv sync`。
3. 运行 `uv run fedagent contract <算法 id>` 和 `uv run pytest`。契约测试通过，说明数据流向和清单一致、可以续跑。
4. 新的任务类型或判分方式同样是插件（组名 `fedagent.task_types`、`fedagent.graders`），数学推理在 `server/plugins/math_reasoning`。
5. 新场景的第一个算法：场景从"规划中"改为"可用"（`server/fedagent/registry.py` 的 `SCENARIOS`），再按 §6 做这个场景的配置页。
6. 前端运行 `npm run api:types`（接口有变化时），验证桌面、768 和手机三种宽度，以及从创建到完成的全过程。

## 部署到实验室服务器（Tailscale 内网）

前端和后端都部署在实验室服务器上，只监听服务器的 Tailscale 地址，校园网和公网都访问不到；本机要先加入 Tailscale，并能用密钥登录服务器（不用密码）。

```bash
bash deploy/deploy.sh
```

脚本依次：本地跑完前后端的检查 → 停下服务器上的旧进程 → 同步前端构建产物和后端代码 → 在服务器上运行 `serve.sh`（装 uv 和 Python 3.12、按 `uv.lock` 装依赖、迁移数据库、启动 api 和 runner、健康检查）。`SKIP_CHECKS=1` 跳过本地检查。打开 <http://100.111.198.54:8880/>。

- 所有文件都在服务器的 `~/fedagent-studio` 里（目录布局见 [ARCHITECTURE.md](./ARCHITECTURE.md) §18）；数据在 `data/`，部署不覆盖；
- 访问令牌是可选的，现在关闭：Tailscale 内网里能访问这个地址的人都能使用。要开启时运行 `bash ~/fedagent-studio/serve.sh token on`，令牌保存在服务器的 `~/fedagent-studio/data/admin-token`，浏览器第一次打开时要填；`token off` 关闭。部署不会改变开关；
- 状态、停止、重启：`bash ~/fedagent-studio/serve.sh status | stop | start`；日志在 `~/fedagent-studio/logs/`；
- 进程在退出 SSH 后继续运行，但服务器重启后要重新运行 `bash ~/fedagent-studio/serve.sh`；
- 重启时运行中的任务会停下，重启后从检查点继续，已完成的模型调用不重复计费。

## 测试约定

- 前端：
  - `domain/*.test.ts`：草稿的检查和参与方的选择规则、任务状态和显示用的计算、数据集文件检查；
  - `state/*.test.ts`：草稿的 reducer 和路由；
  - 测试用 `src/test/registry.json`（后端注册表的快照）和 `src/test/fixtures.ts`，不连后端。
- 后端（`server/tests/`）：
  - `test_fot_prompts.py`：FoT 的提示词和上游逐字一致（用指纹固定）、经验库条数的几种算法、经验提取量的校准；
  - `test_math.py`：两种判分和数据检查（和前端同一套规则）；
  - `test_gateway.py`：重试、不该重试的错误、费用记账、续跑时从账本取回已完成的调用（不重复计费）、默认接口没配置时的提示、重试用完时带上接口给的原因、接口检查（读模型列表，按插件声明的生成参数逐个模型试）；
  - `test_units.py`：发给一方的消息按固定顺序读出（和并发完成的先后无关）、过期的尝试不能保存结果；
  - `test_contract.py`：FoT 的契约测试；
  - `test_api.py`：各个接口，以及平台托管和本地客户端混合的完整流程；
  - `test_runner.py`：用真实子进程跑任务，以及 runner 重启后不会同时跑两个进程。
- 页面结构变化时，至少做一次桌面和手机端的浏览器验证（接上本地后端，用假模型跑一遍）。
- 界面规范写在 `styles.css` 开头，新增界面前先看一遍（T40 起表单按 AWS 控制台的写法：面板 + 字段名在上的两栏表单 + 选项按钮 + 带单选 / 复选的表格）：
  - 页面标题一律用 `PageHead`（它同时设置浏览器标题）；新增、编辑是独立的路由和页面（包在 `.form-page` 里），不在列表页上展开表单；
  - 配置区块一律用 `Panel`；表单字段一律用 `Field`，放进 `FieldGroup` 的两栏网格，选项按钮组、表格、长文本用 `wide` 占满一行；
  - 字段名一行写完；可以不填的字段传 `optional`；控件下方不放说明，只有填错时传 `error`；需要解释的字段传 `info`（字段名旁的"说明"，点开才显示）；单位用 `UnitInput`；
  - 决定任务内容的选择（场景、任务类型、算法、参与方、运行位置、数据集的场景和任务类型）即使只有一个选项，也由用户自己选，不预先选好；只有一个取值、又不需要用户决定的字段（例如只有一个模型）直接显示文字；
  - 不可逆的操作一律用 `Confirm` 在原地确认，不用 `window.confirm`；创建、保存、发布、删除之后用 `showFlash(目标页, 文字)` 在目标页顶部提示；
  - 多段元信息一律交给 `Meta`，不要在字符串里拼" · "；
  - 列表页的分类统一两层：先按场景分块（每个场景一个 `Panel`，规划中的场景标"规划中"），任务类型是表格的一列；上方 `.list-toolbar` 放搜索和 `TaskTypeSelect`，对所有场景一起生效。新的列表页照这个写，不要用标签页切换场景，也不要把任务类型做成分组标题；
  - 互斥的少量选项用 `Choices`，选项多或次要设置用下拉，选对象（算法、参与方）用带单选 / 复选的表格；
  - 标签一律用 `Tag`，折叠一律用 `Collapsible`，代码块一律用 `CodeBlock`；
  - 表单底部一律用 `FormActions`：保存按钮不可用时写明还缺什么（和按钮关联，读屏也能听到）；
  - 页面上不铺开算法细节，只写一句说明；算法专属的参数放进"高级配置"；
  - 字号 6 档、字重 3 档、4 为基数的间距。

## 提交约定

建议使用简洁的 Conventional Commit：

```text
feat: add transfer scenario algorithm
fix: keep delta column visible on phones
docs: refresh architecture and usage flow
test: cover library publishing
```
