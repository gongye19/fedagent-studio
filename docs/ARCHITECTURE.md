# 系统架构

最后复核：2026-09-28（T30：沙箱改为 microVM 优先、gVisor 兜底）

## 架构原则

Federation Studio 采用"统一控制面 + 可替换执行后端"。平台不把所有联邦方法抽象成同一种算法，而是把它们的共同特征整理成 7 个配置维度，并统一它们共同拥有的生命周期：配置、组队、准入、运行、评测和交付。场景之间的差别落在执行模式和 runner adapter 上。

![平台整体架构](./platform-architecture.png)

（图的源文件：`platform-architecture.svg`，由 `platform-architecture.gen.py` 生成。）

- **接入层**：Web 控制台、CLI（`fedctl`）、MCP Server、SDK 都是同一套 OpenAPI 的客户端，人和 Agent 走同一条路径、同一套权限和审计。
- **控制面**：项目与组队、配置引擎（7 个维度）、策略引擎（硬规则与审批闸门）、工作流编排、节点注册中心、身份与权限。
- **Agent 层**：Agent 运行时只通过 MCP / CLI 调用平台，与外部 Agent 没有特权差别。
- **执行面（平台侧）**：沙箱调度、Runner 适配器（Flower、隐语、统计服务、记忆合并服务）、独立评测环境，每次运行按需创建。
- **参与方侧**：各机构只装一个节点程序 `fs-node`，主动出站连接平台，拉起对应的联邦运行时；原始数据只读挂载，不出域。
- **数据与基础设施**：PostgreSQL、对象存储、产物与模型登记、审计日志、可观测性、证书与密钥、事件总线。

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

## 接入方式：人和 Agent 用同一套接口

平台 API 优先：先定义 OpenAPI，Web 控制台、CLI、MCP Server 和 SDK 都由它派生，任何能在界面上做的事都能用命令或工具完成，反之亦然。

### CLI：`fedctl`

配置是声明式的（和 7 个维度一一对应），先 `plan` 再 `apply`，与 Terraform / kubectl 的用法一致；所有命令支持 `--json` 输出和非交互参数，便于脚本和 Agent 调用。

```yaml
# project.yaml
apiVersion: federation.studio/v1
kind: Project
metadata:
  name: 客服大模型联合微调
spec:
  scenario: horizontal-training
  parties:  { scale: "3-5", deployment: aliyun, compute: gpu-24, network: public }
  data:     { type: instruction }
  model:    { name: qwen2.5-1.5b, sharing: lora }
  training: { aggregation: fedavg, rounds: 10, sampling: all, localEpochs: 1 }
  security: { secagg: off, dp: off }
  delivery: { evaluation: local, scope: all }
  invite:   [启明证券研究所, 衡平律师事务所]
```

```text
fedctl plan -f project.yaml          校验配置，输出订单摘要（资源、耗时、注意事项），不产生任何变更
fedctl apply -f project.yaml         创建项目并发出邀请
fedctl node join --token <项目令牌>   在参与方机器上注册并启动 fs-node
fedctl project status <id> --json    组队进度与开始条件
fedctl run start <id>                开始运行（需要发起方确认）
fedctl run logs <run> --follow       阶段日志（已脱敏）
fedctl deliver <run>                 确认交付
```

### MCP Server

把同一组能力暴露为 MCP 工具（`plan_project`、`create_project`、`invite_member`、`get_project_status`、`start_run`、`get_run_logs`、`list_nodes`、`diagnose_run` 等），外部 AI Agent（例如各机构自己的助手或编程 Agent）用机构授予的短期令牌直接操作平台。每个工具标注风险等级，由策略引擎决定能否直接执行。

## Agent 层

| Agent | 做什么 | 能做到哪一步 |
|---|---|---|
| 配置助手 | 把自然语言需求转成 `project.yaml` 草案，并调用 `plan` 给出订单摘要 | 只生成草案，创建项目仍需用户确认 |
| 准入解释 | 把策略引擎的结构化结果翻译成说明和修复建议 | 只读，不能覆盖拒绝 |
| 运维 Agent | 巡检节点版本与镜像漏洞、在沙箱中做回归验证、诊断失败的阶段 | 提出升级或重试计划；升级节点、重试运行需人工审批 |
| 评测报告 | 把评测指标整理成报告 | 只读 |
| 记忆合并 Agent | 在 Agent 记忆联邦中审阅互相矛盾的记忆 | 只在记忆合并沙箱内处理已脱敏的条目 |

- **模型**：使用我方提供的大模型 API，不依赖任何外部模型厂商。Agent 通过一个模型网关调用它（OpenAI 兼容的 Chat Completions 接口，如 vLLM / SGLang 的服务端或 LiteLLM 网关）；以后换模型只改网关配置，不改 Agent 代码。
- **对模型的要求**：稳定的工具调用（function calling）和 JSON 结构化输出；上下文建议 ≥ 32K（读运行日志、配置和评测结果）。
- **候选模型服务**：OpenRouter 或 GLM，二者都是 OpenAI 兼容接口，在模型网关里只需配置地址、密钥和模型名。用 OpenRouter 时只选支持工具调用的模型；面向国内机构的部署优先 GLM（国内服务，或私有化部署开源权重）。无论用哪个，Agent 发给模型的都只有描述信息、指标和脱敏日志；平台服务器需要能出站访问所选的模型服务。
- **框架**：Pydantic AI（模型无关、原生 MCP 客户端、类型化工具）作为默认；有长流程、需要断点续跑的 Agent（如运维 Agent 的升级流程）用 LangGraph。两者都只把平台 MCP / CLI 当作工具。
- **运行方式**：Agent 全部部署在平台内部，在隔离的工作沙箱中执行，使用短期、最小权限令牌；模型调用也不出平台网络。
- **权限分级**：只读查询自动执行；可逆操作自动执行并审计；启动运行、交付、邀请外部机构、升级节点需要人工审批。Agent 只看描述信息、指标和脱敏日志，不接触原始数据。

## 沙箱与运行环境维护

### 平台里的沙箱

| 沙箱 | 里面跑什么 | 代码与输入的可信度 | 需要 GPU | 隔离运行时 |
|---|---|---|---|---|
| 协调 / 聚合沙箱 | Flower ServerApp、隐语调度 | 平台代码 | 否 | microVM |
| 统计 / 记忆合并沙箱 | 汇总表重算、记忆脱敏与合并 | 平台代码 + 外部数据 | 否 | microVM |
| 上传检查沙箱 | 解析各方上传的文件 | 不可信输入 | 否 | microVM |
| Agent 工作沙箱 | Agent 执行命令和脚本 | 不可信（模型生成） | 否 | microVM |
| 镜像验证沙箱 | 运维 Agent 用小任务回归验证新运行时镜像 | 待验证镜像 | 视镜像而定 | microVM；需要 GPU 的验证用 gVisor |
| 评测沙箱 | 用测试集评估交付物 | 外部产物 | 大模型评测需要 | gVisor（nvproxy 访问 GPU） |

microVM 指 Kata Containers + Firecracker：每个沙箱一台极简虚拟机，有独立内核。

参与方侧不在平台沙箱里：`fs-node` 在各机构自己的机器上以容器拉起联邦运行时，数据只读挂载，由机构自己掌控。

### 隔离技术与选择

| 技术 | 原理 | 隔离强度 | GPU | 主要使用者 |
|---|---|---|---|---|
| 普通容器（Docker / runc） | 共享宿主内核，namespace + cgroup | 弱，不适合跑不可信代码 | 支持 | 通用 |
| gVisor | 用户态内核拦截系统调用 | 中强，不需要 KVM | 支持（nvproxy，CUDA） | Modal、GKE Sandbox |
| Kata Containers | 每个 Pod 一个轻量虚拟机，可选 QEMU / Cloud Hypervisor / Firecracker | 强（虚拟机级），需要 KVM | QEMU 下可直通 | 云厂商的安全容器 |
| Firecracker | 极简 microVM，约 125ms 启动 | 强（虚拟机级），需要 KVM | 稳定版尚不支持直通 | E2B、AWS Lambda、Vercel、Fly.io |
| 进程级沙箱（bubblewrap、seccomp、Landlock） | 限制单个进程的文件与网络访问 | 较弱 | — | 本地编程 Agent |
| WebAssembly / V8 isolate | 语言级隔离 | 强，但只能跑特定运行时 | 否 | Cloudflare |

方案是 **microVM 优先，gVisor 兜底**：
- **microVM（Kata + Firecracker）做默认**：虚拟机级隔离，逃逸需要攻破虚拟机监控器，而不是一个系统调用实现；它是目前 Agent 沙箱最主流的隔离方式（E2B、AWS Lambda、Vercel 都用 Firecracker），在读写频繁的负载上也没有 gVisor 的 10–30% 开销。代价是需要 KVM，且稳定版不支持 GPU。
- **gVisor 只用在两处**：需要 GPU 的评测沙箱（通过 nvproxy 共用宿主机显卡驱动，一张卡可以被多个沙箱轮流使用），以及服务器不支持 KVM 时的整体兜底。
- **部署时自动判断**：节点有 `/dev/kvm` 就启用 microVM 运行时，没有就全部回落到 gVisor。架构和代码不变，只是 SandboxTemplate 里的 RuntimeClass 不同；之后换到支持 KVM 的机器，改配置即可切回 microVM。

### 统一管理：Kubernetes Agent Sandbox

所有沙箱统一用 Kubernetes 官方子项目 Agent Sandbox（`kubernetes-sigs/agent-sandbox`）管理：每类沙箱一个 SandboxTemplate（镜像、资源、隔离运行时、网络策略），运行时按需 SandboxClaim，常用模板配 SandboxWarmPool 预热，冷启动降到 1 秒以内；隔离运行时通过 RuntimeClass 在 gVisor 与 Kata（Firecracker）之间切换。

### 运行环境维护

- **每次运行按需创建**：默认拒绝网络，只放行项目通道，运行结束即销毁。
- **只用签名镜像**：Flower、隐语和平台服务的运行时镜像统一构建、签名并附带 SBOM，节点和沙箱只拉取签名镜像。
- **节点程序 `fs-node`**：一个镜像同时带 Flower 与隐语运行时；主动出站 mTLS 连接平台，上报资源（GPU 型号与显存、CPU、内存、磁盘），在本地做数据检查，按平台指令拉起运行时，并支持平台下发的升级。
- **Agent 参与维护**：运维 Agent 发现新版本或漏洞后，先在镜像验证沙箱里跑一个小规模联邦任务，再提交升级计划，经审批后灰度升级；运行失败时读取脱敏日志定位原因，提出重试或从检查点恢复。

## 资源需求

平台本身不需要显卡。显卡只在训练发生的地方需要：正式运行时在各参与方的节点上，由参与方按项目的"节点算力规格"自备。

| 用途 | 运行位置 | 需要 GPU | 建议配置 |
|---|---|---|---|
| 控制面（API、数据库、对象存储、编排、Flower SuperLink、隐语调度） | 平台服务器 | 否 | 8 vCPU · 32 GB 内存 · 500 GB SSD |
| 平台沙箱（统计、记忆合并、准入检查、Agent 工作沙箱） | 平台服务器 | 否 | 可与控制面同机，或另加 8 vCPU · 16 GB |
| Agent | 平台服务器 | 否 | 调用我方大模型 API；若该模型也部署在这台服务器上，需要按模型大小另配 GPU |
| 后端 demo：横向大模型 LoRA，在一台机器上模拟 3 方 | 平台服务器 | 是 | 1 张 24 GB 显卡（A10 / L4 / RTX 4090 / 3090）· 16 vCPU · 64 GB 内存；16 GB 显卡可用 QLoRA |
| 后端 demo：表格模型、ResNet-18、纵向、统计、记忆 | 平台服务器 | 否 | CPU 即可；SecureBoost 同态加密建议 16 核以上 |
| 正式运行 | 各参与方节点 | 由参与方自备 | 按项目配置 |

网络：平台需要一个可被节点访问的域名和 TLS 证书（节点只做出站连接）；实验室内部演示可以直接用内网地址。

## 技术选型建议

| 部分 | 选型 | 理由 |
|---|---|---|
| API 与服务 | Python（FastAPI + Pydantic）→ OpenAPI | 与 Flower、隐语同一语言生态；CLI、SDK、MCP 从同一份定义生成 |
| 工作流编排 | Temporal | 多轮训练是长时间任务，需要持久化状态、重试和断点恢复 |
| 策略引擎 | OPA（Rego） | 硬规则独立于代码和 Agent，可审计、可测试 |
| 数据与存储 | PostgreSQL · MinIO（S3 兼容） | 通用、可私有化部署 |
| 沙箱 | Kubernetes Agent Sandbox（k3s 单机起步）+ microVM（Kata + Firecracker）为默认，gVisor 用于 GPU 与无 KVM 兜底 | 统一的沙箱模板与预热池；虚拟机级隔离为主，GPU 场景用 gVisor |
| 身份与证书 | Keycloak（OIDC）· step-ca（节点证书）· Vault | 机构登录、节点 mTLS 和密钥分开管理 |
| 可观测性 | OpenTelemetry · Prometheus · Loki · Grafana | 运行、节点和 Agent 操作统一追踪 |
| 事件 | NATS · Webhook | 运行进度、邀请和交付事件推送 |
| Agent | Pydantic AI（默认）/ LangGraph（长流程）+ 平台 MCP Server | 模型无关，接我方大模型 API；工具面就是平台 API，权限与审计复用 |
| 模型网关 | OpenAI 兼容接口（vLLM / SGLang / LiteLLM） | 换模型只改配置；统一限流、计量和日志 |

起步阶段全部部署在一台服务器上（k3s 单节点）；需要时再把控制面、沙箱池和 GPU 节点拆开。

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
