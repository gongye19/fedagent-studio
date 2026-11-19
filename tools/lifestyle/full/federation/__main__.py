"""本地五批正式提取入口；输入冻结、付费执行和只读状态分开。"""

import argparse
import json
from pathlib import Path

from ...common import hold_experiment_lock, load
from ..generation.prepare import ROOT
from .prepare import prepare


def main():
    parser = argparse.ArgumentParser(description="444条、5批FoT；含生成全程最多1500次，不部署、不评测")
    parser.add_argument("command", choices=("prepare", "run", "status"))
    parser.add_argument("--directory", type=Path, default=ROOT / "data/lifestyle-prep/full/run-20261119/federation")
    parser.add_argument("--resume-after-connection-check", action="store_true")
    args = parser.parse_args()
    directory = args.directory.resolve()
    if directory != (ROOT / "data/lifestyle-prep/full/run-20261119/federation").resolve():
        parser.error("本次仅允许固定run-20261119/federation，不能换目录重置预算")
    if args.command == "status":
        path = directory / "source-usage.json"
        print(json.dumps(load(path) if path.exists() else {"status": "not-started", "businessModelCalls": 0}, ensure_ascii=False, indent=2))
        return
    if args.command == "run" and not (directory / "inputs").exists():
        parser.error("先执行prepare核对五批、来源和全部检查点")
    directory.mkdir(parents=True, exist_ok=True)
    hold_experiment_lock(directory)
    plan = prepare(directory)
    if args.command == "prepare":
        print(
            json.dumps(
                {"fingerprint": plan["fingerprint"], "sources": plan["counts"], "batches": plan["batches"], "businessModelCalls": 0},
                ensure_ascii=False,
                indent=2,
            )
        )
        return
    from .run import run

    result = run(directory, plan, resume=args.resume_after_connection_check)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["status"] != "complete":
        raise SystemExit("尚未全部完成；检查点及来源实际用量已保留")


if __name__ == "__main__":
    main()
