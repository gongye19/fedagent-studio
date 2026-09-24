# 首个可执行场景：PEFT / LoRA

通用前端已经覆盖多类联邦工作负载，但后端不应一次实现全部。第一条真实纵向切片建议选择：**跨机构、横向、同一基础模型上的 LoRA / Adapter 联合微调与聚合**。

## 为什么先做这个场景

- 输入对象小于完整模型，适合本机或小规模集群验证。
- 兼容条件明确：adapter 类型、基础 checkpoint、目标模块和 rank 可结构化检查。
- 可以先从一轮聚合开始，再扩展多轮客户端训练。
- 输出和评测容易版本化，适合验证 RunSpec、沙箱和谱系。

## 建议的第一版契约

| 维度 | 值 |
|---|---|
| 工作负载 | LoRA / Adapter 联合微调 |
| 数据关系 | 横向联邦 |
| 拓扑 | Cross-silo |
| 聚合策略 | FedAvg |
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
workload: peft
strategy: fedavg
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

1. 将当前 LoRA mock 配置迁移到通用 RunSpec。
2. 实现真实上传、manifest extractor 和规则校验。
3. 用本机 Docker Job 跑通加权聚合并回传日志。
4. 增加独立评测 runner 和发布闸门。
5. 接对象存储、数据库与队列。
6. 再实现多轮本地训练、SecAgg 和故障恢复。

