"""按预先固定的留出案例盲评三组；生成与判分各自落检查点。"""

from __future__ import annotations

import random
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fedagent_records.lifestyle import LifestyleDomain
from fedagent_records.lifestyle_grading import assess
from fedagent_sdk import ApplyRequest, Artifact, ModelError

from .common import digest, load, save

ARMS = ("without", "local", "shared")


def evaluate(directory: Path, manifest, state, shared, platform, model):
    algorithm = platform.registry.algorithm("fot-records")
    domain = LifestyleDomain()

    def one_case(case):
        libraries = {"without": None, "local": state["local"][case["site"]], "shared": shared}
        order = list(ARMS)
        random.Random(digest({"case": case["id"], "seed": 17})).shuffle(order)
        row = {"id": case["id"], "site": case["site"], "input": case["input"], "criteria": case["criteria"], "order": order, "arms": {}}
        for arm in order:
            library = libraries[arm]
            fingerprint = digest({"case": case, "library": library, "model": model.name, "plugin": algorithm.code_hash(), "protocol": 1})
            path = directory / "evaluation" / f"{case['id']}-{arm}.json"
            checkpoint = load(path) if path.exists() else {"fingerprint": fingerprint}
            if checkpoint["fingerprint"] != fingerprint:
                raise ValueError("评测输入、规则或经验发生改变；请创建新实验")
            try:
                if "answer" not in checkpoint:
                    artifact = Artifact(1, 1, "text-library", library) if library is not None else None
                    request = ApplyRequest(domain.application_input(domain.application_item(case["input"])))
                    answer = algorithm.apply(artifact, request, model)
                    checkpoint["answer"] = answer.output
                    checkpoint["usage"] = answer.usage
                    save(path, checkpoint)
                if "assessment" not in checkpoint:
                    try:
                        checkpoint["assessment"] = assess(checkpoint["answer"], case["input"], case["criteria"], model)
                    except (ValueError, ModelError, TypeError):
                        model.reject_last()
                        raise
                checkpoint["status"] = "complete"
                checkpoint.pop("error", None)
            except (ValueError, ModelError, TypeError) as error:
                # 实验工具保留已得到的回答，不重算；任一模型／协议失败明确标为缺失。
                checkpoint["status"] = "failed"
                checkpoint["error"] = type(error).__name__
            save(path, checkpoint)
            row["arms"][arm] = checkpoint
        return row

    with ThreadPoolExecutor(max_workers=2) as pool:
        return list(pool.map(one_case, manifest["heldout"]))


def summarize(results):
    paired = [r for r in results if all(r["arms"].get(a, {}).get("status") == "complete" for a in ARMS)]
    summary = {"cases": len(results), "completePairedCases": len(paired), "incompleteCases": len(results) - len(paired), "arms": {}}
    for arm in ARMS:
        values = [r["arms"][arm]["assessment"] for r in paired]
        summary["arms"][arm] = {
            "score": sum(v["score"] for v in values) / len(values) if values else None,
            "passed": sum(v["passed"] for v in values),
            "unsafeCriteria": sum(v["unsafe"] for v in values),
            "denominator": len(values),
        }
    for arm in ("local", "shared"):
        pairs = [(r["arms"]["without"]["assessment"]["score"], r["arms"][arm]["assessment"]["score"]) for r in paired]
        summary["arms"][arm].update({"better": sum(b > a for a, b in pairs), "worse": sum(b < a for a, b in pairs), "same": sum(b == a for a, b in pairs)})
    return summary
