# LifeStyle 来源保真检查（T160／D137）

2026-11-26：已实现独立的离线字段契约、检查器、全量来源目录准备与验收。原版 FoT、平台核心、应用界面和历史结果不变；没有新模型调用、经验提取或部署。

这一步解决“可核对地发现信息丢失”，还没有证明算法的新输出能保留这些信息，更没有证明推荐效果变好。

## 具体检查什么

|内容|检查方式|
|---|---|
|适用人群、目标、行动、参数、例外与未知信息|与人工登记的参考字段比较，缺失或改写分别报出|
|参数的单位、时间范围、强度和目标性质|比较完整结构，不能只找到同一个数字就算通过；每周不能改成每天，群体目标不能改成个人起始量|
|来源与版本|来源正文及其元信息有摘要，输出必须绑定同一版本；支持片段经空白规范化后须存在于来源正文|
|中间经验到聚合产物的对应|聚合必须引用实际存在的中间记录，且选中的父记录确实包含相应字段|
|拆分与合并|允许多个中间记录分担字段，按整组覆盖检查；聚合不必机械复制每个中间记录|
|证据类型|指南、观测关联、流程策略分开；不能把观测关联改称因果效果或添加未登记的疗效字段|

协议为 `lifestyle-preservation/1`，仅在 `tools/lifestyle/preservation/` 中使用，没有注册成平台的新算法。模块按参考验证、阶段检查、人工夹具、验收和准备命令拆分，每个实现文件少于200行；无新增依赖。

三类字段契约已实现：指南行动、观测模式、流程策略。**本轮真实来源的人工参考只覆盖两条指南实例**；观测与流程策略只完成结构测试，没有假造CGMacros／LifeSnaps的有效推荐模式。

## 信任边界

人工登记的参考字段是检查器的信任边界。支持片段存在只能证明出处可查，不能自动证明这段话支持某个医学结论。代码不识别任意叙述的医学真伪、不替代独立专业审核。

`structurePreserved` 只表示已登记字段和对应关系符合规范。每份报告都明确：`narrativeValidated=false`、`medicalEfficacyValidated=false`、`platformAdmission=false`。自由叙述不能混进已核验卡片；未来应用的自然语言回答仍需另行评价。

字段采用严格的规范JSON比较，数值、单位和语义角色都要一致。尚不自动接受小时／分钟换算或任意近义改写；需要这类转换时，应先登记有依据的规范化规则。引用片段仅做空白规范化，不补写或猜测缺失原文。

## 用什么资料验收

- 444条既有来源全部复制进新的准备目录，来源编号与内容保留，逐来源计数仍为NIDDK85、CDC61、NHS191、NHLBI8、MedMCQA14、MedQuAD85。这是来源目录，不是444条新经验。
- 两条人工字段参考用于检查器验收：老年人有氧活动目标、糖尿病餐盘结构。它们是T159已见过的回归实例，不能作为新的效果测试。
- 运动参考复用444条目录中的既有来源；餐盘参考复用T147已保存的CDC原始HTML，单独标明来源与版本，不把它加算进历史444条。两份原档均与T159保存的文件摘要核对。
- 本次通过官方浏览入口复核了[CDC餐盘页面](https://www.cdc.gov/diabetes/healthy-eating/diabetes-meal-planning.html)。直接重新下载被403拒绝，因此程序使用已保存的原档；不把2026-11-26读取日期冒称网页更新日期。

8个正向结构控制、32个错误变体均按预期验收。这些正向记录明确命名为 `manual-control-*`，由人工参考构造，**不是FoT新生成的经验**。它们验证检查器允许正确的保留／拆分／合并，以及会拦截遗漏、改数、改类型和伪造对应关系。

旧运动／餐盘实例也已实际送入检查器。旧版产物是纯文本，没有新规范的字段与对应关系，结果为“旧格式无法结构化核验”，不是临床失败或新评分；没有替旧条目补造来源、重写内容或强行判通过。

## 文件与运行

正式本机产物：`data/lifestyle-prep/preservation/final-20261126/`，不进Git。`run-20261126/`保留早期开发阶段的只读产物，不作为当前验收结果。

|文件|用途|
|---|---|
|source-catalog.jsonl|全量444条已有来源|
|contract.json|三类产物的字段、证据类型与检查范围|
|references/|两条已标注来源参考；标注范围与非医学审核状态明确保留|
|manual-controls/|手工正向结构控制，不是生成经验|
|suite.json|正向与错误变体的逐项报告|
|legacy-diagnostics.json|旧格式实例的未核验状态|
|protected-before.json、COMPLETE.json|旧文件保护、产物与实现摘要|
|report.md、verification.json|验收摘要和最终离线核验|

```bash
uv run --project server python -m tools.lifestyle.preservation prepare \
  --out data/lifestyle-prep/preservation/new-preparation

uv run --project server python -m tools.lifestyle.preservation verify \
  --out data/lifestyle-prep/preservation/new-preparation

uv run --project server python -m tools.lifestyle.preservation check \
  --reference data/lifestyle-prep/preservation/final-20261126/references/older-adult-aerobic.json \
  --cards data/lifestyle-prep/preservation/final-20261126/manual-controls/older-adult-aerobic/aggregate.json \
  --stage aggregate \
  --parents data/lifestyle-prep/preservation/final-20261126/manual-controls/older-adult-aerobic/trace.json
```

准备拒绝覆盖，先写临时目录，来源或旧文件变化时不生成完成回执。复验重新检查来源目录、实现、全部产物、人工参考和控制结果；全程没有模型、SSH、HTTP或数据库调用。

19项相关测试通过，覆盖错数／单位／时间范围／强度、真假值混淆、非有限数值、来源片段缺失、来源版本变化、错误父记录、重复编号、参考对象误修改、生成期间输入变化、产物改动和CLI失败状态。

## 下一步边界

尚未修改FoT提示词或编写新的生成器。后续若做LifeStyle适配版，应让它输出这些可追溯字段，并用本检查器验证真实生成结果；保留原版作为基准，不能将适配版称作原版完全复现。

字段保真检查通过后，再固定新的学习范围、独立评测问题和调用预算。已有T151／T157／T158题目只作回归；本轮不能用控制夹具的通过率冒充经验收益或据此启动全量付费提取。

最终验收：实现提交`b2c8730`先推分支，正式目录已完成444条来源准备、2个人工参考、8项正向结构控制和32项错误变体核对；19相关测试通过。禁用模型、SSH、HTTP后的重复复验通过，6887个旧文件内容未变；T157／T158仍完整、账本调用分别保持60／38，实际aggregate CLI验收通过。验收回执在正式目录verification.json。本轮模型调用0，新经验0，无原算法或生产变更。
