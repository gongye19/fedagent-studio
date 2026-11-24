# LifeStyle 公开传感器数据准备（T152）

本次只下载、校验和离线清理，不上传平台、不部署、不调用模型。与旧444条知识及五包经验独立；这些观测记录尚未生成经验，也没有“最佳运动／饮食推荐”标签。

## 来源与实际范围

| 来源 | 原包 | 清理范围 | 当前可用规模 |
| --- | --- | --- | --- |
| [CGMacros 1.0.0](https://physionet.org/content/cgmacros/1.0.0/) | 657,187,340字节；官方SHA256校验通过 | 全部45人分钟表、基线、肠道及菌群表，餐图只校验引用 | 687,580行发布的传感器网格；1,706条有餐类别的记录；1,660条基本营养候选，其中1,535条无本次营养／图片质量标记 |
| [LifeSnaps记录6832242](https://zenodo.org/records/6832242) | 642,961,582字节；官方MD5校验通过，另记SHA256 | 全部7张发布CSV：日表、小时表、5类评分问卷 | 71人、7,410用户天；4,724活动分析候选天、3,550睡眠候选天，两者交集3,529天 |

LifeSnaps小时表原159,508行：69条完全复制合并，1组2条冲突隔离，保留159,437行。问卷分别BREQ92、PANAS268、人格50、STAI279、TTM94条，不能把它们当作不同用户相加。两来源的人数和身份分别维护，不跨来源匹配用户。

CGMacros的1,706条餐次按“餐类别非空的源行”计数。基本候选要求：严格有效的本地时间、已知餐类别、能量／碳水／蛋白／脂肪／纤维均为有限非负数，能量大于0。43条全零营养、33条纤维大于碳水、110条超字典营养范围、62条缺少有效图片引用、1条缺营养（标记可重叠），均保留原记录和原因；“无标记”不代表临床或营养师核验。其余46条非候选不是简单等于43条全零，另有零能量或缺纤维记录。

另有1,553行未填写餐类别、但带有营养／进食量／图片等字段，完整另存`untyped_meal_fields.jsonl`并计数；不能将这些图片或其他事件直接当作新增餐次，也没有静默丢弃。

活动候选要求步数非负、心率大于0、四类活动分钟齐全且合计不超过1440；零步但有心率仍保留。睡眠候选要求发布的duration大于0，入睡分钟大于0且不超过duration换算的分钟。候选不代表全天佩戴完整；时间范围外记录不臆断无效，也不靠补值变成完整用户天。

## 清理规则与边界

- 不插补、不生成合成记录、不擅自裁剪观测极值，不计算血糖响应或干预效益标签。每条记录保留原ZIP成员和源行号；合并的复制项保留全部行号，冲突在清理数值之前识别、整组隔离。
- 两路CGM独立保留。Libre原生15分钟、Dexcom原生5分钟；发布CSV是包含插值的分钟网格，687,580行不是同等数量的独立实测。时间已移位／无时区，不转UTC或推导实际星期。
- METs原值与除10后的值并存；Intensity、Steps、活动消耗分别存储，不互相代替。体重磅转kg、英寸转cm，十进制定点保留8位、半偶舍入，原值仍在。缺少整列与单元格空白分别统计。
- `Amount Consumed`存在百分比、小数／份数样式及混合取值。只保留原文本和每人未确认的量纲状态，不将1自动当1%、不将900改9、不乘算营养摄入量。
- 字典明确错误的LDL=800、VLDL=400在清理数值中置空，审计及原值完整保留。血糖超40–400、Cho/HDL=400只标记、不删。HbA1c字典单位与数值存在疑点，保留原值、标明未解决，不盲目换算。肠道表多出的24／25号保留并标记没有主研究传感器数据。
- LifeSnaps的calories是能量消耗，不能当食物摄入；sleep_duration毫秒转分钟，minutesAsleep已经是分钟；sleep阶段ratio是当夜相对本人近30天均值，并非阶段占比。年龄、BMI区间和列表字符串保留分类语义；distance单位未确认，保留原文本。
- LifeSnaps数值规则单独冻结在`lifeNumericBounds`：计数／时长／消耗等有限非负，温度变化允许负数；血氧／效率／压力分限0–100，三个组成比例限0–1。数学取值域无效的单元格置空并在审计保留原值，不按观测极值截尾。296个压力分0保持原值、只标记含义未确认，不能当成“没有压力”。
- 小时表的心率分区分钟来自重复的日级数据，不可跨小时求和。重复本地小时未带时区依据时，不推断夏令时成因，不平均冲突。7,410天中2,501天在作者notebook列出的两个名义活动窗口外，单独标记、保留；原日表不据此截断。
- LifeSnaps六个BSON／metadata成员（约9.7GB未压缩数据的大部分）完整保存在原ZIP，本次不解析BSON。所有CSV已清理，不宣称所有高频流也已清理。CGMacros餐图同样保留在ZIP，不重新编码。
- CGMacros数据页许可为CC BY-NC-SA 4.0，官方LICENSE.txt为空也如实保留；LifeSnaps元数据许可CC BY4.0。清理产物附署名与相应许可说明，只在本机研究准备，不放进平台公用资源。

规则文件在[policy.json](../tools/lifestyle/sensors/policy.json)，来源／单位证据为下载的小字典、数据页、Zenodo元数据与作者预处理notebook。LifeSnaps数值边界及餐次范围直接读取该规则文件，避免说明和代码各写一份。各项原包及13份具名依据文件摘要随manifest保存，缺少具名依据即失败，Finder元数据或编辑器备份不进入内容版本；官方LICENSE.txt与本地CGMacros-LICENSE.txt显式对应校验，四份CSV字典已完整取得，未重复下载的DataDictionary.pdf在manifest标明未下载，其余清单文件缺失即报错。下载时未保存原GET响应头，另有下载后HEAD快照，二者不混称。

## 文件与复现

本机根目录：`data/lifestyle-prep/sensors/run-20261124/`（Git忽略）。

- `raw/`：两个只读原ZIP、官方校验清单、字典、许可／元数据／作者notebook快照。
- `prepared/`：正式清理结果。CGMacros的`sensor_grid.csv`、`meals.jsonl`、`untyped_meal_fields.jsonl`、`participants.jsonl`、两张菌群／肠道表；LifeSnaps七张清理CSV及`user_days.jsonl`。
- 输出公共部分：`summary.json`、源行对账`source_rows.json`、逐字段缺失／异常`quality.json`、字段对应`field_mapping.json`、`issues.jsonl`、`quarantine.jsonl`、成员清单、署名与许可、冻结规则、manifest及完成标记。
- `verification/`：下载回执、全包CRC、原始探查、旧数据保护摘要、独立复核、测试及两次重建对比回执。`prepared-v1/`至`prepared-v4/`是检查过程版本，正式使用以上`prepared/`。

工具独立放在`tools/lifestyle/sensors/`，没有服务／网关依赖、无新增第三方包。单条命令从已有原档构建：

```bash
uv run --project server python -m tools.lifestyle.sensors \
  --raw data/lifestyle-prep/sensors/run-20261124/raw \
  --out data/lifestyle-prep/sensors/run-20261124/prepared-new
uv run --project server python -m pytest tools/lifestyle/sensors_tests -q
```

目标目录及`.partial`均不得已存在。工具先重算官方摘要／本机SHA256、核对单位许可证据、检查ZIP路径／重复名／体积／CRC，读取CSV但不解包大文件。输出先写新`.partial`，所有文件摘要和完成标记写好后原子改名；原包、代码、证据和规则共同绑定内容版本。构建时间不写入确定性产物，失败目录不冒充完成。

最终验收：38项自动测试通过，ruff检查／格式和差异检查通过，Claude Companion最终独立复核无可操作问题。真实原档两次全量构建23产物摘要及manifest逐字节一致、55表源行对账和候选独立重数通过，6,068个既有数据文件未改。回执`verification/validation-final.json`及`review-final.json`，内容版本`a15df5f38c7d8cb59a1d499909a6a6ae5648af218deef7456d149dee88b89338`。没有平台模型调用、上传或部署。

下一步应先定义明确的推荐问题、餐后响应／活动结果指标和按人的留出验证，再决定经验提取方案与调用预算；不能把这些观测数据直接解释成“这样推荐一定更好”。
