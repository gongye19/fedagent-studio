# LifeStyle 本地准备与测试

T145；本轮不部署，不连接真实 LifeStyle App，不收集私人报告，不发送推送。

## 目标和边界

用户提供公开或获授权的生活方式建议过程，平台提取并聚合可复用经验，应用结合个人情况回答饮食／运动问题。同一个问题与模型可以对比无经验和加载经验。现有医疗问诊不变。

当前使用三个**模拟来源方**，不声称接入三家医院：

| 来源方 | 生成经验的知识 | 画像 |
| --- | --- | --- |
| A | MedQuAD 的 NIDDK 糖尿病预防资料 | Synthea 合成成年人 |
| B | MedQuAD 的 NHLBI 高血压资料 | Synthea 合成成年人 |
| C | CDC 官方关节友好运动资料 | Synthea 合成成年人 |

来源入口：[MedQuAD](https://github.com/abachaa/MedQuAD)、[Synthea 样本](https://github.com/synthetichealth/synthea-sample-data)、[NIDDK](https://www.niddk.nih.gov/health-information/diabetes/overview/healthy-living-with-diabetes)、[NHLBI](https://www.nhlbi.nih.gov/health/dash-eating-plan)、[CDC](https://www.cdc.gov/arthritis/prevention/index.html)。具体下载 URL 与 SHA256 固定在 tools/lifestyle/sources.py，原始快照只留本机。

MedQuAD 的 CDC 子集不适合此任务，未勉强使用。MedQuAD 固定提交 `577bd37b96c02d1833b2c9eed2de9f96964e96cb`（CC BY 4.0，保留原始来源），只使用确有答案的资料；Synthea 样本固定提交 `84f59805d481b9f01f3141ef39e68bdbbeb80132`。Synthea 是公开合成病历，不将生成器的软件许可证直接当作所有源资料的许可证；不传播姓名、地址、证件等字段。官方页面按首次下载快照及哈希冻结，后续不静默更新。

仅抽取年龄、性别与相关慢性病记录；用药、偏好与运动能力未提供时写明未知，不编造检查或治疗收益。建议过程由模型参考资料生成，来源注明 `synthetic`、`modelGenerated` 和 `referenceUsed`，不能称为真实发生的问诊。

## 核心流程

公开源准备和去重 → 预先冻结不同人物／文档／focus 的训练与留出集 → 模型生成建议过程 → 正常上传与校验 → 三方 FoT 提取、归类、聚合 → 在隔离平台发布经验包 → 应用问答与对照。

FoT 复用现有 `fot-records` 的 `prepare / reflect / extract / collect / profile / library`，每条过程最多 3 条 trace，最终 `paper-auto`。未修改 FoT 核心实现或生成参数。领域输入和应用提示词属于新增适配，不声称论文已经在生活方式推荐上验证。**EvoMedClaw 本轮不扩展到 LifeStyle**。

原始记录目前仍由平台托管；这是集中托管的多来源经验聚合演示，没有实现差分隐私、安全聚合或原始数据不出站。

## 数据与评测契约

上传一行 JSONL：`id`、`input: {profile, question}`、`events: [{role, content}]`、`output`，可带 `provenance`。实际格式由任务类型校验，空过程不能上传；input 禁止未知字段和参考答案。模板入口沿用联邦数据上传页。

应用只接收个人情况与问题，用户不必提供标准答案；API 为兼容旧应用保留的 `answer` 在此应用忽略。独立评测文件保存有来源的规则，规则不进入应用作答。

首次试验固定每方 1 条训练记录和 1 个留出问题，只验证链路。三组为无经验、本站经验、三方经验；本站经验复用原有 collect/profile/library 对该站实际 trace 聚合，不伪造单方联邦任务。相同输入、作答模型和参数，仅经验上下文不同。每题各组顺序按固定种子打散，评审请求不含组别标识。逐项记录满足情况／理由，并单列安全规则未满足数。

只有三组都完成的案例进入配对平均、变好／持平／变差计数；调用或格式失败不计成错误答案。评分是模型辅助评测，并非诊断正确率、医生审核或临床健康收益。同一个模型自评、样本少、经验库大小不同、相关领域概念重合等限制都必须披露；不得挑选高分案例后声称总体提升。

## 页面与状态

沿用已确认的项目 UI 与 `ApplicationPage / UseLibraryPanel / Field / SelectField / Panel`，不新增视觉参考、依赖或样式体系。侧栏应用由任务注册表发现 LifeStyle，旧 `#/apps/lifestyle` 地址进入新应用；删除旧浏览器固定规则 mock，避免同时存在两个入口。

| 状态 | 界面／行为 | 下一步 |
| --- | --- | --- |
| 无记录／无包 | 简短空状态、既有上传／生成入口 | 上传合规过程，再生成并发布 |
| 可用包 | 经验库名称、算法、发布时间、使用入口 | 进入对应经验包 |
| 待输入 | 个人情况、问题、默认平台模型（可改） | 填完整后运行 |
| 正在回答／对比 | 锁定输入和模型、按钮显示进行中 | 等待同次请求完成 |
| 回答完成 | 两侧等宽、统一标题和回答层级，不显示标准答案或虚假的“正确” | 可改输入重跑 |
| 调用失败 | 原位错误，可再次运行 | 修复后重试 |

验收覆盖目录、上传、选资源、运行、发布、应用对比；桌面及窄屏检查字段、面板边界、按钮和结果对齐。批量评测先提供离线图表报告，暂不扩展医疗专属“联邦评测”界面或伪造医疗正确率。

## 扩充语料（2026-11-18）

用户最新决定先准备数据、看到调用量再确定正式运行。新的离线准备使用独立 `tools/lifestyle/corpus` 和 `data/lifestyle-prep/corpus/<实验名>/`，不覆盖以下旧冒烟命令和结果。实际数量、来源、限制、预算及准备命令见 [LIFESTYLE-CORPUS.md](./LIFESTYLE-CORPUS.md)。本次没有新增提取或评测模型调用，不部署。

## 本机命令

从仓库根目录执行，`uv sync` 在 `server/` 中执行。工具独立测试用 `uv run --project server python -m pytest tools/lifestyle/tests`，核心后端测试不导入仓库工具：

```sh
export FEDAGENT_LIFESTYLE_SSH_TARGET=poly-zhu@100.111.198.54
export FEDAGENT_LIFESTYLE_SSH_PORT=10022
uv run --project server python -m tools.lifestyle prepare
uv run --project server python -m tools.lifestyle run --model default:gpt-5.6-luna --limit 50
uv run --project server python -m tools.lifestyle serve --model default:gpt-5.6-luna --port 8891
# 另一个终端：
cd app
FEDAGENT_API=http://127.0.0.1:8891 npm run dev -- --port 8890
```

全部源快照、合成数据、上传文件、独立数据库、经验库、调用缓存和 `report.json / report.html` 位于忽略目录 `data/lifestyle-prep/`。不入 Git；更换来源／模型／算法代码时用新的 `--directory data/lifestyle-prep/<run>`，不能混用冻结检查点。新目录需要先 prepare。只允许一个实验进程使用同目录。

真实模型经现有 SSH 密钥调用服务器已配置网关，完整保留 FoT 的 max_tokens／temperature／top_p，不通过会强制参数的过程生成 HTTP 接口。明确固定 `接口id:模型名` 和解析身份，拒绝假模型及身份漂移；不导出 API key。远端不调用 Platform.create、seed 或迁移，不生成密钥／数据库／目录；要求现有数据库、密钥、并发锁目录都已存在。**远端仍会追加正常的模型审计记录**，不是完全零写入。

SSH 目标与端口由上述环境变量（或现有 SSH 配置别名）提供；仅有现成部署权限的维护者可运行此桥，不能作为公众通用模型服务。远端 Settings 读取现有出站 allowlist，保持网关连接策略。

调用前持久化预算，最多 50 次真实远程调用（含失败、格式修正），本机桥和远端网关关闭失败自动重试；成功结果按完整请求缓存。生成或判分的调用方校验失败时，将对应回复标为拒绝，保留审计；续跑仅重取该请求，不重算已完成过程和回答。供应商返回的快照／别名记录为 reportedModel，配置身份仍按固定接口与模型引用校验。不同请求最多两路，同一请求锁定去重。传输失败可能已在供应商计费，因此失败同样占预算。原网关针对流式协议不兼容的回退仍可能在单次网关调用内额外请求，报告的远程调用数不是供应商账单次数；以供应商账单为准。未配置单价时只报告实际 token，不推测金额。

## 兼容性与后续部署

SDK 新增默认 true 的 `application_grading` 能力标识，LifeStyle 关闭，其他应用保持原行为；版本提升为 0.2.10，并重生前端 API 契约。

`fot-records` 维持兼容产物格式的 1.0.0，新增 accepts；同一插件包目录改动会改变 FoT 和 EvoMedClaw 的 code_hash。已发布医疗经验包按版本校验仍可用；旧未完成任务恢复会因哈希变化暂停，**未来部署前必须审计未完成任务，不能覆盖冻结哈希**；部署预检会用候选插件指纹阻止不兼容暂停任务，同时保留既有执行中任务门禁。本轮只使用新建的本机隔离数据库，不恢复或修改旧任务。生产继续运行原提交。

## 2026-11-17 首次验证结果

- 3 方各 1 条公开资料生成的过程记录，3 个不同人物／文档的留出题；9 组回答和判分全部完成。实际 36 次远程模型调用，全部成功；输入 84,450／输出 39,906 token，模型 gpt-5.6-luna。未设置单价，不估算实付费用。
- 三方经验 8 条；A／B／C 本站经验分别 8／7／8 条，均由 paper-auto 决定。
- 三组逐项规则满足率均 100%，三方相对无经验变好 0／持平 3／变差 0；安全规则未满足 0。**只验证链路，没有观察到明确提升**，不能据此证明经验无用或有临床收益。
- 本机任务 `task-1fe560ab`、经验包 `app-3d481273`。结果和原始评审理由在忽略目录 report.json／report.html；来源、模型、提示词与检查点均保留。测试过暂停续跑，没有重复生成已完成过程。
- 后端 256 项、前端 83 项及工具 7 项测试通过；ruff／pyright／TypeScript／结构检查／构建通过。Claude Code 完整复核及退出持锁专项复核无待处理项。
- 本轮不部署；正常模型审计之外，生产任务、经验包、数据与模型配置未变。
- 浏览器实际验证上传后资源可选、应用默认模型、返回、等待锁定、503 原位反馈及重试；双栏宽度各 477px、顶边一致，390px 下字段和结果宽度均 324px、没有横向溢出。UI 使用同输入的已完成真实模型缓存，没有为截图新增调用。纯文本显示去除 Markdown 装饰，原回答与评测不改写。截图在本机 screenshots/。
- 本机临时预览为前端 8890、API 8891、报告 8892，仅监听 127.0.0.1；重新运行同一实验目录前先停止预览 API，它会持有实验锁。
