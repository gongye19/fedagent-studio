"""准备不调用模型；真实小试25次正常路径、总48硬限，不部署。"""

import argparse
import json
from pathlib import Path

from ..common import hold_experiment_lock
from ..diet_transport import DietLink
from .prepare import prepare, validate
from .report import verify
from .run import run


def main():
    parser = argparse.ArgumentParser(description="案例专属两组饮食评测，保留所有旧结果，不部署")
    parser.add_argument("action", choices=("prepare", "run", "verify"))
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    directory = args.directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    hold_experiment_lock(directory)
    if args.action == "prepare":
        result = prepare(directory)
    elif args.action == "verify":
        result = verify(directory)
    elif (directory / "COMPLETE.json").exists():
        result = run(directory)
    else:
        validate(directory)
        if (directory / "STOP.json").exists():
            raise ValueError("stopped-job-no-auto-restart")
        with DietLink(directory / "upstream") as link:
            result = run(directory, link=link)
    print(
        json.dumps(
            {k: v for k, v in result.items() if k not in {"implementation", "files", "sourceFiles", "cases"}}, ensure_ascii=False, indent=2
        )
    )


if __name__ == "__main__":
    main()
