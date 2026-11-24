"""Usage: uv run --project server python -m tools.lifestyle.sensors --raw ... --out ..."""

import argparse
import json
from pathlib import Path

from .build import build


def main():
    parser = argparse.ArgumentParser(
        description="本地清理 CGMacros / LifeSnaps；不上传、不调用模型"
    )
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument(
        "--out", type=Path, required=True, help="必须是全新的目录；失败保留 .partial"
    )
    args = parser.parse_args()
    print(json.dumps(build(args.raw, args.out), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
