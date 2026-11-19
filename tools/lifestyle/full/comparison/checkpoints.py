"""完成结果只读复验：检查单元身份、摘要与配对投影，不构造模型。"""

from ...batch.evaluate import ARMS, summarize
from ...batch.healthbench import answer_messages, grade_prompt, grader_template, score
from ...batch.report import results_from_disk
from ...common import digest, load, rows


def checked_unit(path, identity, messages, settings):
    value = load(path)
    fingerprint = digest({"identity": identity, "messages": messages, "settings": settings})
    if (
        value.get("fingerprint") != fingerprint
        or not isinstance(value.get("failures"), list)
        or len(value["failures"]) > 2
        or ("value" in value and digest(value["value"]) != value.get("valueDigest"))
    ):
        raise ValueError("unit-checkpoint-changed:" + str(path))
    return value


def unit(path, identity, messages, settings, expected):
    value = checked_unit(path, identity, messages, settings)
    if "value" not in value or value["value"] != expected:
        raise ValueError("completed-unit-checkpoint-changed:" + str(path))


def verify_existing(directory, plan):
    cases = rows(directory / "inputs/evaluation-inputs.jsonl")
    refs = {r["id"]: r["rubrics"] for r in rows(directory / "inputs/evaluation-references.jsonl")}
    library = load(directory / "inputs/collection.json")
    template = grader_template((directory / "inputs/grader-source.py").read_text())
    # 部分结果也先校验摘要，阻止损坏的检查点进入新的付费调用。
    results_from_disk(directory)
    for case in cases:
        key, rubrics = case["id"].removeprefix("healthbench:"), refs[case["id"]]
        identity = {"prepared": plan["fingerprint"], "case": case, "rubrics": rubrics, "model": plan["identity"], "library": library}
        for arm in ARMS:
            answer_path = directory / "answers" / f"{key}-{arm}.json"
            answer = (
                checked_unit(
                    answer_path,
                    {"case": identity, "arm": arm},
                    answer_messages(case["messages"], library if arm == "shared" else {}),
                    {"max_tokens": 1800, "temperature": 0},
                )
                if answer_path.exists()
                else {}
            )
            for index, rubric in enumerate(rubrics):
                path = directory / "grades" / key / f"{index:02d}-{arm}.json"
                if not path.exists():
                    continue
                if "value" not in answer:
                    raise ValueError("grade-without-successful-answer")
                prompt = grade_prompt(template, case["messages"], answer["value"], rubric)
                checked_unit(path, {"model": plan["identity"]}, [{"role": "user", "content": prompt}], {"max_tokens": 1024, "temperature": 0})


def verify_complete(directory, plan):
    results = results_from_disk(directory)
    if summarize(results)["incompleteCases"]:
        raise ValueError("completed-comparison-missing-cases")
    cases = rows(directory / "inputs/evaluation-inputs.jsonl")
    refs = {r["id"]: r["rubrics"] for r in rows(directory / "inputs/evaluation-references.jsonl")}
    library = load(directory / "inputs/collection.json")
    template = grader_template((directory / "inputs/grader-source.py").read_text())
    for case, result in zip(cases, results, strict=True):
        key, rubrics = case["id"].removeprefix("healthbench:"), refs[case["id"]]
        identity = {"prepared": plan["fingerprint"], "case": case, "rubrics": rubrics, "model": plan["identity"], "library": library}
        if result.get("fingerprint") != digest(identity) or result["rubrics"] != rubrics or result["messages"] != case["messages"]:
            raise ValueError("completed-evaluation-identity-changed")
        for arm in ARMS:
            item = result["arms"][arm]
            unit(
                directory / "answers" / f"{key}-{arm}.json",
                {"case": identity, "arm": arm},
                answer_messages(case["messages"], library if arm == "shared" else {}),
                {"max_tokens": 1800, "temperature": 0},
                item["answer"],
            )
            for index, rubric in enumerate(rubrics):
                prompt = grade_prompt(template, case["messages"], item["answer"], rubric)
                unit(
                    directory / "grades" / key / f"{index:02d}-{arm}.json",
                    {"model": plan["identity"]},
                    [{"role": "user", "content": prompt}],
                    {"max_tokens": 1024, "temperature": 0},
                    item["grades"][index],
                )
            if item["score"] != score(rubrics, item["grades"]):
                raise ValueError("completed-evaluation-score-changed")
    return results
