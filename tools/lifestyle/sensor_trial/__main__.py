"""仅显式run启动已批准的CGMacros小试；prepare/verify无付费派发。"""

import argparse
import json
from pathlib import Path

from ..common import hold_experiment_lock
from ..model import remote
from .prepare import prepare
from .recovery import prepare_recovery
from .run import run
from .verify import verify


def main():
    parser = argparse.ArgumentParser(description="CGMacros 6学6测小试；正常27次、硬上限40，不部署")
    parser.add_argument("action", choices=("prepare", "run", "verify", "prepare-recovery"))
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--model-ref", default="default:gpt-5.6-luna")
    parser.add_argument("--related-calls", type=int, default=0)
    parser.add_argument("--server-audit", type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    if args.action == "verify":
        result = verify(directory)
    else:
        directory.mkdir(parents=True, exist_ok=True)
        hold_experiment_lock(directory)
        if args.action == "prepare-recovery":
            result = prepare_recovery(directory, related=args.related_calls, server_audit=args.server_audit)
        elif args.action == "prepare":
            if args.source is None:
                parser.error("prepare需要--source")
            identity = remote({"ref": args.model_ref, "inspect": True})
            if args.model_ref != identity["endpoint"] + ":" + identity["model"]:
                raise ValueError("explicit-model-reference-required")
            result = prepare(directory, args.source, identity)
        else:
            if (directory / "COMPLETE.json").exists():
                result = run(directory)
            else:
                from .transport import SSHLink

                with SSHLink() as link:
                    result = run(directory, link=link)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
