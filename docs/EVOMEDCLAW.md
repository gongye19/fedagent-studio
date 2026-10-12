# EvoMedClaw 接入调研

调研时间：2026-10-12。来源：[官方仓库](https://github.com/xschen-beb/EvoMedClaw)。本地完整克隆在 `/Users/han/Desktop/code/polyu/EvoMedClaw`，本次核对 main 的 `ae333ec635fac5900d2b9f4455080444d28c0392`；上游源码未修改，独立 `.venv`，MIT 许可证。平台尚未安装或登记此算法。

## 项目实际做什么

它是医疗诊断 Agent 的运行与学习工作区。本地医生与病人交互、收集证据、请求检查；需要时经过科室路由、单／多专家会诊及跨科仲裁，再由本地医生形成结论。运行日志转成可复用的诊疗过程记忆卡，站点只导出精简更新，中心聚合全局记忆库，供后续诊断检索。

这里演化的是文本记忆与技能卡，不是神经网络权重。模型训练／蒸馏、在线会诊和站点聚合应分别接入平台步骤，不能把整个 CLI 当作一次不可观察的调用。

## 横向与纵向：已确认的实现边界

| 方向 | 当前代码依据 | 平台接入结论 |
|---|---|---|
| 横向的跨站点记忆共享 | `federated/site_round.py` 生成本站增量；`aggregate.py` 按卡签名合并支持、helpful／harmful等计数；`demo.py` 支持真实站点目录 manifest，也支持单目录轮流分片的伪站点 | 可以作为第二个算法的第一阶段；必须使用真实站点执行与消息边界，不能把伪站点分片当实际联邦 |
| 医生—医院／专科异构协作 | `runtime/department_first/core/runtime.py`、router、specialist、arbiter 与 parallel_merge | 是可复用的会诊协作基础；角色分工不自动证明已实现纵向联邦 |
| 独立纵向联邦 | 本次完整 main 源码检索没有纵向入口、患者／实体对齐、特征按参与方分割或独立 VFL 协议；horizontal／vertical关键字仅有CSS resize | 当前不能登记为“纵向可运行”。需要作者补充对应分支／实现，或先明确本项目的纵向定义与数据分工，再实现适配 |

以此 pinned main 为准，不把用户提到的两场景当作已经核验的事实。平台纵向入口继续保持规划中。

## 代码导航与数据

| 模块 | 关键文件 | 作用 |
|---|---|---|
| 入口／可控模块 | `cli.py`、`runner.py`、`presets.py`、`skill_registry.py`、`runtime/skill_runtime.py` | full、local_only等消融配置；模块目录中的SKILL是算法输入资料，不是本平台开发指令 |
| 在线诊断 | `runtime/department_first/runner.py`、`core/runtime.py`、`core/specialist_agent.py` | 病人、医生、检查、专家、仲裁与评分角色；逐阶段日志 |
| 输入加载 | `runtime/department_first/standalone.py` 的 ScenarioLoader／StructuredScenario | MedQA、MedQA_Ext、NEJM、NEJM_Ext、MIMICIV；仓库不含这些实际数据文件 |
| 轨迹／学习 | `learning/trajectory_loader.py`、`trajectory_canonicalizer.py`、`card_compiler.py`、`retrieve_trace.py`、`skill_attribution.py` | 从 `scenario_result.json`＋`dialogue_history.json`（可选consultation_history）转成轨迹和过程卡 |
| 本站联邦更新 | `federated/site_round.py`、`sanitize.py`、`signature.py`、`types.py` | 本站轨迹与卡库留本地；导出卡签名、触发条件、目标动作／诊断方向与统计 |
| 中心聚合 | `federated/aggregate.py` | global_card_bank、global_memory_bank和aggregation_report |
| 持续共演化 | `runtime/overlay.py` | 启用此路径需要外部MedAgentSim；根路径解析在模块导入时进行，缺少时抛RuntimeError |

文本病例并不是现有数学JSONL。StructuredScenario需要`OSCE_Examination`下的`Patient_Actor`、`Test_Results`、`Physical_Examination_Findings`、`Objective_for_Doctor`与`Correct_Diagnosis`。应新增医疗诊断任务类型、独立校验与评分，不能直接复用数学判分或给数学题库改场景。评分标注仍只供任务评估，不能作为医生／专家提示输入。

NEJM有图像路径和答案项；现平台的纯文本模型协议不足以宣称已支持它。MIMICIV等输入需要单独准备合适数据与授权，当前调研未下载或上传真实病例。

## SDK 与运行适配建议

第一阶段新增医疗诊断任务类型和横向记忆演化插件：参与方在本站运行诊断及学习，汇出经过校验的site_delta；服务端聚合；全局记忆库下发供下一轮使用。原始病例、对话、轨迹和source_cases保留私有站点状态；平台进度、日志和产出由步骤真实上报。对齐基线与后续记忆增强的诊断指标，完成一条真实小规模链路后再扩展纵向。

上游直接创建OpenAI客户端、自己解析provider配置与统计token；适配时将调用接入平台StepContext／模型网关，统一密钥、限流、重试、取消及账本。病例级诊断过程有多个内部回合，平台联邦轮次是记忆发布／回用轮次，不能将二者混用。模型角色较现FoT的client／server配置更多，先用平台已有接口完成明确映射，再按确有需要的角色配置扩展。

现在Algorithm清单只绑定一个scenario。如果后续两个方向都落实，使用两个场景绑定／插件入口共享EvoMed核心；不把一个横向manifest重复塞进纵向目录，避免重复实现业务和错误标记可用。

## 接入前需要修正或验证的点

- `card_compiler._score_card`为正确轨迹填固定`heldout_lift=0.1`；聚合中的heldout_lift也由本地统计比值构造。这不是实际留出集效果，平台只能显示独立评测的诊断指标，不能据此声称准确率提升。
- site_delta删掉entry_id、source_cases及自由解释，但触发条件、target_action和target_diagnosis_shift仍是文本。`runtime/privacy.py`有脱敏和噪声帮助函数，不能据其存在宣称联邦路径已经提供安全聚合或完整差分隐私保证。适配时必须校验真正离站的字段。
- 当前聚合按签名分组；需要去重同站点／同轮更新、绑定算法版本和轮次，避免重试重复计数。上游主要按文件目录运行，平台需提供任务持久化、步骤检查点与中止语义。
- 本次可运行路径是`--no-coevolve`的独立诊断和确定性轨迹／聚合。默认共演化不能在缺少MedAgentSim时直接承诺可用。
- 上游setup.py要求Python≥3.10，安装依赖只有openai／pyyaml且未固定版本；本地隔离验证用Python3.12。正式插件应锁定兼容依赖、保留MIT归属，独立核验上游测试及真实模型接口。

## 本次实际验证

完整克隆与源码定位完成，`python -m evomed`和独立editable安装可用；上游CLI／Web品牌／README一致性5项测试通过。另用单条明确合成的OSCE输入、所有角色指定mock、禁用coevolve运行诊断，生成实际日志；复制为两个合成站点，通过manifest、min_sites_per_card=2完成site_delta→中心聚合，产出2张全局卡及运行兼容记忆库，验证导出不包含entry_id／source_cases／minimal_rationale／scenario_id。

这些是接口与文件链路验证，未调用真实医疗模型，不代表临床效果，也没有完成平台插件接入。证据暂存`/tmp/fedagent-evomed-research/`；原始源码与许可证在上述本地克隆中，长期接入依据为该文档与固定提交的源码链接。

官方来源：[运行与总览](https://github.com/xschen-beb/EvoMedClaw/blob/ae333ec635fac5900d2b9f4455080444d28c0392/README.md)、[联邦说明](https://github.com/xschen-beb/EvoMedClaw/blob/ae333ec635fac5900d2b9f4455080444d28c0392/federated/README.md)、[站点步骤](https://github.com/xschen-beb/EvoMedClaw/blob/ae333ec635fac5900d2b9f4455080444d28c0392/federated/site_round.py)、[聚合](https://github.com/xschen-beb/EvoMedClaw/blob/ae333ec635fac5900d2b9f4455080444d28c0392/federated/aggregate.py)、[输入格式](https://github.com/xschen-beb/EvoMedClaw/blob/ae333ec635fac5900d2b9f4455080444d28c0392/runtime/department_first/standalone.py)、[MIT](https://github.com/xschen-beb/EvoMedClaw/blob/ae333ec635fac5900d2b9f4455080444d28c0392/LICENSE)。
