"""确定性的相关性初筛，不把关键词或模型筛选说成医学审核。"""

from __future__ import annotations

import re
import unicodedata

BROAD = re.compile(
    r"\b(diet\w*|nutriti\w*|exercis\w*|physical activit\w*|food\w*|meal\w*|obes\w*|weight loss|weight management)\b",
    re.I,
)
LIFESTYLE = re.compile(
    r"\b(diet\w*|exercis\w*|physical activit\w*|healthy eat\w*|nutrition\w*|weight loss|weight management)\b",
    re.I,
)
ACTION = re.compile(
    r"\b(eat|avoid|limit|choose|recommend\w*|should|can help|reduce|increase|prevent\w*|maintain\w*|try|need to)\b",
    re.I,
)
FOCUS = re.compile(
    r"diabet|prediabet|insulin resistance|metabolic syndrome|weight|obesity|osteoarthritis|rheumatoid arthritis|"
    r"osteoporosis|exercise|physical activity|nutrition|diet|vegetarian|carbohydrates|vitamins|folic acid|"
    r"high blood|cholesterol|atherosclerosis|heart disease|heart failure|heart attack|cardiac rehabilitation|"
    r"kidney stones|kidney disease|hemodialysis|healthy aging|balance problems|falls|constipation|"
    r"celiac|crohn|lactose|colitis|diverticular|gastroparesis|anemia",
    re.I,
)
EXCLUDE_FOCUS = re.compile(r"children|childhood|newborn|infant|for health care professionals|loeys-dietz", re.I)
MCQ_FOCUS = re.compile(
    r"\b(diet\w*|nutrition\w*|exercis\w*|physical activity|healthy eating|food source|calori\w*|dietary fibre|dietary fiber)\b",
    re.I,
)
MCQ_ACTION = re.compile(
    r"\b(recommend\w*|allowance|RDA|requirement\w*|advis\w*|prevent\w*|benefi\w*|avoid|restrict\w*|sources?|richest|rich in|"
    r"intake|balanced|weight reduction|weight loss|weight control)\b",
    re.I,
)
MCQ_EXCLUDE = re.compile(
    r"\b(infants?|child\w*|newborn\w*|neonat\w*|baby|pediatr\w*|parenteral|enteral|intravenous|surg\w*|"
    r"gastrectom\w*|organism|poisoning|enzym\w*|hormone|dna|rna|glycol\w*|krebs|mitochond\w*|histolog\w*|"
    r"drugs?|pharmac\w*|anesthe\w*|mutation|carcinoma|cancer|gene\w*|cataly\w*|hirsutism|HIV|tuberculosis|"
    r"pregnan\w*|lactat\w*|calcium channel|MDRD|diagnos\w*|investigation|diethyl\w*|transpo\w*|lipoprotein|"
    r"absorb\w*|secretion|nitrogen balance)\b",
    re.I,
)
UNKNOWN_PROFILE = "个人情况未提供；仅讨论来源明确描述的情境，不推断个人病史。"


def normalize(text: str) -> str:
    return " ".join(re.findall(r"\w+", unicodedata.normalize("NFKC", text).casefold()))


def evidence(answer: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", answer) if LIFESTYLE.search(s) and ACTION.search(s)]


def mcq_relevance(question: str) -> bool:
    return bool(MCQ_FOCUS.search(question) and MCQ_ACTION.search(question) and not MCQ_EXCLUDE.search(question))
