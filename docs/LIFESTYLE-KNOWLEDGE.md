# LifeStyle 饮食／运动指导知识扩充（T147）

用户要求继续补知识。沿用“先准备数据，给出调用量后再确定”：本阶段零业务模型调用、不生成经验、不部署。补充的是公开机构指导，不是私人报告、医院病例或新的真实参与方。

## 实际准备结果

检查105个候选地址：92个成功，13个404；ODPHP的4篇先作为调研材料。其余88份固定HTML快照，排除4个目录、1篇正文不足、1篇含过时运动时长要求的资料，再隔离7篇与旧保留文档／主题同源的后续改写页，得到75篇文章。

| 发布机构 | 文章 | 完整知识小节 | 主要补充 |
| --- | ---: | ---: | --- |
| NIDDK（NIH） | 20 | 85 | 肾病、消化疾病的饮食限制，体重和活动管理 |
| NHLBI（NIH） | 3 | 8 | 心血管饮食与体重管理 |
| CDC | 16 | 61 | 活动强度、制定运动计划、健康饮食、标签和份量 |
| NHS | 36 | 191 | 食物替换、纤维／糖／盐、力量、柔韧、平衡与居家活动 |
| 合计 | 75 | 345 | 12类主题，饮食238小节、运动107小节 |

345个完整小节正文均不同。测验推广、视频占位及目录等不计为学习小节。不是345篇独立研究、病例、经验卡或医生审核结论。不将它与旧85条MedQuAD依据简单相加为独立样本总数：两者文档粒度、年代和表述不同，内容与主题仍可能重叠。

每个小节保留完整原文章、标题层级、列表、表格、适用条件、来源时间、地域及许可依据。按H2自然小节整理，不拆成一句一条凑数；超长、过短、目录、参考导航进入排除清单。已查看固定20个抽样小节，17个主题通过、3个仅保留上下文（概述、项目挑选问题、阅读说明），不进入学习单元。审核编号、文本摘要及理由在`review-policy.json`；这是Codex主题／提取检查，没有医学专家核验。主题通过不能覆盖保留集隔离；其余规则候选仍需生成前按实际用途检查。

预先设定首个Demo的准备目标：至少50篇、8类主题、200种完整小节正文，饮食和运动各至少60个小节。目前超过该目标，因此停止同类扩搜；这只表示足够开展第一批受控实验，不保证有效或满足临床应用。

## 来源、时效与使用边界

- [NIDDK饮食营养](https://www.niddk.nih.gov/health-information/diet-nutrition)、[NHLBI DASH](https://www.nhlbi.nih.gov/health/dash/living-with-dash)、[CDC成人运动](https://www.cdc.gov/physical-activity-basics/guidelines/adults.html)、[NHS饮食](https://www.nhs.uk/live-well/eat-well/)与[运动](https://www.nhs.uk/live-well/exercise/)是发现入口；逐篇原网址、最终网址、复制时间、SHA256和原文日期另存。
- 仅抓取许可允许的机构文字，保留版权例外，不采集第三方图片、视频、标识或NHS排除子站。[NHS条款](https://www.nhs.uk/our-policies/terms-and-conditions/)及排除页、[NIDDK版权](https://www.niddk.nih.gov/copyright)、[CDC材料政策](https://www.cdc.gov/other/agencymaterials.html)、[NHLBI规则](https://www.nhlbi.nih.gov/about/contact/trademark-branding-and-logo)与各站robots原档已留存。原文出处与生成建议分开；NHS改写／翻译用通用OGL署名，不继承NHS临床审核或认可。
- 保留英格兰／美国、人群和原文版本，不把不同国家／日期的数值自动合成通用标准。部分原文较旧或已过建议复审日期，不能把2026抓取日期当作临床更新日期；美国膳食指南已进入2025–2030版，相关数值未来生成时仍需逐项核对。
- 实际发现NIDDK 2017年活动入门页仍要求至少连续10分钟，已整体隔离；当前CDC明确任何时长活动都可有益。合理的“忙时做10分钟”示例不等于该过时最低要求，不误删。肾病、透析等条件性饮食建议保留限制，不能套到所有用户。
- 原有HealthBench全部对话、旧文档／主题保留边界及冒烟实验受保护。构建验证旧清单和所有输出哈希，缺失或损坏即失败。比较规范化网址、全文5词片段包含度和标题，识别改名资料并隔离保护集冲突；不是语义污染的绝对保证。既有训练重叠单列，不称作全新独立知识。正文阈值未能识别所有被改写的旧页，因此另按条件主题和文档系列识别后续版本：实际隔离7篇保留集冲突；保留的23篇与旧训练主题／资料有重叠，不能将它们算作独立新增来源。

## 正式生成前的规模和预算

建议首个任务仍只取30个不同文档的小节：NIH／CDC／NHS三组各10个，优先交替选饮食／运动，不人为补不存在的不同文档。来源组只是公开知识分区，不冒称三家医院。完整文章随每个小节送入，避免丢失限制条件。生成公开的合成建议过程后，沿用FoT提取／归类／建库，最终经验数仍由`paper-auto`决定。

| 首批步骤 | 正常路径调用数 |
| --- | ---: |
| 30条合成过程＋反思＋提取，归类与建库 | 92 |
| 同一24道固定HealthBench题：无经验／共享经验作答 | 48 |
| 原版341条有符号评分规则，两组逐条评分 | 682 |
| 合计，不含重试／探测 | 822 |

新池345小节全局一次生成算术为1037次，另全96题双组评测2614次；**不表示可以一次装入任务**，全量需额外批次与容量设计，不自动启动。首任务限制仍30条／最多90条解题经验，实际模型上下文预检后再运行，不为塞入全部知识改成另一种聚合算法。

首批生成输入的完整文章／小节／提示预留字符数及token情景区间见`call-estimates.json`。该区间只估生成输入，未涵盖全部聚合输入、评分输入、输出和隐藏token，不能据此当总账单。原24题评分／推荐成本假设见[LIFESTYLE-CORPUS.md](./LIFESTYLE-CORPUS.md)，换新资料后整体token估算需重新预检。尚未核实David AI单价，不给虚假金额。正式批量运行器与原HealthBench评分通道仍待预算决定后实现。

## 本机产物与复现

源码`tools/lifestyle/knowledge/`按下载、解析、旧边界、构建拆分；不改变旧T146准备工具／共同代码或生产依赖，不导入平台和模型。固定Python3.12.13及完整依赖版本，使用标准HTML解析器。下载串行且遵守robots和站点间隔；逐跳检查网址、限量读取，429／503停止并保留Retry-After，不绕过限制。正式构建完全离线。原文及产物在Git忽略目录`data/lifestyle-prep/knowledge/final4-20261118/`，Git只放工具、来源及审核元数据。

```sh
uv run --no-project --python 3.12.13 --with-requirements tools/lifestyle/knowledge/requirements.txt \
  python -m tools.lifestyle.knowledge fetch --directory data/lifestyle-prep/knowledge/new-run
uv run --no-project --python 3.12.13 --with-requirements tools/lifestyle/knowledge/requirements.txt \
  python -m tools.lifestyle.knowledge build --directory data/lifestyle-prep/knowledge/new-run
uv run --no-project --python 3.12.13 --with-requirements tools/lifestyle/knowledge/requirements.txt --with pytest==9.0.2 \
  python -m pytest tools/lifestyle/knowledge_tests -q
```

快照发生变化时哈希校验拒绝，须重新调研并更新清单／审核，用新目录重建，不能覆盖冻结结果。`prepared/`含文章、小节、排除／重叠审计、待审抽样队列、统计、预算和冻结清单。待审队列不是已审记录；实际已审20个编号单独版本化。验证与独立复核回执放`verification/`，不改冻结产物。

离线验收：新增25项及原27+7项测试、ruff通过；两次完整构建的8个文件逐字节一致、395个旧冒烟保护文件未变。Claude复核发现关键词分类、主题标签、审核条目失配、指纹依赖、改写资料保护边界和推广／视频占位问题，均已修正并补回归；终审回执存verification。业务模型调用为零，未部署。
