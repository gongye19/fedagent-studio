# 开发说明

## 环境

- Node.js 20.19+ 或 22.12+
- npm 10+
- 以后的后端：Python 3.11+，用 uv 在项目目录内建虚拟环境（`server/.venv`），不全局安装。

```bash
cd app
npm install
npm run dev:demo
```

Demo 固定监听 `127.0.0.1:8880`。普通 Vite 开发模式仍可使用 `npm run dev`。

## 常用命令

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run check
```

`check` 按顺序执行 lint、类型检查、测试和生产构建，提交前应完整通过。

## 代码结构

```text
app/src/
├── domain/
│   ├── catalog.ts      场景、任务类型与算法注册表：每个算法的交换内容和交换量、产出、参数定义与默认值、每轮步骤
│   ├── resources.ts    参与方（两种运行位置）、数据集（登记时选定场景和任务类型）、模型接口，内置示例参与方 A–H 和 8 个题库
│   ├── config.ts       任务配置：默认值、草稿校验、选场景 / 任务类型 / 算法 / 参与方（每方一份数据集）、调用量与费用预估
│   ├── task.ts         任务状态机：创建、按算法的步骤逐轮推进（每一步按结果类型记下结果）、暂停 / 继续 / 取消、指标
│   ├── sample.ts       示例数据：各算法登记的示例运行（产出条目池、每轮产出多少条），以及指标、上传条数、token（确定性生成）
│   └── validate.ts     数据集 JSONL 检查
├── state/
│   ├── store.ts        页面状态与 reducer
│   ├── seed.ts         初始数据：示例参与方、模型接口、已完成的示例任务、正在试跑的任务
│   ├── simulation.ts   有运行中的任务时定时推进
│   ├── persistence.ts  浏览器本地保存与恢复
│   └── route.ts        hash 路由
├── ui/
│   ├── HomePage.tsx         首页：居中的三张场景卡片（可用的点进去新建这个场景的任务）
│   ├── ScenarioArt.tsx      场景卡片上的示意图（横向按行分、纵向按列分、迁移从已有领域到新领域）
│   ├── TasksPage.tsx        联邦任务：按场景分块列出任务，每块一个"新建联邦任务"（名称搜索、状态筛选对所有块生效）
│   ├── HorizontalTaskPage.tsx 横向联邦的任务配置页（控制台风格的配置面板 + 右侧配置摘要 + 窄屏吸底操作栏）；每个场景各有自己的配置页
│   ├── TaskPage.tsx         任务详情（task/ 下是概览、进度、产出、配置四个标签）
│   ├── AppsPage.tsx         应用列表（任务产出发布后的成果）
│   ├── AppPage.tsx          应用详情：试用、内容、接入
│   ├── ParticipantsPage.tsx 参与方与数据：按场景分标签，每个标签一张表（一行一份数据集，任务类型是一列）；详情里有数据集、连接命令、新增和删除
│   ├── NewParticipantPage.tsx 新增参与方（独立页面，同时登记第一份数据集）
│   ├── NewDatasetPage.tsx   新增数据集（独立页面：参与方 → 场景 → 任务类型 → 文件或名称）
│   ├── DatasetFields.tsx / datasetForm.ts 登记数据集的字段和规则（场景、任务类型、在浏览器里检查文件；新增参与方和新增数据集共用）
│   ├── AlgorithmsPage.tsx   算法：按场景分三栏的算法卡片，每栏最后是"待接入"的空位
│   ├── AlgorithmPage.tsx    算法详情：概况、每轮步骤、参数（默认值和说明）、来源
│   ├── ModelsPage.tsx       模型接口列表
│   ├── EndpointPage.tsx     新增、编辑模型接口（独立页面）
│   ├── Chart.tsx            ECharts 封装（按需加载，概览页的哑铃图）
│   ├── OutputGroups.tsx     按类别列出产出里的条目（任务产出和应用内容共用）
│   ├── console.tsx          控制台风格的表单组件：Panel（配置面板）、Field / FieldGroup（字段名在上的表单字段和两栏网格）、UnitInput（带单位的输入框）、Choices（选项按钮组，可以在最后留"待接入"的空位）
│   ├── common.tsx           共用组件：Tag（唯一的标签）、PageHead（同时设置浏览器标题）、Confirm（页面内的确认条）、Notice、FormActions、Meta（分隔点不落在行首行尾）、CodeBlock、Collapsible、PanelEmpty、Stat、Facts 等
│   ├── TaskTable.tsx / labels.ts / format.ts / icons.tsx
├── App.tsx             外框与侧栏导航（四个一级导航；基础管理是可以展开的一组）
├── main.tsx
└── styles.css
```

## 增加一个算法

入口是注册表：

1. 在 `catalog.ts` 的 `ALGORITHMS` 里登记算法：所属场景、适用的任务类型、交换内容（`exchange`）和交换量（`exchangeVolume`：每条样本平均上传几条、最多几条、每条多少 token）、产出（`output`）、参数定义（`params`：键、控件、选项或范围、默认值）、每轮步骤（`stages`，每一步写明在哪一侧、完成后记下什么结果、预估耗时和 token、是否调用模型）、最少参与方和轮次、来源。新建任务的任务类型和算法选择、高级配置、预估、进度页、产出页和算法页都按这些字段生成，不用改页面。
2. 场景从"规划中"改为"可用"（`SCENARIOS` 的 `status`）。
3. 新的任务类型或评分方式，在 `TASK_TYPES`、`GRADERS` 里补充（任务类型决定数据格式和评估指标）；登记在同一场景、同一任务类型下的数据集，就会出现在新建任务的参与方表格里。
4. 参数只在 `params` 里声明，任务配置按键保存取值（`config.params`），不用改配置类型；没有设置的按默认值（`paramsOf`）。
5. `task.ts` 的状态机按任务所选算法的 `stages` 推进，每一步按声明的结果类型（`result`）记下结果，不用改。前端原型的示例运行在 `sample.ts` 的 `DEMO_RUNS` 里为新算法登记（产出条目池、每轮产出多少条）；接入后端后改为读取运行结果。
6. 验证桌面、768 和手机三种宽度，以及从创建到完成的全过程。

## 接入后端

真实后端不直接复用前端状态对象：

1. 前端提交任务草稿，API 重新校验并冻结配置。
2. 任务调度为任务启动引擎进程，进度和结果写入运行目录。
3. 前端改为读 API（用 TanStack Query 轮询运行中的任务），删掉 `domain/sample.ts` 和 `tick` 模拟。
4. 页面、任务状态机和配置校验保持不变。

后端结构、FoT 引擎的拆分方式和参数映射见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 测试约定

- `domain/*.test.ts`：配置校验与预估、题库检查、任务状态机和指标。
- `state/*.test.ts`：reducer、初始数据和路由。
- 示例数据要自洽：例如归类后各类的上传条数之和等于上传总数，后一版产出包含前一版。
- 页面结构变化时，至少做一次桌面和手机端的浏览器验证。
- 界面规范写在 `styles.css` 开头，新增界面前先看一遍（T40 起表单按 AWS 控制台的写法：面板 + 字段名在上的两栏表单 + 选项按钮 + 带单选 / 复选的表格）：
  - 页面标题一律用 `PageHead`（它同时设置浏览器标题）；新增、编辑是独立的路由和页面（包在 `.form-page` 里），不在列表页上展开表单；
  - 配置区块一律用 `Panel`；表单字段一律用 `Field`，放进 `FieldGroup` 的两栏网格，选项按钮组、表格、长文本用 `wide` 占满一行；
  - 字段名一行写完；可以不填的字段传 `optional`；控件下方不放说明，只有填错时传 `error`；需要解释的字段传 `info`（字段名旁的"说明"，点开才显示）；单位用 `UnitInput`；
  - 决定任务内容的选择（场景、任务类型、算法、参与方、运行位置、数据集的场景和任务类型）即使只有一个选项，也由用户自己选，不预先选好；只有一个取值、又不需要用户决定的字段（例如只有一个模型）直接显示文字；
  - 不可逆的操作一律用 `Confirm` 在原地确认，不用 `window.confirm`；创建、保存、发布、删除之后用 `showFlash(目标页, 文字)` 在目标页顶部提示；
  - 多段元信息一律交给 `Meta`，不要在字符串里拼" · "；
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
