# LifeStyle 全量444条提取（T150，进行中）

用户已授权使用T149保留的全部444条，并要求平台记录各数据源实际使用量。仍先本机执行，不部署，不重跑评测，不把生成过程冒称经验提取完成。

## 固定范围

| 数据来源 | 计划条数 | 层级 |
| --- | ---: | --- |
| NIH NIDDK指导 | 85 | 官方指导小节 |
| NIH NHLBI指导 | 8 | 官方指导小节 |
| CDC指导 | 61 | 官方指导小节 |
| NHS指导 | 191 | 官方指导小节 |
| MedQuAD | 85 | 历史推荐依据 |
| MedMCQA train | 14 | 可选支持知识，本次按“全部444条”明确纳入 |
| 合计 | 444 | 三层保留标签，不混成临床病例 |

MedQuAD内原始NIDDK／NHLBI等子集另记`sourceCollection`，不可把它与上方同名机构的指导数量重复加算。这里是六个数据来源分区，不是六家真实医院或真实外部用户。尚无私人报告或原始数据不出站的隐私联邦承诺。

来源固定`data/lifestyle-prep/dedup/final2-20261119/`，指纹`a45182c5f905ab9d1c95a83e0b94865b7d2e7151667de6bf8b4b8f0ec9b1db9b`；逐文件SHA、完整原始对象和444个编号／来源绑定均核验。不同适用条件的重叠仍保留，不称444条语义独立知识。评测、旧原文和已有实验不变。

## 阶段一：先生成合规过程

独立`tools/lifestyle/full/generation/`读取全部来源。三层分别提示：官方小节带完整文章、适用人群／地域／版本；MedQuAD保留完整历史问答；MedMCQA保留完整训练题、选项、答案与解释并提醒可能不适合作个人建议。输入明确未知个人资料，只有公开advisor说明，不造患者对话、检查或治疗效果。

本次六来源／三层使用统一协议，旧30条过程不作为本次新生成，也不跨目录导入其模型缓存。旧结果完整保留。同一批次自身的成功检查点及完全相同请求仍会复用，不重复派发。

准备时一次性检查全部444条，任何超限都列出编号并在调用前停止。包括`profile≤6000`、`question≤3000`、来源JSON≤4000字符，以及精确计算`len(json.dumps(messages, ensure_ascii=False).encode()) + 2200 + 1024 ≤ 131072`。不裁剪资料。该边界是本阶段操作限制，不是代理模型窗口声明。消息／参数／代码／依赖／插件和来源一起冻结，变更不得混用旧检查点。

真实模型仍为现有`default:gpt-5.6-luna`。生成正常444次，硬上限500次，含空回复、格式与传输失败；每单元最多两次失败。最多两路并行。某单元两次无效则标记终态，不替换／重跑；其他单元可以继续，但累计10个终态单元后停止新派发。非局部的连接、模型身份、预算、上下文或检查点问题立即停止新工作。账本仍为started的未结束调用会永久终止本批，程序拒绝重发或手改账本续跑；随后只能另行核对已计费用量，不提供恢复入口。已结束的传输错误可能已经计费，另计possiblyBilledFailedDispatches；不自动连续重试。操作者检查连接后再次显式run，可能在同单元两次／总500次限额内重新派发，不能保证供应商不重复计算。远程尝试数也不等于网关协议回退的HTTP请求数或最终账单。

首8条覆盖六来源、三层，待每条成功或达到终态后查看实际输出与失败，再显式续跑同目录；检查凭据同时绑定成功摘要和终态失败摘要。成功单元不重算，预算不重置。任何一条未成功都不能把后续任务标为“全部444条完成”。

离线来源统计区分`planned`、`generated`、`terminalFailed`、`pendingNotDispatched`、`pendingAfterDispatch`、`unresolvedDispatches`；上传／提取为0，最终经验数为null，直到相应真实步骤完成。运行中未返回的调用也用“未确认”计数，不伪造进度。

## 调用量与费用边界

准备输出每来源和层级的请求UTF8字节总量、中位数及最大值。当前444条消息合计4,408,168字节，最大37,044；输入token仅作每4字节1token至每字节1token的规划区间，约110–441万，非账单保证。基础输出上限976,800 token；500次硬限下输出最多1,100,000，输入字节上界18,522,000（最坏每次均取最长请求）。

只读查询确认平台默认接口单价未配置，因此不捏造David实付金额。费用须以供应商实际用量／账单和输入／输出单价核对。本阶段500上限不扩大旧默认50或T148的850上限，付费run入口仅允许固定run-20261119，不得重建目录绕开已花预算。

## 后续FoT与平台记录

生成不等于反思／提取／聚合。根据首批30条的真实输出和耗时，当前采用用户已确认的五批方案；每批不超过90条，分别保留原FoT经验库，不引入分层汇总或拼接库。[官方Luna说明](https://developers.openai.com/api/docs/models/gpt-5.6-luna)的1,050,000上下文token并不解决单次归类的输出长度和超时风险，David代理实际窗口也未返回容量信息。

阶段一不建平台资源或探测／发布。全部生成成功后，按五个互斥分区上传，每个来源共用来源标识，不额外重复上传六份完整数据。每来源的计划／生成／实际上传／参与提取的唯一条目数和trace数分别统计；最终经验数按批单列，不把444输入当成444条经验或按来源虚假分摊。

## 命令与验收

```sh
uv run --project server python -m tools.lifestyle.full.generation prepare
uv run --project server python -m tools.lifestyle.full.generation status
# 使用现有SSH密钥桥，地址通过环境变量提供，不读取或导出API密钥
uv run --project server python -m tools.lifestyle.full.generation run --take 8
uv run --project server python -m tools.lifestyle.full.generation run --continue-after-inspection
```

正式目录计划为`data/lifestyle-prep/full/run-20261119/generation/`，尚未运行时不能把此路径当作已生成结果。`prepare/status`离线零调用，`run`才创建模型。数据、缓存、用量和回执不入Git；代码／来源元数据／文档进功能分支。旧代码和生产服务不变，后续执行／实际结果在此追加。

## 生成阶段验收（2026-11-19）

20项新用例＋3项既有模型保护用例通过，ruff（server配置）及git diff检查通过。Claude三轮全量代码复核后的低风险项已修正，原生只读CLI最后定向复核PASS；该轮未获/tmp两份历史评审文件读取权限，按当前源码与本文核对，测试由Codex实际执行。首批预算／绑定／两路停止与收尾／格式失败／CLI显式检查均覆盖。

全部444条prepare零调用通过，正式生成输入指纹`75942e1103de928cbbb95b849e93e6d67b079271812531ffa1529737c92eb2ae`。旧T148 prepare零调用仍重放原指纹，2541个既有数据文件摘要未变。

全量单次聚合的输出风险已核算：旧30条／90trace归类实际5587输出token、105.178秒；以每条最多3trace线性规划，444条约82688token／1557秒，超过现有32768／600秒。90条一批约16761／316秒，仅规划估计，不是保证。用户已回复继续，执行5批各不超过90条、分别保留原FoT包，不实现新的汇总规则。证据在正式批次verification/aggregation-capacity.json。

真实生成已于2026-11-19 18:09 HKT启动，代码`acc9845`已推送功能分支；首8条均成功、无格式失败，人工查看全部实际输出后记录摘要并显式继续同一批次。后续完整日志在generation/full.log，来源状态在generation/generation-usage.json。当前仍在生成，未上传／未提取／未发布。未上线。

## 五批正式提取方案（用户已确认继续）

用户回复“继续吧”，按已展示的5批／各批保留经验包执行。以冻结的444个编号按5取模，89／89／89／89／88条，全部互斥且各含六来源；平台不另上传一份全量数据再重复上传分区。每来源共用一个来源标识、每批一份分区数据，通过正常API创建5个任务和各自经验包，不合并或分层汇总成所谓全量原版库。

独立`tools/lifestyle/full/federation/`，不修改正在运行的生成代码、旧实验或生产插件。生成全部444成功且无未确认调用后，冻结完整生成文件、分区记录、模型身份、执行代码及依赖。每批沿用真实`fot-records`：读取过程→反思→提取（每条至多3）→汇总→原归类与局部修正→paper-auto建库。原版允许个别条目提取0条，仍要求全部反思／提取单元完成；单列产生经验的条目、0条经验的条目与trace数，不在原算法之外强制补一条或无限重试。

整次含已花生成、五次探测、反思／提取／修正的远程尝试硬限1500；每批既有CachedModel上限不超过250，构造器850限制不变。批次开始时预留后续批次各`2n+3`，不足本批正常路径就在付费前拒绝；这是零重试下限，不保证余量足以覆盖全部修正。分配与已花账本持久化，成功／error／started均计入；禁止新目录或清账本增加额度。实际请求按序列化UTF8字节＋输出上限＋1024检查≤1050000，本地门槛不代表David窗口已验证；单次输出截断或超时仍可能失败，不能靠字节检查保证完成。

公共隔离平台由离线冻结身份初始化，模型桥仅向当前批次转发；完成批次恢复不构造真实模型、不再探测。DrainingEngine只加步骤线程收尾和失败单元快照，核心算法不改。故障用GuardStop/ModelUnavailable立即暂停并保留已有调用；先保存失败单元尝试数，避免原引擎将一个失败单元放回pending后丢失原因。任何异常先停派发，再等在途线程结束。

已结束的临时连接错误可由操作者检查SSH后显式`--resume-after-connection-check`续跑同批，构造器先核对同一远端模型身份，记录账本摘要和恢复编号。余下failed单元必须逐一匹配此前GuardStop快照：blocked无需新派发；ended必须在账本中有对应已结束error，且同请求连接错误少于2次；有usage的空回复／截断不计连接错误。reflect/extract走清单中的有限重试；profile/library清单重试为0，单次空回复或截断直接终止本批，aggregationRetries仅适用于插件已收到完整回复后的结构校验，不能恢复传输截断。仅重置其状态，不清零次数；原引擎自己复位的主失败单元也受独立账本同请求两次错误上限约束。未知started、身份／上下文／缓存／预算或算法格式错误不可按连接故障恢复。不自动连续重试。

来源实际使用数从平台Dataset、TaskSite、WorkUnit与trace核对，逐任务写入audit.lifestyleSourceUsage，并在source-usage.json汇总六来源与5批。planned/generated/uploaded/processedItems/reflectedItems/extractedUnits/traceProducingItems/zeroTraceItems/traceCount分别记录；最终库条数只按批显示，不按来源虚假分摊。平台本地桥缓存重放可能复用原usage，真实远程尝试与token以持久远程账本为准，不当作供应商账单。没有重新评测或上线。

```sh
uv run --project server python -m tools.lifestyle.full.federation prepare
uv run --project server python -m tools.lifestyle.full.federation run
uv run --project server python -m tools.lifestyle.full.federation status
# 仅在已结束连接故障、核对SSH后
uv run --project server python -m tools.lifestyle.full.federation run --resume-after-connection-check
```

五批代码复核进一步区分免费身份读取故障与真实身份变更：前者不更改prepared／interrupted状态、不覆盖先前连接根因，可原批重试；后者仍在付费前终止。每批必须包含全部六来源，准备时强制核对。

新批次先写入计划中的预期model.json，再由CachedModel实际读取远端核对；预置文件不是远端验证成功的凭据。身份漂移不能污染本批身份文件，且保持零付费终止。

## 本次续跑状态（2026-11-19 20:15 HKT）

从169条原检查点继续后，已真实生成382／444；来源CDC61／61、MedMCQA14／14、MedQuAD85／85、NHLBI8／8、NIDDK85／85、NHS129／191。385次远程尝试，382成功、3连接类error，无终态格式失败、无未确认started；剩余NHS62条中2条派发失败、60条未派发。874874输入／338377输出token为已返回用量，3条error可能已计费但未返回usage，不当作零费用。

12:02 UTC左右SSH链路失效，10022双栈连接超时、22拒绝；Tailscale节点在线，8880 registry返回200。两条在途请求已按既定超时收尾，生成状态interrupted，可待SSH恢复后同批显式续跑，未擅自重复派发或重置预算。已向用户请求从服务器控制台确认／恢复SSH。没有建立平台资源、没有开始FoT付费聚合或发布，不能称382条经验。证据verification/network-interruption.json。

五批实现补了完成态保护：复验失败只记录verificationError、阻止后续与整体complete，保留已完成／已发布事实，不把完成批次改成永久失败；恢复后可零调用重验。冻结生成目录前持有同一generation/.lock，不能在生成最后两次文件提交之间取到不一致快照。51项相关测试及ruff通过，最终原生只读Claude收尾复核PASS（此前三轮Companion完整代码复核的发现均已处理）。

生成全部完成并冻结到联邦inputs后，不要再执行生成侧run或手改检查点；只读status可用。最新51项验证及代码摘要在verification/federation-validation.json，最终评审在verification/federation-final-review.json。
