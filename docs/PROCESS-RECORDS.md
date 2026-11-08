# 过程记录与应用经验库（T110）

## 实时问诊对比的留出病例

医疗问诊应用中的「实时对比」使用 [MedAgentSim 固定版本](https://huggingface.co/ItsMaxNorm/MedAgentSim-datasets/tree/ad770a78ed4902f672548faf1a87abbbc18484bb) 的完整 `medqa_extended_v1.jsonl`。将原档保存到运行目录 `data/consultation-cases/medqa_extended_v1.jsonl`，SHA-256 为 `54a024eb2705c6c55d1988766adf4ab02ea7bbe2a28f843107b740032200f232`。旧运行从冻结配置读取病例。新运行和病例目录均使用完整原档，数据随运行目录备份。

原档有 214 条，前 107 条与原版逐条一致。先选经验包，再从可核验病例中搜索。筛除同一来源行、同一编号、去标注内容相同或病史高度相似的记录。两份正式包均排除了参与生成的 108 条，目前各有 106 例可选。以文件和病例匹配为核验口径，公开原档病例之间仍可能涉及相同疾病或相似临床线索。

医生从主诉开始，只能通过选择动作获取原档资料。标题、开场、检查项目及返回资料遮盖字面参考诊断。评分只用原档标注，待两栏都完成后，在各栏最终诊断下方显示判分与统计。

用户上传已经发生的问诊或解题过程，平台提取／聚合经验，供平台的医疗问诊、数学推理应用使用。无需 Agent API。LLM 可选已验证共享接口，也可在 LLM 接口页登记自己的接口。当前共用工作区，资源归属标签不是多租户权限。

通过校验的上传直接进入联邦数据目录，其他协作者可以在任务中选用。目录展示名称、类型、提供方、样本数等登记信息，上传内容由平台处理。Demo 请使用脱敏文件，平台执行时仍可读原文，并按任务配置调用模型服务。数据加密和账号权限另行实现。

## 文件规范

JSONL，每行一条对象；上传时完整检查，失败不保存资源。模板可在上传页获取，算法接入规范也直接展示字段。

| 字段 | 内容 |
|---|---|
| id | 文件内唯一记录编号 |
| input | 数学题目文本；或医疗病例对象 patient、objective、examination、tests |
| events | 1–200 条实际过程，每条 role、content 必填，stage 可选 |
| output | 实际最终回答，不是参考答案 |
| answer | 数学可选；医疗必填参考诊断，用于校验经验，不供应用作答 |
| provenance | 可选来源对象；本地生成器写入公开数据来源、文件哈希、索引、模型及生成标识 |

医疗 events 使用 doctor、patient、test、router、specialist 角色，至少含 doctor。EvoMedClaw 兼容原版 LocalDoctor／HospitalRoute／HospitalExpert 日志；检查、会诊、诊断动作的原始 content 采用 `REQUEST TEST:`、`REQUEST CONSULTATION:`、`DIAGNOSIS READY:`。会诊摘要沿用原版 Key Positive Findings、Key Negative Findings、Tests Performed 等分节，以保留条件触发依据。普通自由文本问诊可用 FoT；使用 Evo 时应保留上述动作与会诊结构，不把自由文本任意猜成完整医疗工作流。

只上传病例或题目不属于过程记录；不得把参考诊断藏在 input 中。单步内容最多 20,000 字符，最终输出最多 40,000 字符，单条总计最多 100,000 字符，文件最多 20 MB。生成数据不是真实用户操作或真实患者就诊记录。

## 算法适配边界

- `fot-records`：兼容两种应用，读取已有过程 → 原 FoT 反思、每记录最多三条提取 → 汇总、局部归类修正、paper-auto。每份过程只提取一次，不重跑原始解题／问诊，不设置迭代评测轮次。
- `evomedclaw-records`：医疗过程与参考诊断校验 → 按来源调用原版过程归一化、卡编译／技能归因／增量清理 → 原版签名聚合／记忆导出。完整过程已上传平台，不能宣称原始数据不离站。
- 发布经验库使用现有 App 存储与接口；应用类型与经验库实例在界面上分开。数学应用解题；医疗应用针对结构化病例给诊断建议与简短依据。Evo 应用沿用原版条件检索，从匹配分组取经验，最多引用六条，再供 LLM 回答；这不是原版多 Agent 交互式问诊运行时。
- 不更新模型权重，不承诺效果提高，不宣称复现原论文全部实验。新问题可分别不用经验／使用经验比较；评测数据不参与生成经验。
- 原 `fot`／`evomedclaw` 插件、旧任务冻结计划、旧评分及旧 Agent 接口 API 保留。新建入口只列过程记录插件，历史原始题库不能误选作新过程记录。新插件哈希包含所复用原插件代码哈希。

## 本地生成

`tools/process-records/generate.py` 是本地工具，不自动上传或开任务。用已存在的公开数学题库和 MedAgentSim 文本病例；不要向工具提交私有数据。模型通道只返回回答／用量，凭据留在平台。需要访问令牌时通过 `FEDAGENT_TOKEN` 环境变量传入，不写入参数或缓存。

```bash
cd server
uv run python ../tools/process-records/generate.py \
  --application math --model default --platform http://100.111.198.54:8880 \
  --source fedagent/builtin/math/AIME24.jsonl \
  --source fedagent/builtin/math/AIME25.jsonl \
  --source-url https://github.com/dixiyao/FoT --output /tmp/math-process-records
```

医疗用 `--application medical --source <公开病例JSONL> --source-url https://huggingface.co/ItsMaxNorm/MedAgentSim-datasets`；本地复用现有原版问诊桥生成实际对话／检查／会诊，不用参考诊断提示医生。成功调用按请求哈希缓存，完整记录按来源／模型校验后恢复；默认每份仅一条，另留下一条作为独立输入。缓存、过程正文和输入清单不进入 Git。医疗原版流程耗时较长；没有形成最终诊断时如实失败，不编造过程或完成状态。

将输出的 source JSONL 经数据资源上传／校验，再主动选择应用、算法、数据与模型，快速连接检查后生成经验库，发布后用 manifest 的 heldout 输入验证。小样本验收只证明链路，不证明泛化提升。

## T117 模拟问诊数据

站点 A 的 54 条沿用 MedQA 分组 1，站点 B 沿用 MedQA 分组 2 的 53 条，补入 `medqa_extended_v1.jsonl` 第 108 行。两份文件对应同一 [MedAgentSim 固定提交](https://huggingface.co/ItsMaxNorm/MedAgentSim-datasets/tree/ad770a78ed4902f672548faf1a87abbbc18484bb)。逐条记录公开文件名、哈希、原始行号和模型。

每个病例由 gpt-5.6-luna 一次生成结构化角色模拟，包含问答、检查、按需会诊及模拟诊断。参考诊断独立保存于 `answer`。两组共 108 条互异病例，均通过平台上传校验与 EvoMedClaw 轨迹规范化。问诊过程的检查覆盖来源、结构和字段，临床诊断准确性由后续评测衡量。

## T110 真实验收

当时，数学 FoT、医疗 FoT、医疗 EvoMedClaw 三条链路均已在实验室服务器通过；保留四份带公开来源标记的生成记录与三个经验库。任务及应用标识、独立新输入测试、条件检索结果、用量与备份见 [验收记录](./process-records-check.json)。
