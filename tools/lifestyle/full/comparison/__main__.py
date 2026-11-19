"""本次学习任务的单次衔接入口；不用cron，不重复创建付费任务。"""

import argparse
import json
import time

from ...common import hold_experiment_lock, load
from .prepare import DIRECTORY, prepare
from .source import Waiting


def wait_prepare(directory, *, waiting=False, sleep=time.sleep):
    from .prepare import implementation

    expected = implementation()
    previous = None
    while True:
        if implementation() != expected:
            raise ValueError("comparison-code-changed-while-waiting")
        try:
            plan = prepare(directory)
            if plan["implementation"] != expected:
                raise ValueError("comparison-code-changed-during-freeze")
            return plan
        except Waiting as error:
            if not waiting:
                raise
            if str(error) != previous:
                print("等待五批完成；远程尝试数：" + str(error), flush=True)
                previous = str(error)
            sleep(30)


def main():
    parser = argparse.ArgumentParser(description="全部五包经验vs无经验，24题730正常调用／850硬限；本机，不部署")
    parser.add_argument("command", choices=("prepare", "run", "wait-and-run", "status"))
    parser.add_argument("--resume-after-connection-check", action="store_true")
    args = parser.parse_args()
    if args.command == "status":
        path = DIRECTORY / "run.json"
        print(json.dumps(load(path) if path.exists() else {"status": "waiting-or-not-started"}, ensure_ascii=False, indent=2))
        return
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    hold_experiment_lock(DIRECTORY)
    plan = wait_prepare(DIRECTORY, waiting=args.command == "wait-and-run")
    print(json.dumps({"prepared": plan["fingerprint"], "cases": 24, "arms": 2, "normalCalls": 730, "callLimit": 850}, ensure_ascii=False), flush=True)
    if args.command == "prepare":
        return
    from .run import run

    result = run(DIRECTORY, plan, resume=args.resume_after_connection_check)
    print(json.dumps(result["summary"], ensure_ascii=False, indent=2))
    if result["run"]["status"] != "complete":
        raise SystemExit("评测未全部完成；已保存检查点，需要处理")


if __name__ == "__main__":
    main()
