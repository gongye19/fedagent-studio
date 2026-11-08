"""演示问诊的公开资料与仅用于判分的参考诊断。"""
from dataclasses import dataclass

from ..schemas.experience import ChatMessage, ConsultationSample, ConsultationSampleTurn


@dataclass(frozen=True)
class DemoCase:
    sample: ConsultationSample
    reference: str
    answer: str


DEMO_CASES = (
    DemoCase(
        sample=ConsultationSample(package_name="EvoMedClaw", turns=[
            ConsultationSampleTurn(label="早产儿惊厥",
                                   text="医生，宝宝胎龄 31 周早产，出生才 3 天，出生体重 1100 克。我产前有绒毛膜羊膜炎。"
                                        "宝宝这 18 小时越来越嗜睡，刚刚全身僵直抽搐了约 25 秒，前囟发紧、肌张力偏低，呼吸也不规则。"
                                        "请问该看哪个科，优先考虑什么？"),
            ConsultationSampleTurn(label="补充化验结果",
                                   text="化验显示 C 反应蛋白升高，白细胞略高，血红蛋白正常。还没做头部影像，下一步最需要查什么？"),
            ConsultationSampleTurn(label="补充颅脑超声",
                                   text="刚做了颅脑超声，报告说脑室内有出血。结合前面的情况，现在最可能是什么？"),
        ]),
        reference="脑室内出血", answer="Intraventricular hemorrhage",
    ),
    DemoCase(
        sample=ConsultationSample(package_name="FoT", turns=[
            ConsultationSampleTurn(label="9 岁男孩多尿、嗜盐",
                                   text="医生，我儿子 9 岁，这几个月总觉得没力气，喝水和小便都比以前多，还特别爱吃咸的。初诊时你最想先了解哪项情况？"),
            ConsultationSampleTurn(label="补充病史和体检",
                                   text="他从小容易便秘，近来不太爱活动。"
                                        "体检时身高和体重都在同龄儿童的第 10 百分位以下，血压是 110/75 mmHg。你会优先安排哪些检查，为什么？"),
            ConsultationSampleTurn(label="补充电解质结果",
                                   text="查了血电解质：钠 135、钾 3.2、氯 95 mmol/L。其他结果还没出来。"
                                        "结合前两轮，哪些线索影响了你的判断？目前优先考虑什么，还要查什么？"),
        ]),
        reference="Bartter 综合征", answer="Bartter syndrome",
    ),
)


def completed_case(messages: list[ChatMessage]) -> DemoCase | None:
    user_turns = [message.content for message in messages if message.role == "user"]
    return next(
        (case for case in DEMO_CASES if user_turns == [turn.text for turn in case.sample.turns]),
        None,
    )
