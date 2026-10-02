"""fedagent-client：在参与方的环境里运行。

  fedagent-client run --server https://<平台地址> --token-env FEDAGENT_TOKEN \\
      --dataset ds-xxxx=./dataset.jsonl --model-base-url https://<本地模型>/v1 --model <模型名> \\
      --api-key-env MY_MODEL_KEY [--review]

令牌和模型密钥都从环境变量读，不写在命令行里。--review 时每条要上传的内容先在终端确认。
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

from .worker import ClientConfig, Worker


def _review(channel: str, payload: Any) -> bool:
    print(f"\n要上传到通道 {channel} 的内容：")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return input("上传这一条？[y/N] ").strip().lower() == "y"


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(prog="fedagent-client")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run")
    run.add_argument("--server", required=True)
    run.add_argument("--token-env", default="FEDAGENT_TOKEN", help="存放客户端令牌的环境变量名")
    run.add_argument("--dataset", action="append", default=[], help="数据集 id=本地 JSONL 文件，可以写多次")
    run.add_argument("--model-base-url")
    run.add_argument("--model")
    run.add_argument("--api-key-env", help="存放本地模型密钥的环境变量名")
    run.add_argument("--fake-model", action="store_true", help="测试用：不调用模型")
    run.add_argument("--review", action="store_true", help="上传前逐条确认")
    run.add_argument("--state", type=Path, default=Path(".fedagent-client/state.db"))
    args = parser.parse_args(argv)
    token = os.environ.get(args.token_env)
    if not token:
        sys.exit(f"环境变量 {args.token_env} 里没有客户端令牌")
    datasets = {}
    for value in args.dataset:
        dataset_id, _, path = value.partition("=")
        datasets[dataset_id] = Path(path)
    config = ClientConfig(
        server=args.server,
        token=token,
        datasets=datasets,
        state_path=args.state,
        model_base_url=args.model_base_url,
        model=args.model,
        api_key=os.environ.get(args.api_key_env) if args.api_key_env else None,
        fake_model=args.fake_model,
        review=_review if args.review else None,
    )
    Worker(config).run_forever()


if __name__ == "__main__":
    main()
