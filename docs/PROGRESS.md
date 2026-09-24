# 当前进展

更新时间：2026-09-24  
版本：0.1.0 前端原型

## 一句话状态

产品信息架构和交互原型已经成形：平台可配置 9 类联邦工作负载并演示完整 Run 生命周期；真实上传、Agent、沙箱、联邦 runner、评测和发布后端尚未接入。

## 已完成

### 产品与界面

- 从 LoRA 单场景页面升级为分层配置平台。
- 工作负载、数据关系、参与拓扑、协作策略、保护目标分别展示。
- 方法专属配置按工作负载动态变化。
- 运行时、评测和输出由配置自动解析。
- 采用简洁的 Vercel / Railway 风格，并统一字体、间距、边框和状态色。
- 左侧步骤内容 + 右侧可点击时间轴；桌面和移动端均可用。

### 工作负载注册表

已加入以下 9 类候选：

1. 模型联合训练
2. LoRA / Adapter 联合微调
3. 纵向联合建模
4. 联邦评估
5. 联邦统计分析
6. 联邦检索 / FedRAG
7. 个性化联邦
8. 异构模型协作
9. Agent / Skill 协作

### 工程质量

- React 19 + TypeScript 6 + Vite 8。
- 领域逻辑与 React 组件分离。
- 现有测试：70 个，覆盖 5 个测试文件。
- `lint`、`typecheck`、`test` 和生产构建全部通过。
- 浏览器检查无 Vite overlay 或运行时异常。

## 当前模拟或未实现

| 能力 | 状态 | 需要补充 |
|---|---|---|
| 文件上传 | 模拟 | 对象存储、摘要、manifest、扫描 |
| 通用兼容规则 | 部分 | 服务端 schema、规则版本和拒绝原因 |
| Agent preflight | 模拟 | 只读工具、规则解释、审计记录 |
| 沙箱创建 | 未实现 | Docker/Kubernetes/微虚拟机适配器 |
| 联邦算法 | 未实现 | Flower/NVFlare/FATE/自定义 runner |
| 隐私保护 | 未实现 | SecAgg、DP、HE、MPC、TEE 的真实协议与证明 |
| 评测闸门 | 模拟 | 独立 runner、基线、阈值和报告 |
| 产物发布 | 模拟 | registry、谱系、权限与下载 |
| 平台后端 | 未实现 | API、数据库、队列、身份和审计 |

## 技术债务与风险

- 产品配置模型与旧 LoRA mock 执行模型并存，后端阶段需要统一到版本化 RunSpec。
- 当前兼容性主要按工作负载静态收窄，还没有覆盖跨维度的完整规则图。
- 保护配置容易被误解为已实现安全能力，所有页面和文档必须持续标明能力状态。
- 9 类工作负载适合展示平台边界，但首个后端里程碑必须坚持只打通一条纵向切片。
- 现有截图包含多轮历史设计，正式汇报应使用 `layered-configuration*.png`。

## 下一阶段建议

### M1：冻结契约

- 定义 `WorkloadDefinition`、`RunSpec`、`InputManifest`、`PreflightReport` 和 `RunnerManifest` 的 JSON Schema。
- 将前端静态注册表拆成可版本化配置数据。

### M2：LoRA 真实纵向切片

- 上传 adapter，提取 manifest，执行兼容性检查。
- 创建本机隔离容器，完成真实 FedAvg 聚合。
- 运行独立评测并注册产物。

### M3：平台化

- 增加 API、PostgreSQL、对象存储、队列、身份和审计。
- 把 runner 抽象成 adapter，接入第二类明显不同的工作负载，建议选择联邦统计或纵向建模。

### M4：Agent 与安全能力

- Agent 解释结构化规则，并处理受控长尾问题。
- 按场景逐项落地 SecAgg、DP、HE/MPC 或 TEE，不做空泛的“一键加密”。

## 最近验证结果

```text
npm run lint       PASS
npm run typecheck  PASS
npm test           PASS (70 tests, 5 files)
npm run build      PASS
```

详细演进记录见 [HISTORY.md](./HISTORY.md)。

