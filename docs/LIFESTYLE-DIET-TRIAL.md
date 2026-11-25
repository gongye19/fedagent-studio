# CGMacros 饮食推荐经验小试（T156）

用户要求调整后再跑一轮。上一轮13条经验主要解释CGM计算，不能用于证明饮食推荐改善。本轮另建实验，不改变T155计划、代码、源文件、账本和结果，也不上线。

## 实验定义

- 沿用已冻结的CGMacros三模拟站点各2条学习餐食及6位不同留出用户；不把三站称为医院，不混入LifeSnaps。
- 先基于学习餐食的历史观测、画像及官方一般饮食依据，让模型生成6份实际饮食建议。完整保存响应，标明模型模拟过程；观测不等于“某项推荐已有效”，不伪造干预或医生。
- 通过既有LifestyleRecords校验、正常上传API及原fot-records引擎执行prepare／reflect／extract／collect／profile／library。paper-auto和每记录最多3条不变。只发布到当前实验的隔离本机平台库。
- 留出输入只有画像、日志营养与餐前活动，无本餐CGM及未来结果。不要求模型猜iAUC；问题为下一餐怎么安排、还要留意什么。
- 无经验／加载经验两组模型、问题、解码及公开依据相同。新增经验最多4条完整正文、总12,000字符，固定输入词项检索；不从评分或参考检索，不裁掉条件。
- 每例4项实用标准（具体安排、事实适配、摄入核实、观察步骤）与4项安全边界，付费前冻结。3批各2例匿名X/Y盲评，顺序平衡，同模型评分；通过的实用项及失败的安全项须有回答原文证据。
- 分别报告实用性和安全项通过比例、6例好／平／差及全部配对回答。它们是小样本推荐质量代理，不能当临床准确率、真实降糖效果或独立医生审核。两组都有官方一般知识，测的是新增经验的边际作用。

## 来源与预算

CGMacros使用T153冻结源`e4820d0b…`，全部来源和匿名参与者隔离核对沿用原数据清单。官方依据2026-11-25实读后简短转述并冻结URL：

- [CDC Diabetes Meal Planning](https://www.cdc.gov/diabetes/healthy-eating/diabetes-meal-planning.html)：一般餐盘搭配、实际份量和个体化目标。
- [NIDDK Healthy Living with Diabetes](https://www.niddk.nih.gov/health-information/diabetes/overview/healthy-living-with-diabetes)：结合健康状况、可持续调整与专业支持。

正常36次：6份建议、15次原FoT（含探针）、12份回答、3次盲评。整轮硬限40次，失败和修正也计入；为后续回答与评分保留预算，不自动扩大。未知结果的网络失败停止，不自动重发；明确完成的上游错误和格式错误只允许既有有界重试。单元完成值必须与实际模型缓存完全匹配；完成重入全部离线。

模型仍通过临时SSH复用连接调用服务器现有网关，密钥不离开服务器；不改生产配置、并发或接口。用户此前明确暂停Claude review，本轮遵循，采用本地端到端测试、缓存回证和只读SQLite核验。

## 命令与产物

在仓库根目录设置既有SSH目标和端口（`poly-zhu@100.111.198.54`／`10022`），不设置或复制模型密钥。

```bash
uv run --project server python -m tools.lifestyle.diet_trial prepare \
  --directory data/lifestyle-prep/diet-trial/run-20261125 \
  --source data/lifestyle-prep/sensor-samples/run-20261124/prepared
uv run --project server python -m tools.lifestyle.diet_trial run \
  --directory data/lifestyle-prep/diet-trial/run-20261125
uv run --project server python -m tools.lifestyle.diet_trial verify \
  --directory data/lifestyle-prep/diet-trial/run-20261125
```

prepare只检查身份、冻结输入／规则／代码，不付费。run才派发；STOP后不会自行恢复。report.json／report.md保存全部比较及评分依据；meter保留所有调用与错误。全部数据、响应和数据库在忽略目录，不进Git。此次不涉及前端、生产部署、全量836条或LifeSnaps。

## 执行记录

实现和测试先完成再提交到功能分支；真实调用及结果在运行后补记，不提前宣称改善。

运行前148项相关回归通过；最终保护集校验调整后新15项再次通过。ruff／格式／差异检查通过，T155原试验禁用模型后离线复验通过。未修改任何既有算法或共享运行工具。

2026-11-25真实运行：实现`eca1997`已先推功能分支，冻结计划`42e48e73…`。6份学习建议完成5份（A/B/C为2/2/1）；10次派发5成功、5次明确的上游error，失败usage未知，不能按免费计。第6份连续两次上游错误触发持久化单元上限，作业停止，不自动重试或提高40总限。

服务端只读审计找到同请求哈希的全部10条调用，与本机状态一致；五次错误延迟1.16–1.37秒，均为“模型接口返回错误”，不是SSH超时。网关未保存SSE错误详情，不能断言具体通道／额度原因。未增加付费诊断。原FoT尚未开始、无新经验包／对比结果；5份成功建议仅是学习过程，不叫已生成经验。6,604旧文件哈希复验未变，停态重入禁用模型且没有新增调用。没有部署或改生产服务。

本机`data/lifestyle-prep/diet-trial/run-20261125/`保留inputs／generation／meter／STOP.json／run.log、`stopped-summary.md`及`verification/{server-audit,stopped-audit}.json`。不要删除STOP、清除失败次数或新建同一任务绕过重试限制。后续先解决模型上游错误，再明确恢复规则和预算；即使余下全成功，原正常流程仍需31次，现有30次余额不足，不能自动扩限。

## T157：明确续跑后的过载修复

用户要求“继续啊，修复好”，授权继续本轮小规模实验。先备份T156完整目录，诊断重用第六份原始请求，作为原账本第11次派发；具体SSE错误为`upstream_error: Our servers are currently overloaded. Please try again later.`，说明上游服务器过载，非SSH超时。该次同样失败、用量未知，照计次数。

修复只作用于本轮SSH子进程及实验工具，不部署或修改线上网关：安全观察钩子保留上游错误类型，密钥／授权／URL脱敏；所有真实请求串行，确认过载后共享45秒退避。每个相同请求最多4次新的过载失败；其他错误及未知传输结果不按过载重试。仍保留原引擎格式重试、原FoT提示词、模型、样本、评分和paper-auto。

真实恢复已完成全部6条反思／提取、18候选→10条最终经验，本机发布；12份留出回答已齐。首次评分两次返回均有可核对的片段引文，但连续原句校验误拒绝。新增独立引用适配：片段必须逐段逐字、顺序一致地出现在回答中，随后还原覆盖它们的完整连续原句（包含被省略的条件／括号说明），再交原严格评分解析器；不改规则、pass值、提示词、问题或原响应。

只离线接受最早的可验证原始评分缓存，保留两次格式失败、两份原始评分、全部12回答及54条账本。独立恢复修订绑定旧凭据／STOP和新实现，原STOP不删；评分第1批不重新调用，只补第2、3批。累计上限仍60。新增验证涵盖改数值／否定词／顺序／编造引用拒绝，及离线接受后仅补两批评分、已有回答零重算。最终结果后补。

后续第2批两次评分均在病例对象边界漏同一个闭合括号，中间另有一次明确过载（截至57次派发）。增加极窄的语法适配：只允许在字符串外、下一`id`病例对象前补一个`}`，且必须存在唯一可解析修复；之后仍完整校验病例ID、X/Y、8规则、布尔值与全部引用。没有增删任何评分值、规则、文字或病例。保留两份原响应与57条账本，离线接受最早原评分，原STOP及前次凭据继续保存，只再调用最后一批。35项当前专项通过，包括数值／否定词／顺序、不可修JSON拒绝，以及两次离线修订后只补最后一次评分。模型请求／原FoT／评分提示及60上限均不变。

独立`recovery.json`绑定原计划、11条账本前缀、五份成功回复／缓存、失败单元、STOP及新代码指纹；原文件不删除／清零。第六份建议写入新的恢复单元。用户明确续跑后本轮累计硬限60，包含旧10次、诊断1次及后续全部失败／成功；仅本次有效，不改变普通小试默认40，也不扩样本。新的未知失败或四次持续过载仍停止，恢复失败另存`recovery/STOP.json`，不会覆盖历史STOP。结果及真实调用后补。

```bash
uv run --project server python -m tools.lifestyle.diet_trial prepare-recovery \
  --directory data/lifestyle-prep/diet-trial/run-20261125
uv run --project server python -m tools.lifestyle.diet_trial run \
  --directory data/lifestyle-prep/diet-trial/run-20261125
```
