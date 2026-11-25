"""评分器先过固定校准，再完成两组回答和盲评；不重新生成经验。"""

from functools import partial

from ..common import digest, load, rows, save
from .audit import retrieve
from .meter import Calls, ledgers, verify_unit
from .prepare import validate
from .protocol import (
    ANSWER_SETTINGS,
    JUDGE_SETTINGS,
    answer_messages,
    calibration,
    judge_messages,
    parse_judge,
)


def schedule(cases):
    selected = [(namespace, case) for namespace in ("primary", "repeat") for case in cases if namespace == "primary" or case["repeat"]]
    answers = []
    judges = []
    for namespace, case in selected:
        reverse = (cases.index(case) % 2 == 0) != (namespace == "repeat")
        order = ("shared", "baseline") if reverse else ("baseline", "shared")
        key = case["id"].split(":", 1)[1]
        answers.extend(
            {"namespace": namespace, "case": case, "arm": arm, "relative": f"answers/{namespace}/{key}-{arm}.json"} for arm in order
        )
        judges.append(
            {"namespace": namespace, "case": case, "relative": f"judging/{namespace}/{key}.json", "labels": {"X": order[0], "Y": order[1]}}
        )
    return answers, judges


def text_reply(text):
    if not isinstance(text, str) or not 0 < len(text.strip()) <= 20000:
        raise ValueError("invalid-answer-text")
    return text.strip()


def calibration_ok(value):
    x, y = value["X"]["rules"], value["Y"]["rules"]
    if not (x["r3"] and not x["r0"] and not y["r3"] and y["r0"] and y["r1"] and y["r2"]):
        raise ValueError("grader-calibration-failed-do-not-generate-test-answers")


def completed(directory, relative):
    path = directory / relative
    return path.exists() and "value" in load(path)


def execute(directory, plan, calls=None):
    cases = rows(directory / "inputs/cases.jsonl")
    refs = {r["id"]: r for r in rows(directory / "inputs/references.jsonl")}
    library = load(directory / "inputs/library.json")
    answer_jobs, judge_jobs = schedule(cases)
    paths = ["units/calibration.json", *[v["relative"] for v in answer_jobs], *[v["relative"] for v in judge_jobs]]
    remaining = sum(not completed(directory, relative) for relative in paths)

    def one(namespace, relative, messages, settings, parse):
        nonlocal remaining
        existed = completed(directory, relative)
        if calls is None:
            result = verify_unit(directory, plan, namespace, relative, messages, settings, parse)
        else:
            result = calls.one(namespace, relative, messages, settings, parse, reserved=remaining - int(not existed))
        remaining -= not existed
        return result

    dev, dev_ref, dev_answers = calibration()
    calibrated = one(
        "primary", "units/calibration.json", judge_messages(dev, dev_ref, dev_answers), JUDGE_SETTINGS, partial(parse_judge, ref=dev_ref)
    )
    calibration_ok(calibrated)
    results = {}
    for job in answer_jobs:
        namespace, case, arm = job["namespace"], job["case"], job["arm"]
        selected, audit = retrieve(case["features"], library)
        expected = load(directory / "inputs/retrieval.json")[case["id"]]
        if audit != expected or not selected:
            raise ValueError("frozen-matching-changed-or-empty")
        response = one(namespace, job["relative"], answer_messages(case, selected if arm == "shared" else {}), ANSWER_SETTINGS, text_reply)
        result = results.setdefault((namespace, case["id"]), {"case": case, "namespace": namespace, "answers": {}, "retrieval": audit})
        result["answers"][arm] = response
        if calls:
            print(f"answer {namespace} {case['title']} {arm}: complete", flush=True)
    for job in judge_jobs:
        case, namespace = job["case"], job["namespace"]
        result = results[(namespace, case["id"])]
        blind = {label: result["answers"][arm] for label, arm in job["labels"].items()}
        value = one(
            namespace,
            job["relative"],
            judge_messages(case, refs[case["id"]], blind),
            JUDGE_SETTINGS,
            partial(parse_judge, ref=refs[case["id"]]),
        )
        result["judgments"] = {arm: value[label] for label, arm in job["labels"].items()}
        result["differences"] = value["differences"]
        if calls:
            print(f"judging {namespace} {case['title']}: complete", flush=True)
    return list(results.values()), refs


def run(directory, *, link=None):
    from .report import verify

    plan = validate(directory)
    ledgers(directory, plan)
    if (directory / "COMPLETE.json").exists():
        return verify(directory)
    if (directory / "STOP.json").exists():
        raise ValueError("stopped-job-no-auto-restart")
    try:
        execute(directory, plan, Calls(directory, plan, link))
        report = verify(directory, completing=True)
        save(directory / "COMPLETE.json", {"fingerprint": plan["fingerprint"], "reportDigest": digest(report)})
        return report
    except Exception as error:
        save(directory / "STOP.json", {"type": type(error).__name__, "message": str(error)})
        raise
