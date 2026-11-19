"""三类参考分别说明用途，保留完整来源，不编造患者。"""

import json

from fedagent_records.lifestyle import LifestyleRecords
from fedagent_sdk import Row
from fedagent_sdk.jsonutil import extract_json_object

from ...batch.generate import SYSTEM
from ...common import digest

SETTINGS = {"max_tokens": 2200, "temperature": 0}
CONTEXT_CAP = 131072
SYSTEMS = {
    "guidance": SYSTEM,
    "evidence": SYSTEM
    + "\n来源是历史公开医学问答，不是提问者病史，也不保证符合最新指南。只分析有依据的饮食或运动启示、适用条件与未知信息，不把诊疗描述直接变为个人处方。",
    "optional-support": SYSTEM
    + (
        "\n来源是公开医学考试训练题和解释，不是患者。解释可能有误；先保留完整假设条件和选项语义，"
        "谨慎说明它能支持哪些饮食或运动启示；不得把正确选项泛化成所有人的建议或编造问诊。"
    ),
}


def make_case(row, source_fingerprint, catalog, model_name):
    source, layer, original = row["source"], row["layer"], row["original"]
    identifier = "rec-" + digest({"source": row["id"], "fingerprint": source_fingerprint})[:20]
    if layer == "guidance":
        input_ = {
            "profile": f"未提供个人健康资料；这是公开资料的合成建议场景，不代表任何患者。资料人群：{original['population']}；地区：{original['region']}。",
            "question": (
                f"围绕公开资料“{original['sourceTitle']}”中的“{original['heading']}”，解释有关的饮食或运动建议、具体方法与适用限制。哪些个人情况需要先确认？"
            ),
        }
        origin = {
            "source": original["finalUrl"],
            "sourceDocument": original["documentId"],
            "sectionId": original["id"],
            "region": original["region"],
            "sourceDates": original["sourceDates"],
            "reuse": original["reuse"],
        }
        collection = None
    else:
        input_ = original["generationInput"]
        entry = catalog["medquad.zip" if source == "MedQuAD" else "medmcqa-train-00000-of-00001.parquet"]
        collection = original.get("document", "").split("/")[0] or "train"
        origin = {
            "source": original.get("url") or entry["url"],
            "sourceDocument": original.get("document", original["id"]),
            "sourceDates": [],
            "dateStatus": "原始条目未提供临床更新日期",
            "sourceRevision": entry["revision"],
            "reuse": {
                "license": entry["license"],
                "attribution": entry["dataset"],
                "licenseSource": entry["licenseSource"],
            },
        }
    input_ = LifestyleRecords().normalize_input(input_, identifier)
    provenance = {
        "synthetic": True,
        "modelGenerated": True,
        "referenceUsed": True,
        "model": model_name,
        "sourceDataset": source,
        "sourceLayer": layer,
        "sourceItemId": row["id"],
        "sourceCollection": collection,
        "sourcePayloadDigest": row["payloadDigest"],
        "sourceFingerprint": source_fingerprint,
        **origin,
    }
    if len(json.dumps(provenance, ensure_ascii=False)) > 4000:
        raise ValueError("provenance-too-large: " + row["id"])
    prompt = {"id": identifier, "site": source, "knowledge": original, "input": input_}
    messages = [
        {"role": "system", "content": SYSTEMS[layer]},
        {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
    ]
    size = len(json.dumps(messages, ensure_ascii=False).encode("utf-8"))
    if size + SETTINGS["max_tokens"] + 1024 > CONTEXT_CAP:
        raise ValueError("context-preflight-failed: " + row["id"])
    return {
        "id": identifier,
        "sourceId": row["id"],
        "source": source,
        "layer": layer,
        "collection": collection,
        "input": input_,
        "provenance": provenance,
        "messages": messages,
        "requestBytes": size,
    }


def validate_record(value, case):
    if not isinstance(value, dict) or value.get("id") != case["id"] or value.get("input") != case["input"] or value.get("provenance") != case["provenance"]:
        raise ValueError("record-source-binding-changed")
    report = LifestyleRecords().check([Row(1, value)])
    if not report.ok or any(event["role"] != "advisor" for event in value.get("events", [])):
        raise ValueError("record-contract-invalid")
    return report.items[0]


def parse_reply(text, case):
    value = extract_json_object(text)
    if not isinstance(value, dict):
        raise ValueError("reply-not-object")
    return validate_record(
        {
            "id": case["id"],
            "input": case["input"],
            "events": value.get("events"),
            "output": value.get("output"),
            "provenance": case["provenance"],
        },
        case,
    )
