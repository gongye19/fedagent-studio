"""Local-only observation preparation; never start inference or deployment."""

import argparse
import json
from pathlib import Path

from .build import build


def main():
    parser = argparse.ArgumentParser(
        description="离线构建观测样本、按用户切分与预算提案；不调用模型"
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument(
        "--out",
        type=Path,
        required=True,
        help="新的输出子目录；不覆盖现有或partial目录",
    )
    args = parser.parse_args()
    print(json.dumps(build(args.source, args.out), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
