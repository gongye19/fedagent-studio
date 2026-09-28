# 系统架构

最后复核：2026-09-28（T27）

## 架构原则

Federation Studio 采用"统一控制面 + 可替换执行后端"。平台不把所有联邦方法抽象成同一种算法，而是把它们的共同特征整理成 7 个配置维度，并统一它们共同拥有的生命周期：配置、组队、准入、运行、评测和交付。场景之间的差别落在执行模式和 runner adapter 上。

```text
机构用户
  │ 新建项目：7 个维度 + 订单摘要        │ 收到邀请：确认方案
  ▼                                    ▼
L1 展示层（工作台 / 新建项目 / 项目详情 / 邀请）
  │
  ├─► L2 注册表（场景、算力、数据类型、模型、7 个维度的子项）
  ├─► L3 配置引擎 ──► FrontendRunPlan（后端为 RunSpec）
  └─► L4 项目与组队（发起 + 邀请、组织内部多节点）──► Run 状态机 + 按执行模式模拟
                                                   │
                                  Agent 准入 · 运行环境 · 独立评测
                                                   │
                                     L5 Runner adapter（Flower / 隐语 / 平台服务）
                                                   │
                                     L6 产物、谱系与审计存储
```

## 分层

### L1 展示与交互层

位置：`app/src/App.tsx`、`app/src/ui/`、`app/src/styles.css`

- 四个页面：工作台、新建项目、项目详情、邀请详情；hash 路由（`state/route.ts`）。
- 新建项目：7 个维度从上到下全部展开，子项分可选（选项卡 / 参数选项）和锁定（显示固定值）两种；右侧订单摘要固定在视口内，手机端改为底部订单操作栏。
- 项目详情：左侧当前步骤，右侧七步时间轴和项目概况；未手动切换时自动停在当前进度；手机端顶部显示步骤进度，操作栏吸底。
- 组件只渲染领域层给出的候选、状态和推导结果，不复制规则。界面文案统一中文。

状态：已实现前端原型。

### L2 注册表

位置：`app/src/domain/taxonomy.ts`、`app/src/domain/dimensions.ts`

- `taxonomy.ts`：4 个场景（接入方式、执行模式、执行框架）、5 档算力规格（vCPU、内存、单卡显存）、部署位置、6 种数据类型、12 个模型（数据类型、算力要求、LoRA / QLoRA 显存）。
- `dimensions.ts`：7 个维度的 22 个子项。每个子项按当前选择给出候选（`null` 表示不适用；只有一个候选表示锁定），以及推荐默认值。
- 只收录最通用的方法和大模型 / Agent 相关方法；安全机制只列框架实际提供的。

状态：已实现静态注册表。后续应从版本化服务端 schema 加载，能力由 runner manifest 声明。

### L3 配置引擎

位置：`app/src/domain/selection.ts`、`app/src/domain/plan.ts`、`app/src/domain/inputs.ts`

- `normalize` 按子项顺序从上到下校验：不适用的清空，失效或未选的补上推荐值；选完场景即得到完整配置。
- `choose` 只接受可用候选；再点一次当前场景即取消场景。
- `buildRunPlan` 生成不可变的 `FrontendRunPlan`：配置清单、执行框架与模式、交换对象、参与要求（最少方数、节点规格、数据类型、网络）、安全机制清单、评测、交付物与交付范围、执行位置、资源与耗时预估、注意事项。
- `inputs.ts`：每种数据类型的数据要求；文件类的 `checkUpload` 在浏览器本地抽样检查；`nodeDelivery` 给出节点交付方式。
- 后端阶段由 policy service 重新校验，前端结果只是请求，不是能力证明。

状态：前端已实现；服务端 policy service 未实现。

### L4 项目、组队与运行编排

位置：`app/src/domain/project.ts`、`app/src/domain/run.ts`、`app/src/domain/simulator.ts`、`app/src/state/`

- 项目：发起方配置并创建；成员分本机构、本机构其他节点（组织内部联邦）、受邀机构三类；受邀机构的状态顺序固定；`readiness` 给出开始条件和阻塞原因；`projectFromInvitation` 生成本机构作为参与方的项目。
- 工作区：本机构的节点（位置、规格、在线状态）和登记的数据（只登记描述）；节点可以按项目配置交付。
- Run 状态机：`preflight → provision → execute → evaluate` 自动推进，`publish`（交付）需要发起方确认；准入不通过不能创建环境，评测未通过不能交付，运行开始后参与方冻结。
- 模拟器按执行模式生成每个阶段的内容；`state/simulation.ts` 从状态推导待发生的事件（节点交付、示例机构推进、阶段推进、受邀项目的启动与交付），只负责计时和派发；`state/persistence.ts` 把演示数据保存在浏览器本地。

状态：前端已实现；服务端编排、身份与邀请未实现。

### L5 Runner adapter 层

目标实现：`runners/` 独立服务或 worker 包。

- 将 RunSpec 翻译为镜像、命令、资源、挂载、网络策略和超时。
- 横向训练照 Flower 的方式：平台运行 SuperLink + ServerApp（聚合算法、SecAgg+、DP 包装），各方节点运行 SuperNode + ClientApp（模型、LoRA / QLoRA、本地训练轮数）。
- 纵向训练用隐语 SecretFlow：SecureBoost（HEU，Paillier / OU）或 SS-LR（SPU 秘密分享），隐私求交用 PSI v2（ECDH / RR22）。
- 统计汇总和记忆合并由平台服务在隔离沙箱中执行。
- 各参与方只安装平台的节点程序（一个镜像，带 Flower 和隐语运行时），平台按项目启动对应运行时；runner 使用短期凭据，只读挂载输入，只写指定输出位置。

状态：未实现。

### L6 基础设施与持久化层

目标组件：API、关系数据库、对象存储、任务队列、容器调度、日志和密钥服务。

- 保存机构、用户、节点、数据登记、项目、成员、配置版本、Run、报告和产物谱系。
- 启动短生命周期容器或微虚拟机，默认禁止外网。
- 节点证书签发、邀请与授权记录、隐私预算账本。

状态：未实现。

## 执行位置

| 执行模式 | 协调方 | 参与方侧 |
|---|---|---|
| 多轮联邦 | 平台上的 Flower SuperLink + ServerApp | 各参与方节点上的 SuperNode，本地运行 ClientApp 训练 |
| 纵向协议 | 平台上的隐语调度服务 | 各参与方节点上的隐语运行时（标签方 + 特征方） |
| 单轮汇总 | 平台隔离沙箱中的统计服务 | 不需要常驻节点，各方上传汇总表 |
| 单轮合并 | 平台隔离沙箱中的记忆合并服务 | 不需要常驻节点，各方上传记忆文件 |

控制面始终是 Federation Studio 本身；评测在独立评测环境中完成。

## 核心数据契约

前端 `FrontendRunPlan`（`schemaVersion: frontend.run-plan/v2`）是后端 RunSpec 的前身。后端 RunSpec 在此基础上补充参与方、输入摘要和资源：

```ts
type RunSpec = {
  schemaVersion: string;
  project: { id: string; initiator: string };
  selection: Record<string, string>;   // 7 个维度 22 个子项的取值
  pattern: string;                     // 执行模式
  runner: { adapter: "flower" | "secretflow" | "stats" | "memory"; version: string };
  participants: Array<{ org: string; role: string; node?: { id: string; spec: string }; input: { digest: string; manifest: unknown } }>;
  security: { mechanisms: string[]; privacyBudget?: number };
  evaluation: { method: string; gates: unknown[] };
  delivery: { deliverable: string; recipients: string[] };
};
```

RunSpec 必须版本化、不可变、可重放。密钥、原始数据和长期凭据不能写入 RunSpec。

## 安全边界

- 平台不向项目之外展示任何机构的数据；同一项目的参与方只看到彼此授权的描述信息（节点规格、数据摘要），看不到原始数据。
- 配置由发起方决定，每个参与方必须明确确认方案；运行开始后参与方冻结。
- 上传内容先进入隔离 staging，解析器不能获得调度权限。
- 硬规则先于 Agent；Agent 不能覆盖拒绝结果，不直接执行上传内容。
- runner 使用短期、最小权限凭据，默认无外网。
- 日志过滤密钥、原始样本、完整模型参数和敏感提示词。
- 沙箱结束后销毁计算环境，只持久化配置、摘要、日志索引、报告和允许发布的产物。

## 已退役

| 编号 | 原含义 | 退役日期 | 说明 |
|---|---|---|---|
| — | "两套领域模型并存"（产品配置模型 + 旧 LoRA mock 执行模型） | 2026-09-24 | T15 删除旧 LoRA mock，统一为 L2/L3/L4 一套模型 |
