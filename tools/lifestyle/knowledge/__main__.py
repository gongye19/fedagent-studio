import argparse
import json
from pathlib import Path

from ..common import hold_experiment_lock
from .build import build
from .fetch import fetch


def main():
    parser = argparse.ArgumentParser(description="官方饮食/运动知识准备；不调用业务模型、不部署")
    parser.add_argument("command", choices=("fetch", "build"))
    parser.add_argument("--directory", type=Path, default=Path("data/lifestyle-prep/knowledge/20261118"))
    parser.add_argument("--cache", type=Path, action="append", default=[])
    parser.add_argument("--legacy", type=Path, default=Path("data/lifestyle-prep/corpus/final-20261118/prepared"))
    parser.add_argument("--smoke", type=Path, default=Path("data/lifestyle-prep/prepared.json"))
    args = parser.parse_args()
    directory = args.directory.resolve()
    if directory.parent.name != "knowledge" or directory.parent.parent.name != "lifestyle-prep":
        parser.error("只能使用 lifestyle-prep/knowledge/<新批次>，不能覆盖旧实验")
    directory.mkdir(parents=True, exist_ok=True)
    hold_experiment_lock(directory)
    if args.command == "fetch":
        fetch(directory / "raw", args.cache)
        print("固定来源快照已校验，0次业务模型调用。")
    else:
        manifest = build(directory, args.legacy, args.smoke)
        print(json.dumps(manifest["inventory"], ensure_ascii=False, indent=2))
        print("fingerprint", manifest["fingerprint"], "0次业务模型调用。")


if __name__ == "__main__":
    main()
