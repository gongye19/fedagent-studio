# CGMacros 观测经验小试（T154）

用户确认先做最小真实试验，不跑全量、不部署。分支 `feat/lifestyle-sensor-trial`；独立工具 `tools/lifestyle/sensor_trial/`。原444条实验、CGMacros／LifeSnaps清理及样本产物保持不变。

## 固定输入与方法

- 固定 [T153 样本](./LIFESTYLE-SAMPLES.md)版本 `e4820d0b02a4f95c755f4e6af607534609e724ca41411f8b2ed92712ef28270b`，manifest SHA256 `b156b96ef109fb7e102766a47d99ac2614d2bd3ed185e45815113f7e819148ad`。读取原预算 `proposals.cgmacros.smoke`，不另挑容易的病例。
- 三个模拟站点各2条公开餐食／CGM观测，6个不同留出用户。全部学习用户与留出用户隔离。模型输入只有静态画像、日志餐食和餐前活动；该餐的血糖、结果、参考文件和身份不进入预测提示。
- 训练记录是数据读取／既有CGM计算的确定性模板，不冒充真实Agent问诊，不用模型先编解释；provenance明确原始来源、模板和模拟站点。
- 通过既有 LifestyleRecords 校验与正常本机 API 上传，调用原 `fot-records` 的 prepare → reflect → extract → collect → profile → library，并发布本机应用快照。`paper-auto`、每条至多3条、聚合重试5次不变；允许单条0经验，要求全部记录处理完成、最终库非空。
- 预测适配器是独立本地实验，并未接入线上推荐界面。两组同模型、温度0、输出上限1800；独立无状态请求，只差有无经验。按排序后的病例下标交替组别先后，避免所有无经验先跑。
- 检索只看输入字符串值，排除固定状态文案，不看ID、参考或未来结果。最多4条、键和正文共12000字符，整条保留。超长跳过，无一可用则停止；无词项命中按稳定顺序回退。库较小时可能全量使用，逐例记录实际行为，不宣称语义检索。

## 预算与失败行为

正常27次：连接1、反思6、提取6、归类1、建库1、六例两组预测12。全部请求共用 `meter/attempts.json`，硬上限40。算法阶段预留12次，最多28；算法终态及原生成果校验通过后才串行评测，为其余正常回答保留额度。

原FoT内部和框架重试不改，均计入上限；仅预测单元最多2次格式尝试。完整返回但格式不合法或截断计费并可有限重试。任何未确认完成的 `started` 或没有usage的传输错误阻断作业，不自动网络重试或清账。成功请求、工作单元和预测检查点重放；不可恢复的算法失败保留，不另建付费重跑。

模型配置只通过现有SSH桥读取身份及调用，密钥不出服务器；本地仅冻结端点、模型和URL身份。模型身份／源文件／实现哈希漂移停止。调用数为桥派发数，兼容HTTP回退与供应商计费不一定一一对应，未配置价格时不编造费用。

## 输出与解释

全部12份预测验真后才解析隔离参考，按用户宏平均绝对误差（MAE，mg/dL·min，越低越好）和覆盖率评分，不把无效值补0或发明准确率。报告包含全部6例、无经验／有经验预测、观测值、误差、变好／变差、检索记录和各源用量；Markdown、JSON及CSV均留本机。

这只是六例链路小试；CGM有原始插值，日志摄入未经核实，观测预测不等于推荐干预效果，不得据此宣称临床收益。LifeSnaps、全量和线上推荐接入仍不在本次范围。

## 复现

仓库根目录，使用已有SSH密钥与模型配置：

```bash
export FEDAGENT_LIFESTYLE_SSH_TARGET=poly-zhu@100.111.198.54
export FEDAGENT_LIFESTYLE_SSH_PORT=10022
uv run --project server python -m tools.lifestyle.sensor_trial prepare \
  --source data/lifestyle-prep/sensor-samples/run-20261124/prepared \
  --directory data/lifestyle-prep/sensor-trial/run-20261124
uv run --project server python -m tools.lifestyle.sensor_trial run \
  --directory data/lifestyle-prep/sensor-trial/run-20261124
uv run --project server python -m tools.lifestyle.sensor_trial verify \
  --directory data/lifestyle-prep/sensor-trial/run-20261124
```

`prepare`只读取模型身份、不付费推理；`run`才显式启动。完成后再run与verify均全离线，不构造模型、不写数据库。并发启动被文件锁阻断。不要更改已付费作业的冻结输入或实现去绕过检查。

## 验收状态

112项相关测试、ruff／格式／差异检查通过，Claude方案复审及完整代码终审通过。新测试覆盖真实平台API和原引擎的27次正常流程、格式失败重试、网络／未知派发阻断、40次封顶、缓存及成果篡改、完成后无模型复验。真实源的六条模板全部通过现有契约，6名留出用户隔离成立；6,494旧文件预检均未改。真实小试尚未派发；结果完成后在此补充。原始数据、模型输出与检查日志全部位于忽略目录，不进入Git。
