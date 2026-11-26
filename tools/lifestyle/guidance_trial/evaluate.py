"""24题固定双组；同模型同提示，经验单独选择，逐条原规则盲评。"""

import random

from ..batch.evaluate import summarize
from ..batch.healthbench import (
    answer_messages,
    grade_prompt,
    grader_template,
    parse_grade,
    score,
)
from ..common import digest, rows, save
from .protocol import retrieve


def evaluate(directory, plan, library, calls):
    cases = rows(directory / "inputs/evaluation-inputs.jsonl")
    refs = {
        r["id"]: r["rubrics"]
        for r in rows(directory / "inputs/evaluation-references.jsonl")
    }
    template = grader_template((directory / "inputs/grader-source.py").read_text())
    results = []
    for case in cases:
        key = case["id"].removeprefix("healthbench:")
        selected, selection = retrieve(
            case["messages"], library["cards"], groups=library["groups"]
        )
        save(directory / f"selection/{key}.json", selection)
        order = ["without", "shared"]
        random.Random(digest({"case": case["id"], "seed": 17})).shuffle(order)
        result = {
            **case,
            "rubrics": refs[case["id"]],
            "order": order,
            "arms": {},
            "selection": selection,
        }
        for arm in order:
            answer = calls.one(
                "meter-evaluation",
                f"answers/{key}-{arm}.json",
                answer_messages(case["messages"], selected if arm == "shared" else {}),
                {"max_tokens": 1800, "temperature": 0},
                lambda text: text.strip(),
            )
            result["arms"][arm] = {"answer": answer, "grades": [], "status": "running"}
            save(directory / f"evaluation/{key}.json", result)
        for index, rubric in enumerate(refs[case["id"]]):
            for arm in order:
                prompt = grade_prompt(
                    template, case["messages"], result["arms"][arm]["answer"], rubric
                )
                grade = calls.one(
                    "meter-evaluation",
                    f"grades/{key}/{index:02d}-{arm}.json",
                    [{"role": "user", "content": prompt}],
                    {"max_tokens": 1024, "temperature": 0},
                    parse_grade,
                )
                result["arms"][arm]["grades"].append(grade)
                save(directory / f"evaluation/{key}.json", result)
        for arm in order:
            item = result["arms"][arm]
            item.update(
                score=score(result["rubrics"], item["grades"]), status="complete"
            )
        save(directory / f"evaluation/{key}.json", result)
        results.append(result)
        save(
            directory / "progress.json",
            {
                "phase": "evaluate",
                "pairedCompleted": len(results),
                "pairedPlanned": len(cases),
                "calls": calls.spent(),
                "summary": summarize(results),
            },
        )
        print(f"paired evaluation {len(results)}/{len(cases)} complete", flush=True)
    return results
