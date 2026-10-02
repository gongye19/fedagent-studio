"""命令行：fedagent <命令>。

dev                          本地开发：API 和 runner 在同一个进程里（runner 是后台线程）
serve                        只起 API（生产环境，和 runner 分开跑）
runner                       只起 runner
seed                         写入初始数据（数据库是空的才写）
db upgrade | revision -m 说明  数据库迁移
datasets import-fot-bundle 路径  从 FoT 代码包导入 8 份审计过的数学题库
contract 算法 id              在内置题库的前几题上跑契约测试
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import threading
from pathlib import Path


def _platform():
    from .platform import Platform

    return Platform.create()


def _serve(with_runner: bool, host: str | None, port: int | None) -> None:
    import uvicorn

    from .api import create_app
    from .runner import Runner
    from .seed import seed

    platform = _platform()
    seed(platform)
    stop = threading.Event()
    if with_runner:
        threading.Thread(target=Runner(platform).run, args=(stop,), daemon=True, name="runner").start()
    try:
        uvicorn.run(create_app(platform), host=host or platform.settings.host, port=port or platform.settings.port, log_level="info")
    finally:
        stop.set()


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(prog="fedagent", description="FedAgent Studio 后端")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("dev", "serve"):
        sub = commands.add_parser(name)
        sub.add_argument("--host")
        sub.add_argument("--port", type=int)
    commands.add_parser("runner")
    commands.add_parser("seed")
    db = commands.add_parser("db").add_subparsers(dest="action", required=True)
    db.add_parser("upgrade")
    revision = db.add_parser("revision")
    revision.add_argument("-m", "--message", required=True)
    datasets = commands.add_parser("datasets").add_subparsers(dest="action", required=True)
    bundle = datasets.add_parser("import-fot-bundle")
    bundle.add_argument("path", type=Path)
    contract = commands.add_parser("contract")
    contract.add_argument("algorithm")
    contract.add_argument("--per-dataset", type=int, default=2)
    args = parser.parse_args(argv)

    if args.command == "dev":
        _serve(True, args.host, args.port)
    elif args.command == "serve":
        _serve(False, args.host, args.port)
    elif args.command == "runner":
        from .runner import Runner

        Runner(_platform()).run()
    elif args.command == "seed":
        from .seed import seed

        print("已写入初始数据" if seed(_platform()) else "数据库里已有数据，没有改动")
    elif args.command == "db":
        from .migrate import revision as make_revision

        platform = _platform()
        if args.action == "revision":
            make_revision(platform.db, args.message)
    elif args.command == "datasets":
        from .seed import import_fot_bundle, seed

        platform = _platform()
        seed(platform)
        imported = import_fot_bundle(platform, args.path)
        print("已导入：" + "、".join(imported) if imported else "包里没有找到题库文件")
    elif args.command == "contract":
        from .seed import BUILTIN_DIR
        from .testing import run_contract

        files = sorted(BUILTIN_DIR.glob("*.jsonl"))
        datasets_rows = {path.stem: [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()[: args.per_dataset]] for path in files}
        report = run_contract(args.algorithm, datasets=datasets_rows)
        for name, ok in report.checks.items():
            print(("通过  " if ok else "失败  ") + name)
        print(json.dumps(report.details, ensure_ascii=False))
        sys.exit(0 if report.ok else 1)


if __name__ == "__main__":
    main()
