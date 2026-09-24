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
│   ├── taxonomy.ts     维度候选项、8 个场景模板、策略、保护预设（注册表）
│   ├── selection.ts    逐层选择引擎：适用性、可见性、候选与原因、自动选中、下游清理
│   ├── plan.ts         由选择推导 FrontendRunPlan 和实时预览
│   ├── run.ts          Run 生命周期状态机（不含场景分支）
│   ├── simulator.ts    按执行模式生成阶段内容、准入报告、评测报告
│   ├── inputs.ts       数据契约与上传检查
│   └── demo.ts         已登记的联邦数据目录和评测指标（演示数据）
├── state/
│   ├── store.ts            页面状态与 reducer
│   └── useRunSimulation.ts 按演示时长推进 Run
├── ui/
│   ├── ConfigurationStep.tsx  维度 1 场景卡片（含子项）、维度 2–4 卡片
│   ├── InputsStep.tsx         数据要求、匹配数据、上传检查、运行设置
│   ├── StageStep.tsx          准入、沙箱、执行、评测视图
│   ├── PublishStep.tsx        发布范围与确认
│   ├── RunPanel.tsx           时间轴与平台推导面板
│   ├── common.tsx             通用展示组件
│   └── flow.ts                七步时间轴定义
├── App.tsx
├── main.tsx
└── styles.css
```

## 增加一个场景模板或策略

入口是 `domain/taxonomy.ts`，组件和状态机不需要改：

1. 在 `SCENARIOS` 增加场景：`matches`（子项 1.1–1.6 的路径）、`shortcut`、`pattern`、`input`、`evaluation`、`output`、`minParticipants`、`params`。
2. 如果路径需要新的维度取值，在对应候选列表中增加，并在 `selection.ts` 中补充适用规则。
3. 先确认符合 [DIMENSIONS.md](./DIMENSIONS.md) 的收录原则（主流，或大模型 / Agent 相关），再在 `STRATEGIES` 增加策略：标注（`mainstream` / `frontier`）、计算类型、联邦对象、runner、参考实现，以及需要的模型类别 / 数据关系 / 各方投入。
4. 在 `inputs.ts` 补充数据契约，在 `demo.ts` 补充已登记的联邦数据（用 `when` 标明适用的子项）和评测指标。
5. 测试会自动覆盖"每个模板可到达、可生成计划、能通过默认准入和评测"；新增的约束规则要单独补测试。
6. 同步更新 [DIMENSIONS.md](./DIMENSIONS.md)。
7. 验证桌面、移动端和完整时间轴。

## 接入真实 runner

真实后端不应直接复用前端状态对象。先定义版本化 RunSpec，再实现 adapter：

1. 前端配置提交给 API。
2. API 重新校验并冻结 RunSpec。
3. 编排器根据 `runner.adapter + version` 找到实现。
4. adapter 声明镜像、命令、资源、挂载、网络和超时。
5. runner 只返回标准化事件、输出摘要和退出状态。
6. 评测 runner 通过后，artifact registry 才允许发布。

任何安全能力都必须由服务端验证；前端传入的保护预设只是请求，不能作为能力证明。

## 测试约定

- `domain/*.test.ts`：纯领域规则和状态机。
- `state/*.test.ts`：reducer、默认配置和跨步骤行为。
- UI 发生结构变化时至少做一次桌面和移动端浏览器验证。
- 新增场景或策略必须测试路径可到达、候选集合收窄和推导结果正确。
- 修改状态机必须测试非法跳转和评测闸门。

## 提交约定

建议使用简洁的 Conventional Commit：

```text
feat: add vertical modeling scenario
fix: align timeline connector
docs: refresh architecture and roadmap
test: cover protection profile resolution
```

