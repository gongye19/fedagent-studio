# 开发说明

## 环境

- Node.js 20.19+ 或 22.12+
- npm 10+

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
│   ├── taxonomy.ts     场景、算力规格、部署位置、数据类型、模型（注册表）
│   ├── dimensions.ts   7 个维度及 22 个子项：候选、锁定、推荐默认值
│   ├── selection.ts    配置引擎：逐项校验、补推荐值、选择与取消场景
│   ├── plan.ts         FrontendRunPlan、配置清单、资源与耗时预估
│   ├── project.ts      项目、成员与组队规则、开始条件、交付对象、邀请
│   ├── run.ts          Run 生命周期状态机（不含场景分支）
│   ├── simulator.ts    按执行模式生成阶段内容、准入报告、评测报告
│   ├── inputs.ts       数据要求、上传检查、节点交付方式
│   └── demo.ts         示例机构与评测指标（演示数据）
├── state/
│   ├── store.ts        页面状态与 reducer（节点、数据、项目、邀请、配置草稿）
│   ├── seed.ts         体验模式的初始数据
│   ├── simulation.ts   从状态推导待发生的模拟事件并计时派发
│   ├── persistence.ts  浏览器本地保存与恢复
│   └── route.ts        hash 路由
├── ui/
│   ├── WorkbenchPage.tsx   工作台
│   ├── NewProjectPage.tsx  新建项目（配置表单 + 订单摘要 + 手机端订单栏）
│   ├── ConfigForm.tsx      7 个维度的配置表单
│   ├── OrderSummary.tsx    订单摘要
│   ├── ConfigSummary.tsx   只读配置清单（项目配置步骤、邀请页）
│   ├── ProjectPage.tsx     项目详情与七步时间轴
│   ├── ParticipantsStep.tsx 参与要求、成员进度、邀请、组织内部节点、上传
│   ├── NodeBinding.tsx     选择节点和数据（含交付新节点）
│   ├── StageStep.tsx       准入、创建环境、执行、评测视图
│   ├── DeliveryStep.tsx    交付确认
│   ├── InvitationPage.tsx  邀请详情与加入
│   ├── common.tsx / icons.tsx / format.ts / progress.ts / flow.ts
├── App.tsx
├── main.tsx
└── styles.css
```

## 增加一个选项、模型或场景

入口是注册表，组件和状态机不需要改：

1. **新选项**：在 `dimensions.ts` 对应子项的 `candidates` 中加入，并写明适用条件（返回 `null` 表示不适用，`when(choice, 条件)` 表示条件不满足时置灰）；需要推荐值时补 `preferred`。
2. **新模型**：在 `taxonomy.ts` 的 `MODELS` 中加入，声明数据类型、模型族、算力要求（大模型另声明 LoRA / QLoRA 显存）和每轮耗时；`plan.ts` 按模型族推导交换对象和交付物。
3. **新场景**：在 `SCENARIOS` 中加入接入方式、执行模式和执行框架，在 `DATA_TYPES` 和 `MODELS` 中补齐对应条目，并在 `simulator.ts` 为新的执行模式补充执行内容。
4. 在 `inputs.ts` 补充数据要求，在 `demo.ts` 补充示例机构和评测指标。
5. 先确认符合 [DIMENSIONS.md](./DIMENSIONS.md) 的收录原则，并同步更新该文档。
6. 测试会覆盖"每个场景选完即为完整配置、可生成计划、默认参与方能通过准入和评测"；新增的约束规则要单独补测试。
7. 验证桌面、移动端和完整时间轴。

## 接入真实 runner

真实后端不应直接复用前端状态对象。先定义版本化 RunSpec，再实现 adapter：

1. 前端配置提交给 API。
2. API 重新校验并冻结 RunSpec。
3. 编排器根据 `runner.adapter + version` 找到实现。
4. adapter 声明镜像、命令、资源、挂载、网络和超时。
5. runner 只返回标准化事件、输出摘要和退出状态。
6. 评测 runner 通过后，artifact registry 才允许发布。

任何安全能力都必须由服务端验证；前端传入的安全增强只是请求，不能作为能力证明。

## 测试约定

- `domain/*.test.ts`：纯领域规则和状态机。
- `state/*.test.ts`：reducer、初始数据、模拟事件（用 `pendingEvents` 立即执行到稳定）、路由和本地保存。
- UI 发生结构变化时至少做一次桌面和移动端浏览器验证。
- 新增选项或模型必须测试适用条件、置灰规则和推导结果。
- 修改状态机必须测试非法跳转和评测闸门。

## 提交约定

建议使用简洁的 Conventional Commit：

```text
feat: add vertical modeling scenario
fix: align timeline connector
docs: refresh architecture and roadmap
test: cover security enhancement availability
```

