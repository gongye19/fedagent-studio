# 运行流程

所有工作负载共用一条七步时间轴。左侧只展示当前节点，用户可以“下一步”推进，也可以点击右侧节点回看。

## 1. Configuration

用户按层选择工作负载、数据关系、参与拓扑、协作策略和保护目标，再填写方法专属参数。平台实时收窄选项，并派生 runner、评测方案和输出类型。

- 当前：真实前端配置逻辑。
- 后端：保存配置草稿，生成版本化 schema。

## 2. Data upload

根据所选工作负载显示对应输入，如训练数据 schema、LoRA adapter、模型 endpoint、索引或 Skill artifact。

- 当前：演示文件和上传状态，不持久化内容。
- 后端：分片上传、对象存储、摘要计算、病毒扫描和 manifest 提取。

## 3. Agent preflight

硬规则检查输入格式、架构、字段、基座、参与方数量、保护条件和资源需求。Agent 将结构化结果翻译成人能理解的原因，并处理未覆盖的长尾问题。

- 当前：静态通过报告。
- 后端：policy engine + 只读 Agent，输出可审计 `PreflightReport`。

## 4. Provision sandbox

编排器冻结 RunSpec，选择 runner 版本，申请 CPU/GPU、挂载只读输入并设置网络策略。

- 当前：模拟进度。
- 后端：Docker、Kubernetes Job 或微虚拟机。

## 5. Execute federation

对应 runner 执行训练、聚合、PSI、统计、检索融合或知识协作。控制面只消费标准化状态、日志摘要和候选输出。

- 当前：LoRA mock adapter；其余工作负载仅展示计划。
- 后端：Flower、NVFlare、FATE 或自定义 adapter。

## 6. Evaluate output

在独立评测环境中比较基线与候选结果，检查质量、回归、公平性、隐私预算或业务阈值。未通过闸门的结果不可发布。

- 当前：模拟指标。
- 后端：版本化 evaluation suite 和不可绕过的发布闸门。

## 7. Publish artifact

固化结果、报告、RunSpec、输入摘要和谱系，生成可下载或可复用的版本。

- 当前：模拟发布页。
- 后端：artifact registry、访问控制、审计记录和生命周期策略。

## 状态约束

- `preflight` 未通过，不能 provision。
- RunSpec 冻结后修改配置必须创建新 Run。
- runner 失败只能重试当前阶段或从快照恢复，不能伪造后续成功状态。
- evaluation 未通过，不能发布正式产物。
- 页面跳转只改变查看节点，不应绕过实际状态机。

