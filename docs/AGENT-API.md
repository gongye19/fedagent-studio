# 自有 Agent 接入协议

平台区分三类输入：数据文件、LLM 推理接口、能执行算法本方步骤的 Agent 服务。平台负责算法与规范、调度、共享产出、独立判分；外部 Agent 管理自己的模型和工具。普通聊天 API 只属于 LLM 接口，不能仅改名就作为联邦 Agent。

当前支持 FoT 数学推理与 EvoMedClaw 横向文本诊断。Agent 替代参与方步骤，中心汇总仍由平台执行；FoT 中心需要另选 LLM，医疗聚合不需要中心 LLM。每份数据默认使用同一 Agent，可在高级配置单独指定。不同来源的 task／site／round 状态分别隔离；共用一个 URL 不代表它们是独立机构。

## 用户怎么接入

1. 数据资源上传匹配任务类型的 JSONL，上传时完成全文件格式检查；也可选择已有公用数据试跑。
2. 在 Agent 接口点击接入，可下载当前JSON协议与算法清单（`GET /v1/agent-protocol`），再填写名称、服务根地址和可选 Bearer 密钥，点击“检查能力”。密钥加密保存、不能读回，修改地址后旧密钥清除。
3. 新建任务依次选择场景、任务类型、算法、数据，执行方式选“自有 Agent”，再选择接口；需要中心 LLM 时单独选择。
4. 点击“测试配置”，确认会向所选服务发送样本并产生少量费用。测试检查文件完整性／规范、真实 LLM 请求、Agent 能力版本和一条去掉评测答案的实际预测；不会自动创建正式任务、经验库或应用。测试不测算法准确率，也不保证每个后续请求成功。
5. 报告通过后开始。配置或资源变化、报告超过15分钟均需重测；改任务名称不影响结果。刷新继续读原报告，不重复发送付费请求。服务重启中断的检查显示失败，需手动重测。

当前使用已上传到平台的文件。步骤需要的原始样本会发往所选 Agent，平台的 LLM 密钥不会发送；**没有实现只传远程文件引用或原始数据不出用户环境的外部 Agent 模式**。旧本地客户端仍通过独立领取协议执行，普通上传不再提供客户端选项；旧客户端数据仅核对在线／版本／上报，原文件检查明确标为未由平台读取。

## HTTP 契约 v1

服务地址可以有路径前缀，以下路径追加到登记地址。JSON 字段采用 snake_case，`protocol` 固定为 `fedagent-agent/1`；平台管理 API 仍使用 camelCase。所有 HTTP 请求可带 `Authorization: Bearer <用户在平台输入的密钥>`。禁止重定向，输入／输出最多8MB，单条交换消息最多1MB。

### GET /capabilities

```json
{
  "protocol": "fedagent-agent/1",
  "algorithms": {
    "fot": {"version": "1.0.0", "steps": ["solve", "reflect", "extract"]},
    "evomedclaw": {"version": "0.1.0", "steps": ["diagnose", "learn"]}
  }
}
```

版本与全部参与方步骤须匹配安装的算法清单；中心步骤不交给外部 Agent。以上仅为协议结构，不在平台创建示例资源。实际支持版本以 `/v1/registry` 为准。

### POST /runs

提交一个工作单元，快速返回 `202` 和运行状态，执行可在后台进行。请求结构见 [protocol.py](../server/fedagent/agents/protocol.py) 的 `AgentRequest`：

| 字段 | 含义 |
|---|---|
| run_id | 平台生成的幂等编号，网络重试时保持相同 |
| algorithm／version／task_type | 算法、插件版本与任务类型 |
| task_id／site_id／role | 本次任务与逻辑来源边界 |
| round／rounds／step／unit_key | 轮次、总轮次、步骤、样本ID；整站点步骤的unit_key为`_` |
| params | 算法参数，已填入默认值 |
| items | 本步骤授权的 `{id, fields}`；推理默认移除嵌套标注 |
| state | 本方此前的 `{key, item_id, round, value}`；不会提供其他来源私有状态 |
| inbox | 仅本步骤声明可读的交换通道消息 |
| artifact | 上一轮及之前最新的共享产出，含version／round／kind／content |

服务不得把不同 task_id、site_id 或 round 的私有状态混用。同一个 run_id 的重复请求必须返回同一运行，不能重复执行；相同编号而内容不同应返回409。Agent内部可以使用任意模型、工具或框架，但输出必须符合选中算法的业务契约，不能只给无关聊天文字。

### GET /runs/{run_id}

返回 `{run_id, status, result, error, retryable}`。`retryable`默认false；只有明确failed且声明可重试时，平台才按算法步骤的重试上限重做；网络状态不明不据此重新提交。状态为queued／running／succeeded／failed／canceling／canceled。完成时必须有result：

| result字段 | 内容 |
|---|---|
| kept | `[key, item_id或null, value]`数组，保存本方后续步骤需要的中间结果 |
| sent | `{channel, payload, item_id, to}`数组，仅声明的发送通道和合法目标 |
| reports | 插件声明的普通统计；禁止自行填写correct／labeled |
| predictions | `[item_id, prediction]`数组，仅评估步骤可提交、不得重复或跨样本 |
| logs | 可选文本日志，不作为进度或完成依据 |

FoT须保存solution／reflection并发送可供中心归类的trace；医疗须保存diagnostic_trajectory，并按固定上游适配格式产生clinical-cards。具体结构以固定插件及参考运行器为依据；不是任意返回一个最终答案就能参与联邦更新。推理结果由平台用原标注独立评分，医疗学习步骤只收到learn病例标注，eval答案始终剥离。

平台保存运行编号与输入摘要。连接中断或进程重启后继续查询同一编号；确认failed／canceled后才创建新的编号。超过等待期限会暂停任务，不把“仍在等待”显示为完成。服务应持久化状态与结果，使重启后的重复请求仍可去重；若执行被中断，要明确失败，不默默重跑付费请求。

### POST /runs/{run_id}/cancel

请求停止并返回同一结构。只有服务确认停止后才返回canceled，仍在停止返回canceling。建议对尚未收到的run_id持久化取消标记，拒绝随后迟到的同编号执行。已成功的运行返回succeeded即可，不篡改为取消。

平台暂停／取消会请求停止已提交的远程工作；远程尚未确认停止时，事件明确写出“平台已停止调度，部分 Agent 尚未确认停止”，不声称已经终止对方执行。停止Agent进程并不保证模型供应商撤销已发出的推理费用。

## 独立参考服务

参考服务是实际的另一个HTTP进程，使用SDK执行两插件的本方步骤；算法能力、序列化与输入输出与用户服务相同，不在平台登记固定测试资源。仅监听127.0.0.1，用于本地／服务器联调。

```bash
cd server
FEDAGENT_DATA_DIR=/实际的平台数据目录 uv run fedagent agent-serve \
  --port 9020 --model 已保存的模型引用 --store /单独的联调运行目录
```

参考服务内部通过原平台Gateway调用已保存接口，不读取或复制模型明文密钥给操作者。运行记录单独持久化，进程退出会停止子进程；启动时把中断运行标为失败。它依赖同机平台数据库做模型联调，不能当作已经部署到用户独立环境的产品。验证结束删除本次任务／应用／Agent登记／检查报告、停止参考服务并清理其临时目录；原始数据、已有接口、密钥与调用账本保留。

发布的是标准算法经验成果；应用的试用／invoke沿用该算法的应用工作流和用户选择的LLM，**不会转发到任务时的自有Agent**。若需要发布用户完整Agent服务，属于独立后续能力，不在本次范围。
