import argparse
import json
from pathlib import Path

from ...common import digest, hold_experiment_lock, load, save
from .prepare import ROOT, prepare
from .progress import usage


def main():
    parser = argparse.ArgumentParser(description="444条公开资料生成过程，500次上限；尚不上传或提取")
    parser.add_argument("command", choices=("prepare", "status", "run"))
    parser.add_argument(
        "--directory",
        type=Path,
        default=ROOT / "data/lifestyle-prep/full/run-20261119/generation",
    )
    parser.add_argument("--take", type=int)
    parser.add_argument(
        "--continue-after-inspection",
        action="store_true",
        help="已查看首8条结果，记录本次操作后继续同一批次",
    )
    args = parser.parse_args()
    directory = args.directory.resolve()
    if directory.name != "generation" or directory.parent.parent != (ROOT / "data/lifestyle-prep/full").resolve():
        parser.error("只允许data/lifestyle-prep/full/<新批次>/generation")
    if args.command == "status":
        if not (directory / "inputs").exists():
            print(
                json.dumps(
                    {"status": "not-prepared", "businessModelCalls": 0},
                    ensure_ascii=False,
                )
            )
            return
        plan, cases = prepare(directory)
        print(json.dumps(usage(directory, plan, cases)[0], ensure_ascii=False, indent=2))
        return
    if args.command == "run" and not (directory / "inputs").exists():
        parser.error("请先单独执行prepare，核对全部请求与调用规划")
    if args.command == "run" and directory.parent.name != "run-20261119":
        parser.error("本次付费运行只允许固定run-20261119批次，不得通过新目录重置预算")
    directory.mkdir(parents=True, exist_ok=True)
    hold_experiment_lock(directory)
    plan, cases = prepare(directory)
    if args.command == "prepare":
        print(
            json.dumps(
                {
                    "fingerprint": plan["fingerprint"],
                    "counts": plan["counts"],
                    "cost": plan["cost"],
                    "businessModelCalls": 0,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return
    _, states = usage(directory, plan, cases)
    sample = cases[:8]
    inspected = {c["id"]: load(directory / "units" / (c["id"] + ".json"))["valueDigest"] for c in sample if states[c["id"]] == "generated"}
    receipt_path = directory / "inspection.json"
    failed = {c["id"]: digest(load(directory / "units" / (c["id"] + ".json"))) for c in sample if states[c["id"]] == "terminalFailed"}
    settled = len(inspected) + len(failed)
    expected = {
        "inputFingerprint": plan["fingerprint"],
        "sampleValueDigests": inspected,
        "sampleTerminalFailures": failed,
    }
    if receipt_path.exists():
        if settled != len(sample) or load(receipt_path) != expected:
            parser.error("首批检查凭据或结果已改变，禁止继续")
    elif args.continue_after_inspection:
        if settled != len(sample):
            parser.error("首8条尚未全部结束，不能跳过检查")
        save(receipt_path, expected)
    else:
        if args.take is None or not 1 <= args.take <= 8 - settled:
            parser.error("先用run --take 8完成首批；查看后用--continue-after-inspection继续")
    from .runner import run

    result = run(directory, plan, cases, take=args.take)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["state"]["status"] not in ("complete", "paused-by-limit"):
        raise SystemExit("生成尚未全部完成；检查点与实际调用保留，未上传、未提取、未发布")


if __name__ == "__main__":
    main()
