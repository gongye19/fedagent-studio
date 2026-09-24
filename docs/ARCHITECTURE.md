# 系统架构

## 架构原则

Federation Studio 采用“统一控制面 + 可替换执行后端”。平台不把所有联邦方法抽象成同一种算法，而是统一它们共同拥有的生命周期：配置、准入、运行、评测和发布。

```text
User
  │
  ▼
Configuration UI ──► Workload Registry ──► Compatibility Resolver
  │                                              │
  └──────────────────► RunSpec ◄────────────────┘
                           │
                           ▼
                Orchestrator / State Machine
                    │          │          │
                    ▼          ▼          ▼
               Agent Gate   Sandbox    Evaluation
                    │          │          │
                    └──── Runner Adapter ┘
                               │
                               ▼
                     Artifact & Audit Store
```

## 分层职责

### 1. 展示与交互层

位置：`app/src/ui/`、`app/src/styles.css`

- 左侧显示当前步骤，右侧显示可点击时间轴。
- 配置维度以独立模块展示，不把所有字段放进一个大表单。
- 只渲染领域层给出的选项和解析结果，不在组件内复制兼容规则。

状态：已实现前端原型。

### 2. 工作负载注册表

位置：`app/src/domain/configuration.ts`

- 声明 9 类工作负载。
- 为每类工作负载声明允许的数据关系、参与拓扑、策略和方法专属参数。
- 解析运行时、评测、输出、输入标签和文件类型。

状态：已实现静态注册表。后续应从版本化服务端 schema 加载。

### 3. 兼容性与准入层

位置：`app/src/domain/compatibility.ts`、未来的 policy service

- 校验配置之间的兼容性。
- 提取上传内容的 manifest，执行格式、架构、基座、数据 schema 和隐私要求等硬规则。
- 生成结构化 `PreflightReport`。
- Agent 只能解释规则结果、补充风险和提出修复建议，不能覆盖硬规则。

状态：旧 LoRA mock 规则已存在；通用准入服务未实现。

### 4. Run 编排层

位置：`app/src/domain/run.ts`、`app/src/state/store.ts`

- 管理 `configuration → upload → preflight → provision → execute → evaluate → publish` 状态迁移。
- 根据已验证配置生成不可变 RunSpec。
- 把阶段任务交给 runner adapter，并记录日志、指标和谱系。

状态：前端状态机和模拟运行已实现；服务端编排未实现。

### 5. Runner adapter 层

目标实现：`runners/` 独立服务或 worker 包。

- 将 RunSpec 翻译为镜像、命令、资源、挂载、网络策略和超时。
- 对接 Flower、NVFlare、FATE、自定义 LoRA 聚合器或 FedRAG worker。
- runner 使用短期凭据，只读挂载输入，只写指定输出位置。

状态：只有 `app/src/domain/backends.ts` 中的 mock adapter；真实 runner 未实现。

### 6. 基础设施与持久化层

目标组件：API、关系数据库、对象存储、任务队列、容器调度、日志和密钥服务。

- 保存用户、项目、配置版本、Run、manifest、报告和产物谱系。
- 启动短生命周期容器或微虚拟机，默认禁止外网。
- 为高保证场景提供密钥托管、TEE 证明或隐私预算账本。

状态：未实现。

## 两套领域模型的现状

代码中目前同时存在两套模型，这是有意保留的过渡结构：

| 模型 | 文件 | 用途 |
|---|---|---|
| 产品配置模型 | `configuration.ts` | 驱动当前 9 类工作负载 UI，代表平台未来方向 |
| LoRA 演示执行模型 | `scenario.ts`、`registry.ts`、`compatibility.ts`、`repository.ts`、`backends.ts` | 支撑旧的 PEFT mock 流程和测试，作为首个真实 runner 的迁移起点 |

后端建设时应让 LoRA 场景也使用版本化 RunSpec 和通用工作负载 schema，再删除这层兼容结构。当前不要误把 mock backend 当作生产实现。

## 核心数据契约

```ts
type RunSpec = {
  schemaVersion: string;
  workload: string;
  partition: string;
  topology: string;
  strategy: string;
  protectionProfile: string;
  settings: Record<string, unknown>;
  inputs: Array<{ uri: string; digest: string; manifest: unknown }>;
  runner: { adapter: string; version: string; resources: unknown };
  evaluation: { suite: string; gates: unknown[] };
};
```

RunSpec 必须版本化、不可变、可重放。密钥、原始数据和长期凭据不能写入 RunSpec。

## 安全边界

- 上传内容先进入隔离 staging，解析器不能获得调度权限。
- 硬规则先于 Agent；Agent 不直接执行上传内容。
- runner 使用短期、最小权限凭据，默认无外网。
- 日志过滤密钥、原始样本、完整模型参数和敏感提示词。
- 沙箱结束后销毁计算环境，只持久化配置、摘要、日志索引、报告和允许发布的产物。

