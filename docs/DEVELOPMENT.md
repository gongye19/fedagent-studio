# 开发说明

T75：SDK0.2.0／客户端0.1.2，五个安装包新增医疗插件。新任务类型须提供 check、schema_version、标签定义、template、preview、input_fields、application_item／application_input；托管语义检查来自后端，本地文件由客户端检查。规范不兼容应转换／重新登记。invoke 单次使用成果，apply 保留对比，export 为真实格式；医疗代码与数据见 EVOMEDCLAW／MEDICAL-DATA。medical-flow.mjs 仅允许本地假模型，MEDICAL_DATA_DIR 指定公开源分组文件，只清理本次核验资源。

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
- 第一次启动加载A–H八个参与方和八份实际数学题库，共300题，文件随代码保存；默认LLM接口待配置。不创建空合作方或手写样本；旧库完整导入和清理见MATH-DATA。
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
│   ├── ScenarioArt.tsx      源码 SVG 关系图（横向协作、纵向互补、跨域迁移）
│   ├── TasksPage.tsx        联邦任务：按场景分块列出任务（任务类型是一列），每块一个"新建联邦任务"；名称搜索、任务类型和状态筛选对所有块生效
│   ├── HorizontalTaskPage.tsx 横向联邦的任务配置页（控制台风格的配置面板 + 右侧配置摘要 + 窄屏吸底操作栏）；校验和预估由后端做
│   ├── TaskPage.tsx         任务详情（task/ 下是概览、进度、产出、配置四个标签）
│   ├── AppsPage.tsx         应用列表：和联邦任务一样按场景分块，任务类型是一列；名称搜索、任务类型筛选
│   ├── AppPage.tsx          应用详情：试用（真实调用，带 / 不带应用对比并判分）、内容、接入（导出 JSON、API）
│   ├── ParticipantsPage.tsx 参与方与数据：按场景分块，每块一张表（一行一份数据集）；概况分区，样本／连接步骤按需展开，签发／复制对应段落，保留新增和删除
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
│   ├── common.tsx           共用组件：Tag、PageHead、Confirm、Toast、Notice、FormActions、Meta、CodeBlock、Collapsible、PanelEmpty、Stat、Facts 等
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

脚本依次：本地检查 → 停下旧进程 → 完整数据备份并下载到 Mac → 同步代码 → 安装依赖、迁移、启动和健康检查。备份失败会重启旧服务并中止部署。`SKIP_CHECKS=1` 跳过本地检查。打开 <http://100.111.198.54:8880/>。

- 所有文件都在服务器的 `~/fedagent-studio` 里（目录布局见 [ARCHITECTURE.md](./ARCHITECTURE.md) §18）；数据在 `data/`，部署不覆盖；
- 访问令牌是可选的，现在关闭：Tailscale 内网里能访问这个地址的人都能使用。要开启时运行 `bash ~/fedagent-studio/serve.sh token on`，令牌保存在服务器的 `~/fedagent-studio/data/admin-token`，浏览器第一次打开时要填；`token off` 关闭。部署不会改变开关；
- 状态、停止、重启：`bash ~/fedagent-studio/serve.sh status | stop | start`；日志在 `~/fedagent-studio/logs/`；
- 进程在退出 SSH 后继续运行，但服务器重启后要重新运行 `bash ~/fedagent-studio/serve.sh`；
- 重启时运行中的任务会停下，重启后从检查点继续，已完成的模型调用不重复计费。
- 部署中的 SSH 操作复用同一条已认证连接，结束后关闭，减少 Tailscale 中继下的握手开销；断连由保活检测中止。
- 前端部署保留旧的带哈希资源，避免已打开页面懒加载图表时遇到 404；`index.html` 更新到新版本。旧资源不自动清理，需要维护时检查磁盘空间。

## 数据备份与恢复（T58）

每次部署前先停止 API 和 runner，再用 SQLite backup API 生成独立的数据库快照，复制整个 `data/`。快照包含 `secret.key`、题库、运行检查点和可选访问令牌；服务运行时拒绝手动完整备份，避免文件与数据库不一致。备份目录权限 700，不进入 Git。

- 服务器：`~/fedagent-studio/backups/<UTC时间>/data/`；Mac：仓库 `.backups/<UTC时间>/data/`。
- 手动备份：依次运行 `bash ~/fedagent-studio/serve.sh stop`、`bash ~/fedagent-studio/serve.sh backup`、`bash ~/fedagent-studio/serve.sh`。手动备份不自动下载，可用 SSH/rsync 另存。
- 恢复：停止服务，选定快照；把当前 `data/` 改名保留，再完整复制快照的 `data/` 为新的 `data/`，不要把旧 WAL 文件混进去；确认后端代码与快照数据库版本兼容，再启动并检查任务、应用及模型连接。
- 必须一起恢复数据库、数据文件和匹配的 `secret.key`；只恢复数据库会无法解密接口密钥。若使用环境变量 `FEDAGENT_SECRET_KEY`，另行保管该密钥。
- 备份不自动清理，不承诺持续定时备份；重要实验结束后应手动备份并下载，定期检查两台机器的磁盘空间。

客户端升级：T58 起提供 `fedagent-client` 0.1.1。旧客户端不能提交新协议的工作结果；停止旧客户端，在原环境使用平台给的安装命令加 `--upgrade`，保持本地状态和数据文件，再运行原连接命令。自写客户端必须把领取结果的 `attempt` 放在 `X-Fedagent-Attempt` 请求头里。

预算限制按已记账费用在工作单元边界检查，不是模型供应商的硬消费限额；在途请求仍可能超出。未填写参与调用的模型单价时不能设置预算。

## 测试约定

当前回归：前端28／后端60。新增test_seed_resources.py覆盖完整数据、样本来源、预检不部分替换、清理保护、级联与幂等；test_client_leases.py验证租约，test_maintenance.py验证完整备份／密钥与并发初始化，test_gateway.py验证跨进程限流和兼容流式回退，test_api.py验证事务、完整题库与执行流程。前端actions.test.ts覆盖旧缓存与请求禁用缓存。

- 前端：
  - `domain/*.test.ts`：草稿的检查和参与方的选择规则、任务状态和显示用的计算、数据集文件检查；
  - `state/*.test.ts`：草稿的 reducer 和路由；
  - 测试用 `src/test/registry.json`（后端注册表的快照）和 `src/test/fixtures.ts`，不连后端。
- 后端（`server/tests/`）：
  - `test_fot_prompts.py`：FoT 的提示词和上游逐字一致（用指纹固定）、经验库条数的几种算法、经验提取量的校准；
  - `test_math.py`：两种判分和数据检查（和前端同一套规则）；
  - `test_gateway.py`：重试、不该重试的错误、费用记账、续跑时从账本取回已完成的调用（不重复计费）、默认接口没配置时的提示、重试用完时带上接口给的原因、接口检查（读模型列表，按插件声明的生成参数逐个模型试）、流式回答的拼接和用量、拒绝流式时改用普通请求、Cloudflare 524 重试、空回答重试、本地客户端的模型调用；
  - `test_units.py`：发给一方的消息按固定顺序读出（和并发完成的先后无关）、过期的尝试不能保存结果、失败的尝试作废账本里的调用；
  - `test_contract.py`：FoT 的契约测试；
  - `test_api.py`：各个接口，以及平台托管和本地客户端混合的完整流程；
  - `test_runner.py`：用真实子进程跑任务，以及 runner 重启后不会同时跑两个进程。
- 页面结构变化时，至少做一次桌面和手机端的浏览器验证（接上本地后端，用假模型跑一遍）：截图、可访问性和断行用 `tools/ui-check/` 里的脚本（见那里的 README）。
- 改了模型调用、编排或部署：部署后在平台上用真实模型跑一次小试跑（每份 1–2 条、2 轮）。
- 界面规范写在 `styles.css` 开头，新增界面前先看一遍（T62 已确认 Braintrust／LangSmith／ElevenAgents 参考，沿用控制台组件；参考与五项设计约定见 [UI-REFERENCES.md](./UI-REFERENCES.md)）：
  - 页面标题一律用 `PageHead`（它同时设置浏览器标题）；新增、编辑是独立的路由和页面（包在 `.form-page` 里），不在列表页上展开表单；
  - 导航和标签动效复用 `useContentMotion`，240ms；只对页面正常子内容淡入／移动 8px，固定底栏、通知、模态独立；标签内容同步入场，底线平滑滑动，禁止给页面加 key 强制重挂载。后台轮询／表单编辑不重播，快速切换取消旧动画。确认与通知入场 150ms；原生 details 开合使用渐进增强，旧浏览器保留直接开合；减少动态时立即完成，不能影响焦点或真实任务状态。回归见 `tools/ui-check/motion.mjs`。
  - 配置区块一律用 `Panel`；新建任务三个固定区域（任务配置含名称／类型／算法、参与方、运行配置）传 `step` 表示序号，不分步隐藏。表单字段一律用 `Field`；普通表单沿用 `FieldGroup` 两栏网格，任务配置（T68／D64）在 `.task-config` 内统一每项一行，桌面名称左、控件右，窄面板上下排；参与方独立表格；
  - 字段名一行写完；可以不填的字段传 `optional`；控件下方不放说明，只有填错时传 `error`；需要解释的字段传 `info`（名称旁的 ⓘ，hover／focus 显示浮层，点按可固定；再次点按／外部／Esc／移走焦点关闭，不重排表单）；单位用 `UnitInput`；
  - 决定任务内容的选择（场景、任务类型、算法、参与方、运行位置、数据集的场景和任务类型）即使只有一个选项，也由用户自己选，不预先选好；只有一个取值、又不需要用户决定的字段（例如只有一个模型）直接显示文字；
  - 不可逆操作使用 `Confirm` 居中模态：保留背景位置、默认取消焦点、Tab／Esc 和焦点恢复；请求中锁定关闭，失败留在对话框内重试，不用 `window.confirm`。创建、保存、发布、删除后用 `showFlash(目标页, 文字)` 显示不占布局的 `Toast`，鼠标停留／键盘聚焦暂停计时；`Notice` 用于持续状态与就地错误；
  - 多段元信息一律交给 `Meta`，不要在字符串里拼" · "；
  - 列表页的分类统一两层：先按场景分块（每个场景一个 `Panel`，规划中的场景标"规划中"，空面板可用 `.panel--planned` 减少占用），任务类型是表格的一列；上方 `.list-toolbar` 放 `SearchInput` 和 `TaskTypeSelect`，对所有场景一起生效，任务／应用无记录时也保留工具栏。新的列表页照这个写，不要用标签页切换场景，也不要把任务类型做成分组标题；
  - 互斥选项用 `Choices`（2–3项直接比较，超过3项自动复用SelectField收起，值类型不变），选项多或次要设置用共享 `SelectField`（Radix Select + 现有 CSS，option 只声明数据，onValueChange 返回字符串；菜单在 Portal 中，支持键盘、长列表、边界避让与有效空值），参与方用复选表格，算法短名称选项配 ⓘ；
  - 标签一律用 `Tag`，折叠一律用 `Collapsible`，代码块一律用 `CodeBlock`；
  - 新建任务“重置配置”紧邻摘要标题，手机仍同排；首次／创建中禁用，修改或恢复后可用；页面级取消移除，统一Confirm取消保留，确认恢复初始配置并清理旧错误，不删除平台记录（T71／D67，覆盖D66左栏底部位置）。
  - 表单底部一律用 `FormActions`：保存按钮不可用时写明还缺什么（和按钮关联，读屏也能听到）；
  - 任务配置算法只显示短名称，完整名称、介绍、交换内容与产出通过独立 ⓘ 查看；注册表驱动，不为 FoT 写死。必要前置／状态继续直接展示；算法参数在“高级配置”。
  - 多模型用 `ModelPicker`：AI Elements ModelSelector 的 Apache-2.0 源码适配（许可证与源 commit 在 `app/src/ui/ai-elements/`），复用 Radix Dialog／cmdk，自动聚焦搜索、按已登记接口分组、回传原引用、关闭恢复触发焦点；单模型直接展示。其他下拉继续 SelectField。不为组件迁移 Next.js／Tailwind／AI SDK。配置回归 `tools/ui-check/config.mjs` 支持本地响应夹具与线上只读验证，禁止业务写入和模型调用。
  - 字号 6 档、字重 3 档、4 为基数的间距。
  - 进度页按轮次和执行位置组织步骤；已完成任务默认展开最后一轮，未执行的时长写明“预计”。发布表单固定所选轮次并核对实际来源；试用结果保留提交时的问题、答案和模型，修改输入后标为“上次对比结果”，不新增历史系统。
  - 优先复用现有组件与 CSS。按需复用已核对的第三方原语或 AI Elements 源码，保留许可证；不为了参考新增无业务需要的功能或迁移整个样式体系。

  - T70任务候选仅显示在线且有兼容、就绪题库的参与方，移除状态列；空态与最低参与方校验保留。任务页总宽900px、左栏600px／摘要280px／间距20px；摘要下移后单栏仍最多600px，手机边距16px。可用性夹具只改浏览器响应，验证失效草稿不计入、无可用项禁止创建；T71允许点击开始定位错误，但不发送创建请求。

T71配置反馈：草稿静默保存／恢复，恢复和复制无顶部Notice，创建错误放开始旁；重置在摘要标题右侧（窄屏同排），页面取消移除，确认中的取消保留。尝试开始后错误原位显示并定位，修正后清除；260ms反馈仅由用户触发，减少动态不播放。开始按钮只在校验中／创建中disabled，data-ready表示实际可创建，自动回归必须等data-ready=true再创建，不能只判断:not(:disabled)。后端校验／create guard保留，回归见task-form.mjs。

T72数学数据：八份原审计题库随仓库保存，共300题；来源／原始哈希见[MATH-DATA](./MATH-DATA.md)与清单。已有库运行`fedagent datasets import-fot-bundle <原包或解压目录>`，先检查八份齐全与题数／格式再统一导入；样本来自真实首条。`fedagent resources remove-demo`仅清理旧空合作方与机构占位文案，实际数据或任务引用存在时拒绝；任务／应用删除用正常API，不删模型接口或调用账本。生产库不保留示例资源，本地客户端测试用浏览器响应夹具。真实验证需显式`REAL_MODEL_VERIFY=1`，不可放入普通UI自动检查。

部署SSH使用`IPQoS=none`并继续可选`SSH_CONTROL_PATH=none`。T72在密钥认证后命令会话超时，数据快照已完成，但服务未启动；使用前者手动`bash ~/fedagent-studio/serve.sh`恢复。发生超时时先检查健康与状态，不能把客户端超时说成部署成功，也不要重复停服覆盖数据。八份数据保存在代码与规范化存储中，旧哈希文件和历史费用账本保留。

第二算法候选EvoMedClaw的固定源码、医疗输入格式、模型与步骤适配以及纵向缺口见[调研](./EVOMEDCLAW.md)。本次尚未登记平台插件，不能把mock验证或异构会诊当成已完成的纵向联邦。

## 提交约定

建议使用简洁的 Conventional Commit：

```text
feat: add transfer scenario algorithm
fix: keep delta column visible on phones
docs: refresh architecture and usage flow
test: cover library publishing
```

任务删除：`DELETE /v1/tasks/{id}` 仅接受已完成或已取消且进程已退出的任务，事务内清理任务和关联结果；响应前提交，随后清理运行目录。独立的已发布应用和调用费用账本保留。`test_api.py` 验证终态限制、进程退出、关联记录清理及删除后应用仍可用；前端回归覆盖旧列表响应不使任务重新出现及拒绝删除时保留数据。
