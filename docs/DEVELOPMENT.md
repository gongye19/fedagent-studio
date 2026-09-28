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
│   ├── catalog.ts      场景、任务类型与算法注册表：每个算法的交换内容、产出、参数定义、每轮步骤
│   ├── resources.ts    参与方（两种运行位置）、数据集、模型接口，内置的 8 个题库
│   ├── config.ts       任务配置：默认值、草稿校验、选场景 / 算法 / 数据、调用量与费用预估
│   ├── task.ts         任务状态机：创建、按轮推进 6 步、暂停 / 继续 / 取消、指标
│   ├── sample.ts       示例数据：准确率、trace 数、洞见库、token（确定性生成）
│   └── validate.ts     题库 JSONL 检查
├── state/
│   ├── store.ts        页面状态与 reducer
│   ├── seed.ts         初始数据：示例参与方、模型接口、已完成的示例任务、正在试跑的任务
│   ├── simulation.ts   有运行中的任务时定时推进
│   ├── persistence.ts  浏览器本地保存与恢复
│   └── route.ts        hash 路由
├── ui/
│   ├── HomePage.tsx         首页：场景入口、资源数量、最近任务
│   ├── TasksPage.tsx        联邦任务列表（名称搜索、状态筛选）
│   ├── NewTaskPage.tsx      新建联邦任务（控制台风格的配置面板 + 右侧配置摘要 + 窄屏吸底操作栏）
│   ├── TaskPage.tsx         任务详情（task/ 下是概览、进度、产出、配置四个标签）
│   ├── AppsPage.tsx         应用列表（任务产出发布后的成果）
│   ├── AppPage.tsx          应用详情：试用、内容、接入
│   ├── ParticipantsPage.tsx 参与方与数据、数据集上传
│   ├── AlgorithmsPage.tsx   算法（注册表）
│   ├── ModelsPage.tsx       模型接口
│   ├── Chart.tsx            ECharts 封装（按需加载，概览页的哑铃图）
│   ├── InsightGroups.tsx    按类别列出产出内容（任务产出和应用内容共用）
│   ├── console.tsx          控制台风格的表单组件：Panel（配置面板）、FormRow（左标签表单行）、Choices（选项按钮组）
│   ├── common.tsx           共用组件：Tag（唯一的标签）、Collapsible（折叠）、CodeBlock（带复制）、Notice、FormActions、Meta、PageHead、Stat、Facts 等
│   ├── TaskTable.tsx / labels.ts / format.ts / icons.tsx
├── App.tsx             外框与侧栏导航
├── main.tsx
└── styles.css
```

## 增加一个算法

入口是注册表：

1. 在 `catalog.ts` 的 `ALGORITHMS` 里登记算法：所属场景、适用的任务类型、交换内容（`exchange`）、产出（`output`）、参数定义（`params`）、每轮步骤（`stages`）、是否需要标注、最少参与方和轮次、来源。新建任务的算法表格、高级配置、进度页、产出页和算法页都按这些字段生成，不用改页面。
2. 场景从"规划中"改为"可用"（`SCENARIOS` 的 `status`）。
3. 新的任务类型或评分方式，在 `TASK_TYPES`、`GRADERS` 里补充（任务类型决定数据格式和评估指标）；数据集的 `taskType` 与之匹配后，就会出现在新建任务的参与方表格里。
4. 新参数的取值要存进任务配置：扩展 `config.ts` 的配置类型和默认值，`params` 里的 `key` 对应这个字段。
5. 目前 `task.ts` 的状态机按 FoT 的步骤推进。第二个算法接入时，把状态机的步骤列表也改为从算法定义读取，再补状态机测试。
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
- 示例数据要自洽：例如关系分析各类的 trace 数之和等于上传总数，后一版洞见库包含前一版。
- 页面结构变化时，至少做一次桌面和手机端的浏览器验证。
- 界面规范写在 `styles.css` 开头，新增界面前先看一遍（T39 起按云控制台风格：面板 + 左标签表单行 + 选项按钮 + 带单选 / 复选的表格）：
  - 配置区块一律用 `Panel`，表单行一律用 `FormRow`（左边字段名、右边控件、下方一句说明）；
  - 互斥的少量选项用 `Choices`，选项多或次要设置用下拉，选对象（算法、参与方）用带单选 / 复选的表格；
  - 标签一律用 `Tag`，折叠一律用 `Collapsible`，代码块一律用 `CodeBlock`；
  - 表单底部一律用 `FormActions`：保存按钮不可用时写明还缺什么，保存后用 `Notice` 提示；
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
