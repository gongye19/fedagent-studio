"""把已共享的经验卡分解成可展开的可读条目，不生成新的摘要或模型调用。"""
from fedagent_sdk import OutputEntry

from .progress import DEPARTMENTS


def card_entries(cards, labels):
    entries = []
    for card in cards:
        lines = []
        for key, label in (("department", "适用科室"), ("stage", "阶段"), ("positive_triggers", "触发条件"),
                           ("negative_triggers", "排除条件"), ("target_action", "推荐动作"), ("target_diagnosis_shift", "诊断调整")):
            value = card.get(key)
            if value:
                if key == "department":
                    value = DEPARTMENTS.get(value, value)
                lines.append(label + "：" + ("；".join(value) if isinstance(value, list) else str(value)))
        lines.append(f"支持 {card.get('support_count', 0)} 次 · 有益命中 {card.get('helpful_hits', 0)} 次 · 有害命中 {card.get('harmful_hits', 0)} 次")
        entries.append(OutputEntry(str(card.get("card_signature", ""))[:12], "\n".join(lines), labels.get(card.get("memory_type"), "过程经验")))
    return entries
