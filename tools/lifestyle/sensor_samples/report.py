"""Compact human report; no inference about recommendation effectiveness."""


def render(summary, budget, baselines):
    lines = [
        "# LifeStyle 观测样本准备",
        "",
        "仅本地整理、切分与调用预算；没有生成经验、调用平台模型或上线。",
        "",
        "| 数据源 | 全体用户 | 有样本用户 | 学习样本 | 留出样本 | 学习有样本人 | 留出有样本人 |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for domain, value in summary.items():
        learning, evaluation = value["roles"]["learning"], value["roles"]["evaluation"]
        lines.append(
            f"| {domain} | {value['assigned_people']} | {value['people_with_samples']} | {learning['samples']} | {evaluation['samples']} | {learning['people_with_samples']} | {evaluation['people_with_samples']} |"
        )
    lines += [
        "",
        "每源独立模拟A/B/C三个站点，不是真实医院。先按全体用户切分，零样本用户仍保留原分配；来源之间不拼接身份。",
        "",
        "## 调用预算（条件性提案，未批准）",
        "",
        "| 数据源 | 档位 | 学习N | 留出M | 批次B | 模板观测路径 | 加合成说明路径 | 15%预留场景 |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for domain, tiers in budget["proposals"].items():
        for tier, value in tiers.items():
            lines.append(
                f"| {domain} | {tier} | {value['learningCases']} | {value['evaluationCases']} | {value['batches']} | {value['normalCallsTemplate']} | {value['normalCallsWithSyntheticExplanation']} | {value['suggestedReserveScenarioCap']} |"
            )
    lines += [
        "",
        "模板路径2N+3B+2M；合成说明路径3N+3B+2M。15%不是最坏重试费用或已批准上限。接口适配与有限检索尚未实现，2M及整体token量依赖这些后续设计；不把全部批次库塞进提示词。没有可核验当前单价，不报人民币。",
        "",
        "nonoverlap是固定时间贪心选择的不重叠窗口视图，原始合格案例全部保留；smoke/first也仅列预算，没有执行。",
        "",
        "## 零调用数值基线",
        "",
        "| 数据源 | 基线 | 按用户宏平均绝对误差 | 观测单位 |",
        "| --- | --- | ---: | --- |",
    ]
    for domain, values in baselines.items():
        for name, value in values.items():
            unit = "mg/dL·min（正增量面积）" if domain == "cgmacros" else "分钟（睡眠）"
            lines.append(
                f"| {domain} | {name} | {value['score']['conditional_user_macro_mae']} | {unit} |"
            )
    lines += [
        "",
        "这是简单数值参照，不是无经验LLM结果，也没有验证经验包有无效果。CG主指标为餐后120分钟正增量面积；Life主指标为隔一整日后D+2主睡眠分钟数。",
        "",
        "## 使用边界",
        "",
        "- 每个评测案例必须独立、无跨案历史地运行，只把inputs.jsonl里的input交给模型。不透明id仅用于对账。",
        "- 同一用户的窗口有关联，某案例的参考值可成为另一较晚案例的合法历史；不得跨案例把参考答案带入聊天。按用户统计，不把窗口数当独立人数。",
        "- 评测inputs与references分开；学习目录不含留出用户任何记录。参考是公开处理后的观测，不是最佳饮食/运动或临床疗效标签。",
        "- CGM是发布的插值网格，输入中没有任何血糖。完整分钟行和有效量纲范围才建参考，40/400边界保留并标可能封顶；范围排除会影响代表性。",
        "- 餐食营养是日志值，摄入量量纲未确认、没有乘份量。缺列、空值和非正进食量分别审计；缺记录不能猜吃完。",
        "- 餐前60分钟HR/MET少于48个点时均值置空，活动消耗需满60点才求总和。Life能量消耗可为空，不是饮食摄入。",
        "- Life画像仅取前三个历史日的一致分类，冲突/缺失置空；日期为dateOfSleep，发布表来自mainSleep筛选，但没有精确入睡/醒来起止，不能承诺真实前瞻性。",
        "- 无法解析的未来模型答案应单列未评分与覆盖率，不能补零或静默删掉；完整改善结论须两组均100%解析成功。",
        "- 用户数较少，随机划分未按疾病分层，不作临床推广或统计显著性结论。公开数据也不保证未进入模型预训练。",
        "- 后续外部模型调用前需确认数据发送范围、数据许可、接入方案与费用；本次零调用。",
        "",
    ]
    return "\n".join(lines)
