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
│   ├── configuration.ts  当前产品配置模型与 9 类工作负载注册表
│   ├── run.ts            通用 Run 状态机
│   ├── scenario.ts       LoRA mock 场景兼容契约
│   ├── compatibility.ts  旧 LoRA 产物兼容规则
│   ├── registry.ts       旧 mock 方法、保护和评测声明
│   ├── repository.ts     演示产物
│   ├── backends.ts       mock runner adapter
│   └── types.ts          旧执行模型共享类型
├── state/store.ts        页面状态、reducer 和模拟执行
├── ui/                   向导、步骤内容、时间轴和基础图标
├── App.tsx
├── main.tsx
└── styles.css
```

## 增加一个工作负载

当前原型的入口是 `domain/configuration.ts`：

1. 增加唯一的 workload id 和名称。
2. 声明允许的数据关系和参与拓扑。
3. 声明策略候选与默认值。
4. 声明方法专属 settings。
5. 给出 runner、evaluation、output、input label 和文件类型。
6. 为默认配置和选项收窄补测试。
7. 验证桌面、移动端和完整时间轴。

组件不应根据 workload id 堆叠专用分支；差异应尽量由注册表驱动。

## 接入真实 runner

真实后端不应直接复用前端状态对象。先定义版本化 RunSpec，再实现 adapter：

1. 前端配置提交给 API。
2. API 重新校验并冻结 RunSpec。
3. 编排器根据 `runner.adapter + version` 找到实现。
4. adapter 声明镜像、命令、资源、挂载、网络和超时。
5. runner 只返回标准化事件、输出摘要和退出状态。
6. 评测 runner 通过后，artifact registry 才允许发布。

任何安全能力都必须由服务端验证；前端传入的 `protectionId` 只是请求，不能作为能力证明。

## 测试约定

- `domain/*.test.ts`：纯领域规则和状态机。
- `state/*.test.ts`：reducer、默认配置和跨步骤行为。
- UI 发生结构变化时至少做一次桌面和移动端浏览器验证。
- 新增工作负载必须测试默认配置合法、候选集合收窄和派生配置正确。
- 修改状态机必须测试非法跳转和评测闸门。

## 提交约定

建议使用简洁的 Conventional Commit：

```text
feat: add vertical modeling workload
fix: align timeline connector
docs: refresh architecture and roadmap
test: cover protection profile resolution
```

