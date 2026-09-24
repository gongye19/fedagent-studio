# 后端 demo 候选：PEFT / LoRA

> 2026-09-24（T15）：状态改为**候选**。当前先用前端验证维度分层，分层确认后再选两个结构差异大的场景做后端 demo（见 [PROGRESS.md](./PROGRESS.md) M2）。本文保留 LoRA 候选的契约草案，对应场景"LoRA / Adapter 联邦微调"（多轮联邦）。"模型与 Adapter 聚合"场景已在 T24 删除，下文的一轮加权聚合仅作为多轮训练前的验证步骤。

前端已经覆盖多个场景模板，但后端不应一次实现全部。LoRA 候选是：**跨机构、同一基础模型上的 LoRA / Adapter 聚合，再扩展为多轮联邦微调**。

## 为什么先做这个场景

- 输入对象小于完整模型，适合本机或小规模集群验证。
- 兼容条件明确：adapter 类型、基础 checkpoint、目标模块和 rank 可结构化检查。
- 可以先从一轮聚合开始，再扩展多轮客户端训练。
- 输出和评测容易版本化，适合验证 RunSpec、沙箱和谱系。

## 建议的第一版契约

| 维度 | 值 |
|---|---|
| 协作目标 | 训练模型 |
| 各方投入 | 本地数据 |
| 数据关系 | 横向（第二步） |
| 模型类别 / 共享方式 | 神经网络 · LoRA / Adapter |
| 协作策略 | FedAvg |
| 基础模型 | 固定一个小型、许可清晰的模型 |
| Adapter | LoRA，统一 target modules 和 rank |
| 保护 | 第一阶段 mTLS + 隔离沙箱；SecAgg 后续接入 |
| 评测 | 任务质量、基线回归和产物完整性 |
| 输出 | adapter 权重、指标、日志索引、输入谱系 |

不要在尚未实现协议时把普通服务端加权平均标记为“安全聚合”。前端中的保护目标是产品配置；真实能力必须由 runner manifest 和后端证明。

## 输入 manifest

```json
{
  "format": "peft-lora",
  "baseModel": "example/model@revision",
  "architecture": "causal-lm",
  "rank": 16,
  "targetModules": ["q_proj", "v_proj"],
  "dtype": "bf16",
  "sampleCount": 1200,
  "digest": "sha256:..."
}
```

首版硬规则至少包括：

- 所有 adapter 使用相同基础模型 revision。
- 架构、rank、target modules 和 tensor shape 一致。
- 至少两个有效参与方。
- `sampleCount` 为正数，且权重归一化可复现。
- 文件摘要和声明 manifest 一致。

## RunSpec 与 runner

```yaml
schemaVersion: federation.run/v1alpha1
scenario: peft-finetune
strategy: peft-fedavg
runner:
  adapter: lora-fedavg
  version: 0.1.0
  image: federation/lora-fedavg:0.1.0
network: deny
inputs: read-only
outputs: /job/output
timeout: 30m
```

runner 不访问业务数据库，不持有长期凭据，只读取本次 Run 的输入并写入指定输出目录。

## 实施顺序

1. 以前端 FrontendRunPlan 为基础定义 RunSpec（旧 LoRA mock 已在 T15 删除）。
2. 实现真实上传、manifest extractor 和规则校验。
3. 用本机 Docker Job 跑通加权聚合并回传日志。
4. 增加独立评测 runner 和发布闸门。
5. 接对象存储、数据库与队列。
6. 再实现多轮本地训练、SecAgg 和故障恢复。

