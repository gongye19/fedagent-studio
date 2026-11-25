"""prepare不付费；run仅运行冻结的36次正常路径，硬限40。"""

import argparse
import json
from pathlib import Path

from ..common import hold_experiment_lock
from ..diet_transport import DietLink
from .prepare import prepare, validate
from .run import run, stop_path
from .verify import verify


def main():
    parser = argparse.ArgumentParser(description="CGMacros饮食推荐六学六测，正常36次，硬限40，不部署")
    parser.add_argument("action", choices=("prepare", "prepare-recovery", "accept-evidence", "run", "verify"))
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--model-ref", default="default:gpt-5.6-luna")
    args = parser.parse_args()
    directory = args.directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    hold_experiment_lock(directory)
    if args.action == "accept-evidence":
        from .evidence_upgrade import upgrade

        result = upgrade(directory)
    elif args.action == "prepare-recovery":
        from .recovery import prepare_recovery

        result = prepare_recovery(directory)
    elif args.action == "verify":
        result = verify(directory)
    elif args.action == "run" and (directory / "COMPLETE.json").exists():
        result = run(directory)
    else:
        if args.action == "prepare" and args.source is None:
            parser.error("prepare需要--source")
        # 已停止的作业不建立SSH；保留失败事实，等待明确处理。
        if args.action == "run" and stop_path(directory, validate(directory)).exists():
            raise ValueError("stopped-job-needs-explicit-investigation")
        with DietLink(directory / "verification/upstream") as link:
            if args.action == "prepare":
                identity = link.request({"ref": args.model_ref, "inspect": True})
                if args.model_ref != identity["endpoint"] + ":" + identity["model"]:
                    raise ValueError("explicit-model-ref-required")
                result = prepare(directory, args.source, identity)
            else:
                result = run(directory, link=link)
    # 详细回答留本机报告；终端只展示摘要。
    print(
        json.dumps(
            {k: v for k, v in result.items() if k not in {"cases", "implementation", "files", "batches"}}, ensure_ascii=False, indent=2
        )
    )


if __name__ == "__main__":
    main()
