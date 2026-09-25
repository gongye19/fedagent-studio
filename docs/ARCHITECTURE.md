# 系统架构

最后复核：2026-09-25（T26）

## 架构原则

Federation Studio 采用"统一控制面 + 可替换执行后端"。平台不把所有联邦方法抽象成同一种算法，而是统一它们共同拥有的生命周期：配置、输入接入、准入、运行、评测和发布。场景之间的差别落在执行模式和 runner adapter 上。

```text
User
  │ 选择 3 个维度（维度 1 场景含 6 个子项）
  ▼
L1 展示层 ──► L2 维度注册表 ──► L3 选择与兼容引擎
                                      │
                                      ▼
                              FrontendRunPlan（后端为 RunSpec）
                                      │
                                      ▼
                        L4 Run 编排 / 状态机 + 按执行模式模拟
                         │           │            │
                         ▼           ▼            ▼
                    Agent 准入     沙箱        独立评测
                         └──── L5 Runner adapter ────┘
                                      │
                                      ▼
                         L6 产物、谱系与审计存储
```

## 分层

### L1 展示与交互层

位置：`app/src/App.tsx`、`app/src/ui/`、`app/src/styles.css`

- 左侧显示当前步骤，右侧显示可点击时间轴和"平台推导"面板。
- 数据接入步骤展示数据要求，并按运行方式分两种：节点类场景勾选已连接的节点、给出我方节点启动命令；文件类场景勾选已提交的文件、展示上传结果（逐项检查与 Agent 说明）。有上传未通过或节点连接中时不能开始。
- 配置步骤的所有维度和候选项始终展开。维度 1（场景）一张卡片：场景按运行方式分两组，下面是子项 1.1 模型类别、1.2 共享方式（各自是独立圆角卡片，未选场景时置灰，选了不需要子项的场景时不显示）；维度 2 协作策略、维度 3 安全与隐私各自一张卡片（安全卡片分内置保护和可选增强）；选定场景后策略只列该场景的，未选场景时按场景分组列出全部。界面文案统一中文；手机端顶部显示步骤进度，操作栏吸底。标题不重复编号。已选选项再点一次即取消（子项除外）。
- 上游未选或与上游不兼容的选项置灰，不显示原因文字；只剩一个选项时显示"自动选中"。不显示成熟度、前沿或参考实现标注。
- 组件只渲染领域层给出的选项、原因和推导结果，不复制兼容规则。

状态：已实现前端原型。

### L2 维度注册表

位置：`app/src/domain/taxonomy.ts`

- 声明各维度的候选项：场景子项（模型类别、共享方式）、协作策略、安全增强。
- 声明 4 个场景：默认子项、执行模式、接入方式（节点 / 文件）、评测、输出、最少参与方、运行默认值（不在界面展示）。
- demo 阶段只收录最通用的方法和 Agent / 大模型相关方法；每条策略声明计算类型、联邦对象、runner、参考开源实现、协议内置保护、runner 提供的可选增强和适用条件。
- 声明基础保护（mTLS、隔离沙箱、审计日志）和 2 种可选增强（SecAgg+、差分隐私）。

状态：已实现静态注册表。后续应从版本化服务端 schema 加载。

### L3 选择与兼容引擎

位置：`app/src/domain/selection.ts`、`app/src/domain/plan.ts`

- 判断维度是否适用、有哪些可选项及不可用原因；`displayOptions` 给界面提供完整候选列表和可用状态；`toggle` 处理再点一次取消，`canDeselect` 判断子项不能取消；`exchangedFor` 推导联邦对象（LoRA 时为 LoRA 增量）；`builtinProtection` / `enhancementOptions` / `toggleEnhancement` 处理维度 3。
- 改选后从上到下重新校验：清空失效选择、自动选中唯一可选项、补齐运行默认值。
- 数据契约与上传检查：`inputs.ts` 按场景和子项声明数据要求；文件类场景的 `checkUpload` 对浏览器本地抽样的文件内容做确定性检查，输出逐项结果和 Agent 说明；`NODE_SETUP` 给出节点类场景的启动命令。`demo.ts` 按场景和子项匹配平台上已有的参与方（已连接的节点 / 已提交的文件）。
- 场景是选择的根：`Selection.scenario` 由用户直接选择，子项和策略都在场景之内校验。
- 维度全部答完后生成不可变的 `FrontendRunPlan`：场景、路径、策略、执行模式、联邦对象、计算类型、保护机制、runner、输入接入、执行位置、评测、输出、是否前沿、提示。
- 后端阶段由 policy service 重新校验，前端结果只是请求，不是能力证明。

状态：前端已实现；服务端 policy service 未实现。

### L4 Run 编排层

位置：`app/src/domain/run.ts`、`app/src/domain/simulator.ts`、`app/src/state/`

- 状态机：`preflight → provision → execute → evaluate` 自动推进，`publish` 需要用户确认发布范围。
- 准入不通过不能创建沙箱；评测未通过不能发布；Run 开始后冻结计划和参与方。
- 模拟器按执行模式（多轮联邦、单轮聚合、纵向协议、产物处理、查询时联邦、纯评测）生成每个阶段的内容，并给出真实耗时预估。
- `useRunSimulation` 只负责计时和派发，编排规则都在领域层。

状态：前端状态机和按执行模式模拟已实现；服务端编排未实现。

### L5 Runner adapter 层

目标实现：`runners/` 独立服务或 worker 包。

- 将 RunSpec 翻译为镜像、命令、资源、挂载、网络策略和超时。
- 对接 Flower（横向训练：平台运行 SuperLink + ServerApp，各方运行 SuperNode + ClientApp）、NVFlare（纵向训练），以及平台自带的统计服务和记忆合并器。
- runner 使用短期凭据，只读挂载输入，只写指定输出位置。

状态：未实现。前端只展示策略声明的 runner 和参考实现。

### L6 基础设施与持久化层

目标组件：API、关系数据库、对象存储、任务队列、容器调度、日志和密钥服务。

- 保存用户、项目、配置版本、Run、manifest、报告和产物谱系。
- 启动短生命周期容器或微虚拟机，默认禁止外网。
- 为高保证场景提供密钥托管、TEE 证明或隐私预算账本。

状态：未实现。

## 执行位置

执行位置由执行模式推导，分四个位置描述，而不是笼统地说"沙箱在哪里"：

| 执行模式 | 协调方 | 参与方侧 |
|---|---|---|
| 多轮联邦 | 平台上的 Flower SuperLink + ServerApp | 各参与方的 Flower SuperNode，本地运行 ClientApp 训练 |
| 纵向协议 | 平台上的 NVFlare 服务端 | 各参与方的 NVFlare 客户端（标签方 + 特征方） |
| 单轮汇总 | 平台沙箱中的统计服务 | 不需要常驻节点，各方上传汇总表 |
| 单轮合并 | 平台沙箱中的记忆合并器 | 不需要常驻节点，各方上传记忆文件 |

控制面始终是 Federation Studio 本身；评测在独立评测沙箱中完成。

## 核心数据契约

前端 `FrontendRunPlan`（`schemaVersion: frontend.run-plan/v1`）是后端 RunSpec 的前身。后端 RunSpec 在此基础上补充输入摘要和资源：

```ts
type RunSpec = {
  schemaVersion: string;
  scenario: string;
  selection: Record<string, string>; // 场景子项、策略、保护的取值
  strategy: string;
  pattern: string;                    // 执行模式
  security: { builtin: string[]; enhancements: string[] };
  params: Record<string, string>;
  inputs: Array<{ uri: string; digest: string; manifest: unknown }>;
  runner: { adapter: string; version: string; resources: unknown };
  evaluation: { suite: string; gates: unknown[] };
};
```

RunSpec 必须版本化、不可变、可重放。密钥、原始数据和长期凭据不能写入 RunSpec。

## 安全边界

- 上传内容先进入隔离 staging，解析器不能获得调度权限。
- 硬规则先于 Agent；Agent 不能覆盖拒绝结果，不直接执行上传内容。
- runner 使用短期、最小权限凭据，默认无外网。
- 日志过滤密钥、原始样本、完整模型参数和敏感提示词。
- 沙箱结束后销毁计算环境，只持久化配置、摘要、日志索引、报告和允许发布的产物。

## 已退役

| 编号 | 原含义 | 退役日期 | 说明 |
|---|---|---|---|
| — | "两套领域模型并存"（产品配置模型 + 旧 LoRA mock 执行模型） | 2026-09-24 | T15 删除旧 LoRA mock，统一为 L2/L3/L4 一套模型 |
