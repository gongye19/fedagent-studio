import argparse
import json
from pathlib import Path

from ..common import load
from ..quality_audit import ROOT
from .check import check
from .prepare import prepare, verify


def main():
    parser = argparse.ArgumentParser(description="离线来源保真准备与检查；不调用模型、不写平台")
    commands = parser.add_subparsers(dest="action", required=True)
    setup = commands.add_parser("prepare")
    setup.add_argument("--root", type=Path, default=ROOT / "data/lifestyle-prep")
    setup.add_argument("--out", type=Path, required=True)
    validation = commands.add_parser("verify")
    validation.add_argument("--root", type=Path, default=ROOT / "data/lifestyle-prep")
    validation.add_argument("--out", type=Path, required=True)
    inspect = commands.add_parser("check")
    inspect.add_argument("--reference", type=Path, required=True)
    inspect.add_argument("--cards", type=Path, required=True)
    inspect.add_argument("--stage", choices=("trace", "aggregate"), required=True)
    inspect.add_argument("--parents", type=Path)
    args = parser.parse_args()
    if args.action in {"prepare", "verify"}:
        result = (prepare if args.action == "prepare" else verify)(args.root, args.out)
    else:
        result = check(load(args.reference), load(args.cards), stage=args.stage, parents=load(args.parents) if args.parents else None)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    if args.action == "check" and not result["structurePreserved"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
