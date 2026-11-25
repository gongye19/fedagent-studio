"""手工正向夹具、错误变体与旧格式分别展示；不把夹具通过说成模型有效。"""

from copy import deepcopy

from ..common import digest
from .check import check, regression_control


def run_suite(reference):
    trace = regression_control(reference)
    aggregate = regression_control(reference, stage="aggregate", parents=[trace])
    positive = [check(reference, [trace], stage="trace"), check(reference, [aggregate], stage="aggregate", parents=[trace])]
    if not all(r["structurePreserved"] for r in positive):
        raise ValueError("manually-annotated-control-failed")
    variants = []

    def variant(name, mutate, *, parent_stage=False):
        cards = [deepcopy(aggregate if parent_stage else trace)]
        mutate(cards[0])
        result = check(reference, cards, stage="aggregate" if parent_stage else "trace", parents=[trace] if parent_stage else None)
        if result["structurePreserved"]:
            raise ValueError("invalid-control-was-accepted: " + name)
        variants.append({"name": name, "expected": "rejected", "report": result})

    for field in reference["fields"]:
        variant("omit-" + field, lambda card, field=field: card["fields"].pop(field))
    variant("change-population", lambda c: c["fields"].update(population={"group": "everyone"}))
    variant("change-parameter-value-or-unit", lambda c: c["fields"].update(parameters={"unsupported": 225}))
    variant("change-goal-role", lambda c: c["fields"].update(goal={"role": "individual-prescription"}))
    variant("change-source-version", lambda c: c["sourceRefs"].update({next(iter(c["sourceRefs"])): "wrong"}))
    variant("change-reference-version", lambda c: c.update(referenceDigest="wrong"))
    variant("upgrade-guidance-to-causal-evidence", lambda c: c.update(evidenceKind="causal-effect"))
    variant("invent-new-claim", lambda c: c["fields"].update(provenCure=True))
    variant("unvalidated-free-narrative", lambda c: c.update(narrative="unsupported assertion"))
    variant("invent-parent", lambda c: c.update(parentRefs=["fake-parent"]), parent_stage=True)
    fields = list(reference["fields"])
    left = regression_control(reference, fields={k: trace["fields"][k] for k in fields[:3]})
    right = regression_control(reference, fields={k: trace["fields"][k] for k in fields[3:]})
    left["id"], right["id"] = "manual-control-left", "manual-control-right"
    split_report = check(reference, [left, right], stage="trace")
    merged = regression_control(reference, stage="aggregate", parents=[left, right])
    merged_report = check(reference, [merged], stage="aggregate", parents=[left, right])
    wrong_parent = deepcopy(merged)
    wrong_parent["parentRefs"] = [digest(left)]
    unsupported = check(reference, [wrong_parent], stage="aggregate", parents=[left, right])
    if not split_report["structurePreserved"] or not merged_report["structurePreserved"] or unsupported["structurePreserved"]:
        raise ValueError("split-and-merge-lineage-control-failed")
    return {
        "referenceId": reference["id"],
        "label": "manual-regression-controls-not-generated-experience",
        "positive": positive + [split_report, merged_report],
        "rejectedVariants": variants,
        "unselected-parent-field": unsupported,
    }, {"trace": [trace], "aggregate": [aggregate], "splitTrace": [left, right], "mergedAggregate": [merged]}
