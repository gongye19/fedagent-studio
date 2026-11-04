# 开发说明

T105算法规范展示在ui/algorithm/AlgorithmContract与AgentContract；api/algorithmContracts统一读取已有GET /v1/algorithms/{id}/contract。不要另存写死的规范或恢复来源／下载入口。CodeBlock新增scrollable可选属性，默认false；开启时pre可键盘聚焦且最高18rem，完整JSON保持可解析。正文按backend dataContracts、manifest.steps与plans生成，来源元数据不渲染。仅前端改动使用静态资源热更新、先上传哈希文件再原子换index，保留旧文件且不重启任务；无需因文案与展示更改付费重跑算法。

T104新增test_execution_resume／test_medical_parallel：用真实HTTP超时异常、运行恢复及Barrier检验并发重叠，不以耗时阈值写脆弱测试。覆盖已完成学习病例不重跑、坏输出局部作废、长ID分支、服务重启、活动事件／空闲预算、串并行编译一致、原专家提示与排序一致、接口槽位上限和乱序缓存重放。SDK ForkableModel可选，普通Model实现无须增加fork；新医疗协议1.4需重新验证资源，不能伪造准入。部署前确认用户任务结束，备份主库及两个Agent私库，安装SDK0.2.8／医疗包0.3.1并保留费用账本。

T94覆盖T93预检：agents/contract_check与agents/verification负责资源接入的完整合同；checks/connectivity只查连通，无生成／Agent运行。resource_services/verification维护版本凭据；schema0008和生成契约同步。资源页的verifications报告是准入依据，不能在验收后当临时记录删掉；仅清理本轮任务和task-check连接报告。测试先通过intake_helpers走真实本地接入，再验证快速检查；不可用伪造状态绕过准入。前端CheckStatus／CheckRows统一反馈，异步接入完成须刷新共享queryKey候选。

T93覆盖此前场景优先的表单顺序：新建算法→兼容任务，场景由chooseAlgorithm从清单设置，取消算法清空场景和依赖。TasksPage统一目录，ScenarioTag单独维护分类颜色。配置测试的线程安全进度与两路批次调度在checks/progress.py，业务完整性仍在checks/agent；不要在前端伪造进度或通过状态。新增检查并发须验证中途报告可读、不丢结果、失败不启动后续批次、接口别名去重、整体Agent预算和忙碌模型快速返回。schema0007不变，CheckResult新增running状态须重生OpenAPI类型。

T87任务资源必须主动选择；字段空值及取消规则集中在domain/task-config，草稿版本迁移在state/draft。常规Choices／SelectField／ModelPicker只有按需onClear，不改变运行参数等控件语义。新增分类或任务类型须检查取消、切换和后续资源清理；explicit-selection覆盖未来多任务，不在生产登记夹具类型。

T85沿用T84结构规则：结构检查 `uv run --directory server python ../tools/check_structure.py`、`node tools/check-frontend-structure.mjs`。后者进入npm run check，前者进入部署全检查。排查职责和依赖，不为单纯行数拆开同一状态机；生成文件、vendor和历史迁移按原流程维护。T86任务只选择可用资源，资源页负责登记与基础检查；独立共享见resource_services/sharing，组合候选见domain/task-config/agent-groups；旧永久绑定模块已移除，现有resources／gateway／engine及domain/config为兼容出口；普通新增代码进入对应职责模块。

T83：SDK0.2.3／FoT包0.1.3，agent_supported控制新建外部Agent准入，与agent_required一起由注册表描述。FoT数据＋LLM，医疗病例＋Agent；界面顺序为场景→算法→兼容任务。无数据库迁移，历史任务与本地客户端契约保留。`algorithm-config.mjs`覆盖只读选择顺序、切换、资源边界及旧草稿；主动模型验证仍须显式安排。

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
├── shell/             Sidebar（平级导航）、PageRouter、AppStatus（启动／令牌／错误）
├── ui/
│   ├── HomePage.tsx         首页：居中的三张场景卡片（可用的点进去新建这个场景的任务）
│   ├── ScenarioArt.tsx      源码 SVG 关系图（横向协作、纵向互补、跨域迁移）
│   ├── TasksPage.tsx        联邦任务：按场景分块列出任务（任务类型是一列），每块一个"新建联邦任务"；名称搜索、任务类型和状态筛选对所有块生效
│   ├── TaskConfigPage.tsx   组合任务配置面板、摘要、操作栏与资源接入；通用于已支持场景
│   ├── task-config/        useTaskConfig控制草稿／预检／提交；基础、数据、模型、运行、摘要面板只负责对应界面
│   ├── ResourcesPage.tsx / resources/  资源筛选与路由、数据／模型／执行环境及数据详情
│   ├── ResourceIntakeDialog.tsx 接入数据／模型的共用窗口，统一提交锁定、关闭和焦点规则
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
│   ├── task/MetricComparison.tsx  联邦前后结果横条、匹配数与评测分母
│   ├── OutputGroups.tsx     按类别列出产出里的条目（任务产出和应用内容共用）
│   ├── console.tsx          控制台风格的表单组件：Panel、Field / FieldGroup、UnitInput、Choices
│   ├── common.tsx / shared/ 共用展示／表单；反馈、代码块和标签导航分别实现，common保留稳定导出
│   ├── filters.tsx          列表页共用的任务类型筛选
│   ├── TaskTable.tsx / labels.ts / format.ts / icons.tsx
├── test/               测试用的注册表和数据（registry.json 是后端注册表的快照）
├── App.tsx             启动数据与外框组合，导航和页面分发交给shell
├── main.tsx
└── styles.css / styles/ 按原层叠顺序导入主题、外框、组件、页面、响应式、动效、任务配置、资源样式
```

## 增加一个算法

算法是后端的插件，前端不用改：注册表、新建任务的选项、高级配置里的参数、预估、进度页、产出页和算法页都按插件的清单生成。

1. 在 `server/plugins/<名称>/` 建一个包：`pyproject.toml` 里用 entry point 登记（组名 `fedagent.algorithms`），包里放 `manifest.yaml`（角色、每轮步骤、交换通道、产出、评估、参数、轮次）和继承 `fedagent_sdk.Algorithm` 的类，每一步一个方法，用 `@step` 对应到清单。写法见 [ARCHITECTURE.md](./ARCHITECTURE.md) §4，FoT 插件（`server/plugins/fot`）是完整的例子。
2. 把包加进 `server/pyproject.toml` 的 workspace 成员和依赖，运行 `uv sync`。
3. 运行 `uv run fedagent contract <算法 id>` 和 `uv run pytest`。契约测试通过，说明数据流向和清单一致、可以续跑。
4. 新的任务类型或判分方式同样是插件（组名 `fedagent.task_types`、`fedagent.graders`），数学推理在 `server/plugins/math_reasoning`。
5. 新场景的第一个算法：场景从"规划中"改为"可用"（`server/fedagent/registry.py` 的 `SCENARIOS`），再按 §6 做这个场景的配置页。
6. 前端运行 `npm run api:types`（接口有变化时），验证桌面、768 和手机三种宽度，以及从创建到完成的全过程。

## GitHub 协作与部署到实验室服务器（T107）

私有仓库：[gongye19/fedagent-studio](https://github.com/gongye19/fedagent-studio)。`main` 是部署分支；开发使用功能分支和 Pull Request 合并到 main，保留已有提交历史，不强制推送。协作者在仓库 Settings → Collaborators 中邀请，获得权限后使用自己的 GitHub 认证克隆；服务器密钥不用于个人开发。

```bash
git clone git@github.com:gongye19/fedagent-studio.git
cd fedagent-studio
git switch -c feat/your-change
# 修改、检查、提交后推送功能分支，发起 PR 合并到 main

git switch main
git pull --ff-only origin main
bash deploy/deploy.sh
```

部署脚本要求干净的 main；默认执行前后端检查，然后推送 GitHub。服务器只获取 main 的相同完整提交号，拒绝部署过期提交；不会上传本机工作区的源码、构建产物或未提交文件。`SKIP_CHECKS=1` 仅用于同一提交已经完整检查的情况，不能跳过干净工作区、main 和远端提交校验。

服务器从 GitHub 导出该提交到独立构建目录，执行 `npm ci`／前端构建、锁定的 Python 运行依赖准备及客户端安装包构建；构建成功后再次确认没有运行或排队任务／连接检查，再停止服务、完整备份数据及旧程序、发布、启动和健康检查。阶段变更不重启用户正在运行的任务；暂停任务保持原状。构建失败时旧服务继续运行；发布失败且数据库版本未变化时恢复上一版程序。数据库版本已变化时保持停止，按备份恢复说明处理，不自动覆盖数据。

- 实验室服务器：`100.111.198.54`，网页 <http://100.111.198.54:8880/>，SSH端口10022、用户poly-zhu，均需Tailscale内网及服务器访问权限。
- 运行目录：`~/fedagent-studio/`。`repository.git/` 是GitHub只读镜像；`builds/<提交号>.*` 保存精确源码与产物；`run/deployed-revision` 是已通过健康检查的提交号。
- GitHub部署凭据：`access/github_ed25519` 是服务器生成的专用只读密钥，私钥不离开服务器。GitHub主机公钥从官方meta API登记在`access/github_known_hosts`，使用SSH over 443；不关闭主机校验，不用个人GitHub令牌。
- 首次配置：服务器生成上述专用密钥，将`.pub`登记为该仓库只读Deploy key；写入官方GitHub主机公钥，再以相同`GIT_SSH_COMMAND`将仓库`git clone --bare`到`repository.git`。本次已完成，不重复生成或覆盖凭据。
- 运行数据、密文及解密密钥只留在`data/`；`access/`、数据、备份、缓存和构建目录不进入仓库。部署锁防止多人同时发布，部署不会更改访问令牌开关。
- 数据备份及`runtime.tar.gz`（旧程序）保存到`backups/<UTC时间>/`；本机脚本部署成功后将备份下载到`.backups/`。若下载失败，服务器上的新版本和备份仍保留，需要补下载，不要重新覆盖数据。
- 前端保留旧哈希资源，已打开页面可继续懒加载。`run/deployed-revision`只在新版本健康后更新；不自动清理旧构建和备份。
- 状态、停止、启动：`bash ~/fedagent-studio/serve.sh status | stop | start`；日志在`logs/`。重启服务器后仍需手动运行serve.sh；没有新增自动开机或定时部署。

源码必须经过GitHub；目前是手动运行部署命令，不是每次push就自动发布。GitHub权限与服务器权限分别管理，能提交PR不代表能操作生产服务器。

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
  - 决定任务内容的选择（场景、任务类型、算法、参与方、运行位置、数据集的场景和任务类型）即使只有一个选项，也由用户自己选，不预先选好；T77按用户修正，模型即使只有一个也必须能打开选择，不能替换为静态文字；
  - 不可逆操作使用 `Confirm` 居中模态：保留背景位置、默认取消焦点、Tab／Esc 和焦点恢复；请求中锁定关闭，失败留在对话框内重试，不用 `window.confirm`。创建、保存、发布、删除后用 `showFlash(目标页, 文字)` 显示不占布局的 `Toast`，鼠标停留／键盘聚焦暂停计时；`Notice` 用于持续状态与就地错误；
  - 多段元信息一律交给 `Meta`，不要在字符串里拼" · "；
  - 列表页的分类统一两层：先按场景分块（每个场景一个 `Panel`，规划中的场景标"规划中"，空面板可用 `.panel--planned` 减少占用），任务类型是表格的一列；上方 `.list-toolbar` 放 `SearchInput` 和 `TaskTypeSelect`，对所有场景一起生效，任务／应用无记录时也保留工具栏。新的列表页照这个写，不要用标签页切换场景，也不要把任务类型做成分组标题；
  - 互斥选项用 `Choices`（2–3项直接比较，超过3项自动复用SelectField收起，值类型不变），选项多或次要设置用共享 `SelectField`（Radix Select + 现有 CSS，option 只声明数据，onValueChange 返回字符串；菜单在 Portal 中，支持键盘、长列表、边界避让与有效空值），参与方用复选表格，算法短名称选项配 ⓘ；
  - 标签一律用 `Tag`，折叠一律用 `Collapsible`，代码块一律用 `CodeBlock`；
  - 新建任务“重置配置”紧邻摘要标题，手机仍同排；首次／创建中禁用，修改或恢复后可用；页面级取消移除，统一Confirm取消保留，确认恢复初始配置并清理旧错误，不删除平台记录（T71／D67，覆盖D66左栏底部位置）。
  - 表单底部一律用 `FormActions`：保存按钮不可用时写明还缺什么（和按钮关联，读屏也能听到）；
  - 任务配置算法只显示短名称，完整名称、介绍、交换内容与产出通过独立 ⓘ 查看；注册表驱动，不为 FoT 写死。必要前置／状态继续直接展示；算法参数在“高级配置”。
  - 新建任务统一用 `ModelPicker`，一个模型也可展开：AI Elements ModelSelector 的 Apache-2.0源码适配（许可证与源commit在 `app/src/ui/ai-elements/`），复用Radix Dialog／cmdk，聚焦搜索、按已登记接口分组、回传原引用、关闭恢复焦点。应用试用模型统一SelectField；没有可用接口时禁用并保留配置入口。其他下拉继续SelectField。不迁移技术栈；配置回归禁止业务写入和模型调用。
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

T76任务配置密度：沿用“选择任务类型→算法→参与方→运行”的流程和真实状态，少量选项按内容宽度排列，待接入占位只显示一次。布局为112px标签栏／16px栏间距与行距／16px面板内边距，普通与高级配置共用轴线；桌面选项约36px，手机触控44px，长字段名均衡折行。复用Choices、原生单选、InfoTip和Panel，不新增依赖。验收检查初始／数学／医疗、选中／禁用、浮层／键盘／重置、320至1280宽度和无业务写入；常规适配无需重新寻找主参考。

## T78 任务内资源接入

流程与五项设计交付物见FLOW开头。沿用已有参考与组件，无新增依赖；ResourceDialog复用Radix焦点管理并明确恢复外部触发按钮，保存中禁止关闭。嵌套Select与InfoTip门户层分别160／170，接入／模型对话框140／141，避免下拉被遮挡；原生Confirm仍使用浏览器顶层。资源窗口单列／可滚动，任务页继续112px标签栏、16px间距与600px左栏。

后端接口新增后运行`npm run api:types`；资源scope迁移不能误公开其他上传。通用接入使用`createDataResource`，保存后刷新datasets/participants；删除使用专用资源API，不走旧“最后一份要删参与方”的路径。模型保存复用既有EndpointForm与加密写入协议，AI不得代填用户模型密钥。

本地完整回归：仓库根目录`node tools/ui-check/resource-flow.mjs`，隔离数据目录与假模型；真实验证只有明确安排且`REAL_MODEL_VERIFY=1 BASE=http://100.111.198.54:8880/`才允许。使用仓库真实AIME24前两题作为临时输入，不生成演示题；试跑每份1题／2轮，仅清理本次创建的任务、应用、数据和空托管来源，保留原有全部ID。医疗兼容回归使用medical-flow.mjs。新流程覆盖通用入口、原位错误、模态内菜单、上传／自动选择、跨范围保留、正式输入、重置、焦点、窄屏、模型保存与完整成果使用。config.mjs同步资源空态／场景入口／数据说明的焦点变化，继续覆盖只读几何、提示、模型、重置与失效草稿；公共lib的全选先显式切换公用范围。

## T79 模块边界与维护方式

导航不再有基础管理父目录；T80将我的／公用资源合并为“资源”，当前六项直接显示，手机只折叠整个菜单。资源页内切换归属，旧地址仍可访问。App只组合启动数据、路由与外框，shell持有导航和页面分发，页面自己的交互状态留在页面模块。

任务配置的即时规则在domain/config；useTaskConfig负责草稿、后端预检、费用、创建和重置；task-config的各面板负责各自控件。数据候选统一按就绪、资源归属、任务类型和本地插件版本筛选，表格与校验共享规则；未知插件错误字段保留在高级配置原位显示。任务入口只组合面板和确认窗口，不再混入几百行控件实现。ResourcesPage负责筛选与切换，resources分别维护数据、详情、模型、执行环境；任务与资源页复用同一ResourceIntakeDialog。

后端路由只适配HTTP请求／响应，认证与事务集中在http/dependencies。任务预检、写操作和界面投影分开；核心服务抛ServiceError，由应用工厂映射原状态码和detail，不依赖FastAPI。schemas按领域组织，稳定导出保持旧调用方兼容。test_api_contract完整比较当前OpenAPI与前端生成快照，内部重组不能悄悄破坏已有接口；公开协议确有改动时更新快照和类型。

跨端契约检查在完整仓库运行；只分发server的独立部署跳过这一项，其他后端测试照常运行。完整仓库存在app但缺失快照时仍报错，不把漏生成视为正常跳过。

styles.css只维护导入顺序，不再堆入页面细节。新增业务改对应样式模块，主题／公共组件／响应式／动效规则保持集中；避免复制相同规则到多个页面。以职责内聚为拆分依据，不机械规定行数；Engine和Gateway仍分别承载编排和网关的完整职责。生成接口文件与固定上游vendor源码保留来源和生成流程，不手工拆分。新增功能先进入对应领域模块，入口文件只负责组合，不持续叠补丁。


### T81 Agent 适配维护

数据／LLM／Agent独立入口，共用ResourceScope／ResourceDialog；普通上传不再选择客户端，旧客户端接口与记录保留。协议见AGENT-API，新增算法须声明参与方步骤并实现相同输入输出适配，不能将任意聊天接口登记成可联邦Agent。Agent返回值必须经过adapter能力检查，判分留在平台；SDK0.2.1的labels_allowed在平台和客户端0.1.3中一致执行，让医疗eval标注在学习步骤仍不外发。

配置测试由checks模块持久化、有限后台检查；禁止在页面编辑、自动刷新、恢复或能力读取时隐式调用模型。外部服务请求的超时保持原运行编号，429等待同一编号；报告失效后创建拒绝。检查接口会尝试同步已暂停／取消任务、结束测试遗留的停止确认，不停止活动执行；未确认停止时不删除接口或任务，以免丢失追踪。

回归：uv run pytest（含独立参考服务进程、两插件两轮、凭据、输出边界、重提、停止与过期）；本地先启动独立agent-serve，再在仓库根目录node tools/ui-check/agent-flow.mjs，输入采用真实题库与公开MedQA；真实模型要显式REAL_MODEL_VERIFY=1。脚本只清理owned.json记录的资源，账本保留。前端默认无新依赖，不为Agent接口迁移框架；生成类型用npm run api:types。

## T82：独立医疗系统与接入检查

普通改动继续复用reference-first-ui已确认的T62／64／67／68参考。本次只复用现有字段和菜单，将按数据指定Agent移入资源区，未加新组件或依赖。SDK更新至0.2.2，FoT包0.1.2、医疗包0.1.1；安装方需同步SDK新契约，算法业务版本保持原值。

本地开发平台可用独立FEDAGENT_DATA_DIR；分别启动两个medical-serve，明确FEDAGENT_FAKE_ENDPOINT=1且--platform-model fake:fake，各用独立目录和端口9031／9032。运行tools/ui-check/medical-agents.mjs验证FoT原生路径＋双医疗API路径，支持ONLY_ALGORITHM补测单条流程。完整HTTP调用不是任意聊天接口，下载/v1/agent-protocol可看输出JSON Schema与数据模板；空模板须填写后才可上传，不创建样本资源。

测试策略：server/tests/test_medical_agents.py覆盖各步骤缺输出、医疗LLM绕过拒绝、原API经验启用／提示命中／关闭／范围隔离／重启、独立提供者数据库和完整OpenAI兼容请求、重复JSON字段拒绝且不落库；既有两算法／Agent幂等和故障恢复保留。内部SDK run_contract用独立Registry及实例级清单验证本方代码，生产Agent准入规则不因此放宽。备份测试覆盖四个服务以及嵌套提供者数据库。

MEDICAL_AGENT_TOKEN可由接入方在服务环境中配置Bearer鉴权；平台登记同一密钥。团队同机进程仅监听回环且不设置此项，SSH回环转发只用于此次验证，不对公网开放。真实医疗调用可能因问诊未收敛失败或暂停；检查不是效果保证，不能悄悄把失败替换成成功。

T82真实检查发现默认6回合下病例未形成最终诊断，正式任务被拦截。补充error_code安全映射，使用户得到问诊上限／模型连接／输出规范的修正建议，远程自由错误不直接显示；预检确认首个失败后不继续发出付费请求，并保留报告待主动重测。医疗重测采用12回合，未跳过诊断和经验输出校验。浏览器验证脚本现在在提交后立即记录报告ID、失败立即退出，避免等到成功按钮超时或遗漏失败报告。

最终真实验证与限制见T82／HANDOFF：新病例未收敛不能隐去，两个原API的功能核对使用各自任务留出病例。加载版本与检索命中分开记录；小样本不能证明诊断提升。医疗默认上限现为12，服务与任务可在4–12内配置。

## 算法架构流程图（T89）

- `npm --prefix app run diagrams:build`：从tools/algorithm-diagrams/build.py生成四个独立HTML和尺寸／哈希清单。
- `npm --prefix app run diagrams:check`：只检查生成文件没有过期；npm run build的prebuild自动执行。不需要Chrome、ffmpeg、模型或额外Python包。
- 不直接修改public下的生成HTML；渲染模板原样保留，播放适配写controller.js。新算法补配置与ui/algorithm/guides.ts，通用页面不写算法条件分支。
- 图形检查先确认iframe非零尺寸，再查看其`#stage[data-layout-problems]`（来自上游DOM检查）；桌面1280／手机390均应为空。浏览器实际核对暂停／恢复、键盘details、无横向溢出和加载状态，配合离线controller.test.ts验证消息来源、离屏／后台、减少动态与零尺寸保护。
- live-panel原脚本会直接启动Chrome；本次通过当前会话的浏览器工具实际检查页面及相同DOM检查器，没有宣称执行120帧／MP4导出检查。图只做说明，不能接入真实任务状态或显示无来源的指标。

T90密度验收增加1280×720：默认收起所有说明后，整图下边缘须在720px以内；手机只要求清晰、无横向溢出，不要求一屏。修改布局时同步生成四个HTML，iframe用清单哈希标识版本。纯静态前端发布先同步资源再更新index，保留旧哈希文件；不需要重启四个业务服务或重复付费模型调用。

T91起新增详情／新增／编辑等下级页必须给PageHead传back（label、route），不要只放细小面包屑或使用history.back。目标由页面上下文决定；任务来源表单复用backTo，资源目录保留space。桌面／手机检查返回目标、Enter激活与点击尺寸，并覆盖直接深链和对象不存在；顶级页不传back。原a11y脚本移除已退役crumbs点击尺寸例外；本次浏览器通过会话工具实际检查，不运行直接控制Chrome的旧脚本。

T92覆盖位置：PageHead返回在标题左侧同行，以aria-label及title标明目标，禁止再加独立顶部返回行。三类资源复用ResourceTable，空提示必须在tbody跨列行；新资源页不要复制一套空表分支。验收我的／共享和空／有数据、1280／1024／768／390布局，确认表头→空态及归属→表格的顺序；手机保留现有卡片响应式。普通UI更新不重复付费任务试跑。


### T96 算法接入维护

新增算法先补manifest、任务类型合同和agent_output_contract，再实现本站步骤与中心聚合；复用现有四接口，不为算法增加平台核心分支。private_state声明服务本地中间状态，公开输出必须纯校验；不要把完整轨迹塞进reports或logs绕过边界。plan可按轮次变化，TaskOut冻结stages／plan，进度组件使用stagesOf(task, round)。SDK0.2.4、EvoMed包0.2.0／协议1.1.0；新增能力须更新安装包、规范、OpenAPI和验证凭据。

任务最少两方不意味着资源接入需要两方；验证单方能力后可与共享资源组合。新增医疗执行路径必须测eval答案隔离、本站轨迹不回传、加载版本拒错、最后成果确实被评测，以及旧1.0.0结果展示。UI沿用现有参考，规范折叠呈现，下载走api统一鉴权与原位错误反馈。

T98判分扩展：确定性判分继续实现grade；需要模型时设置requires_model并实现evaluate，失败必须抛ModelError或业务错误，禁止把无响应当答错。模型通过网关提供，不在插件读密钥；注册表需暴露模型需求，任务连接检查保持只读探测。TaskType.is_evaluated用于任务分母，上传标注计数仍用is_labeled。规则语义变更使用新grader ID及算法版本，旧结果不重算。医疗源码在grading.py，原版函数不修改，网络重试由平台管理；回归见test_medical_grading.py。学习／判分有明确读取标注的授权，不能放宽诊断请求或联邦产出的标注隔离。

T99收尾：备份须先停止四项服务（无活动任务／验证），所有SQLite库均通过backup API生成不依赖WAL／SHM的独立快照；普通文件及密钥一起保存，逐库校验。不能只对主库做快照、再把接入方原文件当独立数据库。ProgressStore连接显式closing，读写事务结束及时释放。

### T100：简洁进度与案例记录

ProgressTab只组合已有Task.cursor／冻结plan和ProgressBar／CheckStatus，不读取通信或多层动作。CaseResults使用管理API GET /tasks/{id}/cases，按round／site／outcome筛选、offset／limit分页；schema变更后仍运行npm run api:types。案例由UnitExecutor完成独立判分后生成去标注预览，与store_result所有权／attempt门禁同事务写入Reports(case_result)。保留名不得由Agent或旧客户端上报；只允许管理侧读取参考标注，不将结果记录作为Agent输入。历史数据不回填或重评。TaskOut轮询明确排除case_result长正文，避免每次进度查询加载完整回答。新增用例在test_cases.py、check-state.test.ts和ProgressTab.test.tsx。

### T101：阶段状态及纯前端发布

不使用异构单元数或阶段权重推算任务百分比；ProgressBar／progressOf／stageSeconds已删除。stagesOf和stepState只决定阶段顺序与状态，成绩指标不受影响。T107起纯前端修改也必须先推送GitHub，再按统一部署流程更新，不能再从本机直接上传dist；保留旧哈希资源。此类验证只读观察已有任务、配合状态回归，无模型或编排改动时不自动追加付费试跑。

T102固定对照：新医疗三组无经验／本地经验／联邦经验，内部rounds=3但不显示用户轮次控件。按冻结labels展示，不写算法ID判断；FoT原多轮不变。修改私有状态时检查同任务／站点／样本／组边界、清理验证临时状态，不能把轨迹或原卡库加入公开结果。平台上传病例及同机模型账本的现有边界如实说明。新增测试test_medical_comparison.py覆盖只学习一次、三组配对、跨病例检索、摘要／来源拒绝及旧任务；EvaluationOverview.test.tsx覆盖增益和缺失组。浏览器使用cua_repl，历史tools/ui-check的CDP脚本不作为本次实际执行证明。修改插件后准入必须真实复验；最终状态见HANDOFF。

T103数值编辑：不要在onChange强制套下限或旧值，编辑草稿可空，提交配置须整数；上限来自所选数据，服务端也校验。异步数据保留区域位置，验证清空、输入、请求返回时的焦点与坐标，不靠保存scrollY掩盖布局问题。结果图只绘各方实际值与普通颜色图例，不恢复平均系列或选择状态。
