"""独立命令：fetch 仅下载；build 完全离线，均不允许调用模型。"""

import argparse
import json
import time
from pathlib import Path

from ..common import hold_experiment_lock
from .build import build
from .fetch import fetch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("fetch", "build"))
    parser.add_argument("--directory", type=Path, default=Path("data/lifestyle-prep/corpus/20261118"))
    parser.add_argument("--reuse", type=Path, action="append", default=[])
    args = parser.parse_args()
    directory = args.directory.resolve()
    if directory.parent.name != "corpus" or directory.parent.parent.name != "lifestyle-prep":
        parser.error("只能使用 lifestyle-prep/corpus/<新实验名>，不能覆盖旧冒烟实验")
    directory.mkdir(parents=True, exist_ok=True)
    hold_experiment_lock(directory)
    start = time.monotonic()
    if args.command == "fetch":
        fetch(directory / "sources", args.reuse)
        print("已校验全部固定来源；未调用模型。")
    else:
        manifest = build(directory)
        print(json.dumps(manifest["inventory"], ensure_ascii=False, indent=2))
        print("fingerprint", manifest["fingerprint"])
    print(f"耗时 {time.monotonic() - start:.2f}s；0 次模型调用。")


if __name__ == "__main__":
    main()
