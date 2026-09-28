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
│   ├── catalog.ts      场景与算法注册表、FoT 的 6 步、任务类型与评分方式
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
│   ├── TasksPage.tsx        联邦任务（首页；没有任务时显示使用流程）
│   ├── NewTaskPage.tsx      新建联邦任务（选项卡片 + 右侧配置清单 + 手机端操作栏）
│   ├── TaskPage.tsx         任务详情（task/ 下是结果、进度、洞见库、配置四个标签）
│   ├── LibrariesPage.tsx    已发布的洞见库
│   ├── LibraryPage.tsx      洞见库详情：洞见、试用、接入方式
│   ├── ParticipantsPage.tsx 参与方与数据、题库上传
│   ├── ModelsPage.tsx       模型接口
│   ├── Chart.tsx            ECharts 封装（按需加载，结果页的哑铃图）
│   ├── InsightGroups.tsx    按类别列出洞见（任务详情和洞见库页共用）
│   ├── OptionCard.tsx       可点击的选项卡片（新建任务、新增参与方共用）
│   ├── TaskTable.tsx / common.tsx / labels.ts / format.ts / icons.tsx
├── App.tsx             外框与侧栏导航
├── main.tsx
└── styles.css
```

## 增加一个算法

入口是注册表：

1. 在 `catalog.ts` 的 `ALGORITHMS` 里登记算法：所属场景、参与方步骤和服务端步骤、适用的任务类型、是否需要标准答案、最少参与方和轮次、来源。
2. 场景从"规划中"改为"可用"（`SCENARIOS` 的 `status`）。
3. 新的任务类型或评分方式，在 `TASK_TYPES`、`GRADERS` 里补充；数据集的 `taskType` 与之匹配后，就会出现在新建任务的数据列表里。
4. 算法参数有差异时，扩展 `config.ts` 的配置类型和默认值，并在"运行设置"里加对应的控件。
5. 目前 `task.ts` 按 FoT 的 6 步推进。第二个算法接入时，把步骤列表改为从算法定义读取，再补状态机测试。
6. 验证桌面和手机端，以及从创建到完成的全过程。

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
- 界面规范写在 `styles.css` 开头：字号 6 档、字重 3 档、4 为基数的间距；区块之间靠留白，不给每块套边框；让用户挑选的内容一律用 `OptionCard` 选项卡片，不在正文里夹单选圆点或胶囊；状态胶囊只用于需要注意的状态。

## 提交约定

建议使用简洁的 Conventional Commit：

```text
feat: add transfer scenario algorithm
fix: keep delta column visible on phones
docs: refresh architecture and usage flow
test: cover library publishing
```
