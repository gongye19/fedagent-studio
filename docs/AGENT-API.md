# 自有 Agent 接入协议

## T98：医疗独立评测模型（2026-10-28）

EvoMedClaw协议1.2.0在医疗Agent＋同方病例之外，任务需主动选择一个已验证LLM作为独立评测模型；不是给每组数据再嵌套一个LLM，也不替用户选择。复用serverModel字段，registry.requirements.serverModelLabel为评测模型。资源接入步骤仍由用户自己的服务与模型执行，原四接口和数据格式保持；升级版本／代码会使旧资源凭据失效，须重新验证新版本。

SDK0.2.5的Grader.requires_model／evaluate支持模型判分，原有grade仍兼容。平台独立判分可读取评测参考答案，作答Agent的diagnose请求不可读取；learn步骤仍按原授权读取学习答案。TaskType.is_evaluated定义任务评测分母，MedicalDiagnosis排除learn；资源上传的标注总数不受影响。完整算法规范会包含新评测资源要求。

学习与任务评测默认同用原版判分规则。模型异常不当成答错；复用网关的凭据、取消、账本与任务重试，保持平台核心不识别医疗病名或诊断前缀。更多边界见EVOMEDCLAW的T98章节。

## T96 当前接入规范（2026-10-27）

每种算法的规范可从算法详情下载，也可 GET `/v1/algorithms/{id}/contract`：包含资源要求、已支持任务的数据模板／版本、步骤及执行位置、业务输出规范、默认逐轮计划和适用的 Agent 协议 Schema。内容只来自注册插件，不含已登记资源或凭据。FoT保持paper-auto，仅需要数据与LLM；不开放外部Agent新任务。EvoMedClaw 1.1.0使用医疗Agent服务＋同方病例，中心不需要LLM。

**最少两方是任务整体要求，单个用户可仅登记并验证一组。** 在资源页上传／接入自己的资源，任务里统一选择自己与已共享可用资源；也可直接选择两组已有公共资源演示。资源组合只保存在任务配置，不把Agent嵌套绑定到数据。当前共用工作区的owner／shared元数据不构成真实账号隔离，两个公共服务由平台团队部署，不代表真实外部机构。

医疗服务沿用 GET /capabilities、POST /runs、GET /runs/{id}、POST /runs/{id}/cancel；业务步骤由算法定义：

| 步骤 | 输入与服务职责 | 输出给平台 |
|---|---|---|
| diagnose（独立评测） | 只处理eval病例，不提供参考答案；第1轮无共享记忆，其后须先通过load_memory确认 | 当前病例预测；experience报告含实际version与retrieved卡ID。不回传诊断轨迹；learn病例跳过 |
| learn（本站学习） | 一批本站learn病例和允许使用的参考诊断；服务独立运行原版诊断，本站编译卡片 | 一份clinical-cards精简更新、localCards／exportedCards数量；完整轨迹与卡库留在服务侧 |
| load_memory | 加载前轮共享记忆，按任务／本站隔离 | memory_receipt={version,round,sha256}及memoryVersion；版本或内容不符即拒绝后续评测 |

rounds表示评测轮次：第1轮diagnose→learn→aggregate；中间轮load_memory→diagnose→learn→aggregate；最后一轮load_memory→diagnose。至少2轮，默认2轮即一次聚合闭环；最后不生成未经评测的成果。最终经验由任务内load_memory自动确认启用，原/experience入口保留供主动导入。原/diagnose继续使用本站已加载记忆；平台应用invoke仍为成果＋LLM试用，不等于发布完整用户服务。

SDK0.2.4的StepDef.private_state声明外部服务只在本地保存kept。独立运行器校验脱去私有状态后的结果，再保存本站完整结果；运行状态查询不能带出轨迹。中心只保存预测、受控经验报告、加载凭据与精简更新。不能据格式检查证明任意第三方服务诚实使用经验，或证明文本已完全脱敏。病例目前仍先上传平台后按步骤发送，尚未实现远程数据引用。

接入验证每服务共用600秒预算，超时请求停止；任务连接检查仍保持5秒读超时。接入验证只需一个服务和一份符合learn／eval分组的数据：真实完成首轮评测、本站学习，中心用该方精简更新构造验证用共享记忆，再验证加载及后续评测。check-上下文不激活正式记忆、不保存本站轨迹，验证凭据持久化。创建任务只做快速连通性检查，无生成或Agent /runs。

以下为旧版本协议及接入历史，冲突处以本节和下载的当前规范为准。

T83／D80：用户流程为场景→算法→任务→资源。当前FoT使用数据与LLM，平台提供完整固定流程，新任务不支持外部Agent；EvoMedClaw使用病例与用户医疗Agent API。已有SDK适配契约不代表每个算法都开放所有执行方式，以注册表executionModes为准。

平台区分三类输入：数据文件、LLM 推理接口、能执行算法本方步骤的 Agent 服务。平台负责算法与规范、调度、共享产出、独立判分；外部 Agent 管理自己的模型和工具。普通聊天 API 只属于 LLM 接口，不能仅改名就作为联邦 Agent。

当前支持 FoT 数学推理与 EvoMedClaw 横向文本诊断。Agent 替代参与方步骤，中心汇总仍由平台执行；FoT 中心需要另选 LLM，医疗聚合不需要中心 LLM。每份数据默认使用同一 Agent，可在高级配置单独指定。不同来源的 task／site／round 状态分别隔离；共用一个 URL 不代表它们是独立机构。

## 当前职责边界（T82）

FoT由平台提供固定LLM流程，用户接入数据和LLM即可；FoT新任务不开放外部Agent。医疗任务要求接入方Agent，不能以LLM替代；平台提供联邦规范、编排、聚合和独立评测。插件包保留医疗本方实现作为接入方可复用代码及算法成果的应用运行时，不能因此把平台称为用户的医疗系统。

Agent保存后自动读取/capabilities（不计模型费用）；失败保留同一资源并在窗口原位说明。T94起在Agent资源页的接入验证执行所有本方步骤：FoT一题solve／reflect／extract，医疗一条learn病例和一条eval病例的diagnose，再执行learn；检测kept过程、预测一致性、经验结构／来源／轮次／版本。医疗经验允许空cards表示无可共享卡，但必须返回规范delta；测试仍需有实际发送的经验消息。接入验证单独检查所选Agent，不要求先创建联邦任务。每个Agent全部步骤共用300秒预算，超时后请求停止，未确认停止仍保留追踪；修正后由用户重测。报告持久化真实当前步骤、已完成项及开始／完成时间，刷新不重复请求。测试通过不代表准确率或隐私语义已经证明。输出JSON Schema和对应数据模板一并加入/agent-protocol下载。

T86：医疗任务统一选择可用Agent及同方任务数据，不按我的／共享分区；组合只保存在任务配置，数据资源不保存Agent。数据、LLM和Agent须先在资源页面登记并完成基础检查，任务页不提供现场登记入口。共享Agent和数据分别控制，共享不转移归属；新配置校验同方、不同Agent接口和共享状态。每组继续使用task_id／site_id隔离状态与经验，地址个数不等于机构数。当前共用工作区的归属标签不构成独立账号身份。

## 用户怎么接入

1. 数据资源上传匹配任务类型的 JSONL，上传时完成全文件格式检查；也可选择已有公用数据试跑。
2. 在 Agent 接口点击接入，可下载当前JSON协议与算法清单（`GET /v1/agent-protocol`），再填写名称、服务根地址和可选 Bearer 密钥，点击“检查能力”。密钥加密保存、不能读回，修改地址后旧密钥清除。
3. 新建任务依次选择场景、任务类型、算法、数据，执行方式选“自有 Agent”，再选择接口；需要中心 LLM 时单独选择。
4. 点击“测试配置”，确认会向所选服务发送样本并产生少量费用。测试检查文件完整性／规范、真实 LLM 请求、Agent 能力版本以及最小样本的完整本方流程；不会自动创建正式任务、经验库或应用。测试不测算法准确率，也不保证每个后续请求成功。
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

返回 `{run_id, status, result, error, retryable, error_code}`。error_code可选：diagnosis_incomplete／model_error／invalid_output，平台只将这三种代码映射为固定的修正建议，不展示任意远程错误正文。`retryable`默认false；只有明确failed且声明可重试时，平台才按算法步骤的重试上限重做；网络状态不明不据此重新提交。状态为queued／running／succeeded／failed／canceling／canceled。完成时必须有result：

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

## 接入方医疗系统：两个独立 API

`fedagent medical-serve --store <自己的目录> --port 9031 --name 医疗AgentA`仅提供EvoMedClaw能力、完整本方执行及直接诊断接口。第二个服务使用9032和另一目录。真实同机部署通过`--platform-model <已登记模型引用>`复用保存的LLM连接：两个进程与运行／经验库独立，模型连接及调用账本复用平台。此模式用于团队模拟接入方，不代表跨机构隔离。

独立环境可由接入方设置`MEDICAL_LLM_BASE_URL`、`MEDICAL_LLM_MODEL`和`MEDICAL_LLM_API_KEY`后启动，不传`--platform-model`。这些值仅由接入方在自己的环境配置；平台登记Agent地址，不接收Agent内部LLM密钥。该模式自有模型配置与账本保存在store/provider，独立进程和数据存储；仍复用SDK、网关和医疗算法代码，不假称使用不同模型或独立机构。团队同机模式不要求重新录入或复制已有密钥。

- `POST /runs`等遵守前述通用协议，诊断结果由具体算法的validate_participant_result再检查；同一地址不能声明自己不支持的FoT。
- `POST /experience`请求为`{task_id, site_id, artifact:{version,round,kind:"clinical-memory",content:<平台导出的医疗经验库>}}`。按任务和来源显式保存、启用选定经验，不允许覆盖同一版本或回退旧版本。
- `POST /diagnose`请求为`{task_id,site_id,case:<规范病例>,turns:12,use_experience:true}`。使用该范围已启用经验，返回diagnosis、trajectory、experience_version、usage；use_experience=false可在同API使用无经验路径。病例标注进入模型前剥离。
- 轮次执行收到的共享经验也在本方保存，始终按task/site隔离；最后一轮新成果需显式导入，不能把收到倒数一轮经验说成已自动加载最终版本。当前没有平台自动交付／启用用户Agent经验的按钮。
- 接入测试不激活经验或保存private_state，但幂等运行结果会留在runs.sqlite，包含诊断轨迹，服务运营者需按自己的保留政策管理。两个API只监听127.0.0.1；接入方可用MEDICAL_AGENT_TOKEN开启Bearer鉴权，非本机使用需配置受保护的内网代理。

实验室部署用medical-agents.sh统一启动／停止／查询；data/medical-model.ref是非密钥的模型引用，存在才启用两个服务，端口9031／9032，目录data/medical-agents/medical-a／medical-b。serve.sh随平台一起管理它们，backup.py要求四个服务全部停止后备份完整data目录；服务器重启仍需手动运行serve.sh，不添加开机或cron配置。

医疗任务及团队原API的默认问诊上限为本次真实验证的12回合，可在4–12内自行调整；这是上限，不要求每个病例用满。默认6回合曾触发未形成最终诊断，失败事实保留，增加上限也不保证每个病例收敛。

T94：POST /v1/agents/{id}/verifications 接收algorithm／taskType／datasetId／params，返回持久化报告，用GET /v1/task-checks/{id}读进度；Agent列表verifications包含报告与current准入状态。只读取/capabilities不代表已验证业务输出。新建任务的task-checks仅GET能力／轻量LLM路由，不再调用/runs；数据、接口准入仍由后端统一校验。

T96存储边界补充：private_state约束Agent协议响应，不回传完整轨迹。当前同机公共参考服务使用--platform-model复用平台模型，模型调用账本仍在平台数据库保存返回文本，因此不宣称实现模型日志隔离。独立用户服务可使用provider_platform的自有模型／独立数据库模式；上传病例也仍保存在平台。协议边界通过不等于完整隐私保证。

T96检索可观测范围：当前参考服务experience.retrieved报告本地医生轨迹中的memory_entry_ids；未汇总专科内部的memory_ids。空数组不证明全部子Agent均未命中，版本确认也不证明经验被引用或效果改善。

## 可选公开过程事件（T99，SDK 0.2.6）

新平台兼容不返回过程事件的旧服务。支持的服务在RunStatus中返回`events_available: true`，并提供`GET /runs/{run_id}/events?after=0`，与运行接口使用相同鉴权。响应`{events: [...], has_more: false}`，每页最多100条，seq从1连续递增。平台按持久游标续传，终态也拉取剩余页；查询不得重新执行任务。协议下载包含progressSchema。

每条事件：`seq`、UTC时间`at`、同一运行内稳定的`activity`、可选`parent`／`item_id`、短标题`title`、`status`（running／completed／failed）、短摘要`summary`及可展开的`detail`。标题≤120字、摘要≤500字、正文≤6000字，未知字段拒绝；item_id必须属于该次授权输入。相同动作开始和结束复用activity；重试采用新的运行编号，不覆盖原记录。公开动作不属于sent／kept／predictions，不能改变算法结果和判分。

**开启该能力代表服务明确允许平台持久化和展示该公开子集。** 仅发送可见的问答、检查请求／返回、路由选择、专家结论等业务动作；不发送评测标注、完整提示词、凭据、私有卡库或隐藏推理。第三方服务不希望公开病例正文时可只发阶段与短摘要，或不启用此能力。参考服务的资源接入验证不保存患者过程，正式任务才记录。普通接口不需要实现医疗专用路径。

T99完整资源接入验证总预算为900秒（15分钟），覆盖前后评测、本站学习和加载；超时仍取消并确认停止。创建任务的连通检查仍为5秒，不生成、不运行上述完整流程。
