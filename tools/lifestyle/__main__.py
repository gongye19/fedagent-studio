"""从仓库根目录运行：uv run --project server python -m tools.lifestyle prepare|run|serve。"""

from __future__ import annotations

import argparse
from pathlib import Path

from .common import hold_experiment_lock, load
from .prepare import prepare


def main():
    parser = argparse.ArgumentParser(description="LifeStyle 本机隔离准备与小规模实测（不部署）")
    parser.add_argument("command", choices=["prepare", "run", "serve"])
    parser.add_argument("--directory", type=Path, default=Path("data/lifestyle-prep"))
    parser.add_argument("--model", help="服务器明确的 接口id:模型名；仅 run/serve 需要")
    parser.add_argument("--limit", type=int, default=50, help="最多真实模型调用次数（1–50），含失败和修正")
    parser.add_argument("--port", type=int, default=8891)
    args = parser.parse_args()
    directory = args.directory.resolve()
    # 防止误指向项目当前库或生产部署；实验库只可落在专用目录下。
    if "lifestyle-prep" not in directory.parts:
        parser.error("实验目录路径必须包含 lifestyle-prep；不可覆盖现有平台数据")
    directory.mkdir(parents=True, exist_ok=True)
    try:
        hold_experiment_lock(directory)
    except BlockingIOError:
        parser.error("这个实验目录已有进程运行，不能并发重复计费")
    if args.command == "prepare":
        manifest = prepare(directory)
        print("Prepared", manifest["fingerprint"], "3 training / 3 heldout; no model calls")
        return
    if not args.model:
        parser.error("run/serve 需要 --model 接口id:模型名")
    from .model import CachedModel
    from .runner import federate, local_platform

    model = CachedModel(directory, args.model, args.limit)
    platform = local_platform(directory, model)
    if args.command == "serve":
        import uvicorn
        from fedagent.api import create_app

        uvicorn.run(create_app(platform), host="127.0.0.1", port=args.port)
        return
    from .evaluate import evaluate
    from .generate import generate
    from .report import report

    manifest = load(directory / "prepared.json")
    records = generate(directory, manifest, model)
    state, shared = federate(directory, manifest, records, platform)
    results = evaluate(directory, manifest, state, shared, platform, model)
    value = report(directory, manifest, state, shared, results, model)
    print(value["summary"])
    print(directory / "report.html")
    if value["summary"]["incompleteCases"]:
        raise SystemExit("评测尚未完成；检查报告，不能声称通过")


if __name__ == "__main__":
    main()
