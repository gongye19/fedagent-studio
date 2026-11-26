"""prepare不付费；run一次完成提取与对照，失败保留检查点。"""

import argparse

from ..common import digest, hold_experiment_lock, load, save
from ..full.generation.prepare import MODEL_REF
from .calls import Calls
from .evaluate import evaluate
from .extract import extract
from .prepare import DEFAULT, prepare, validate
from .report import report
from .transport import GuidanceLink


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("prepare", "run", "verify"))
    parser.add_argument("--directory", type=type(DEFAULT), default=DEFAULT)
    args = parser.parse_args()
    directory = args.directory.resolve()
    if args.action == "prepare":
        with GuidanceLink(directory) as link:
            identity = link.request({"ref": MODEL_REF, "inspect": True})
        plan = prepare(directory, identity)
        print(
            {
                "normalCalls": plan["normalCalls"],
                "cap": plan["globalCallCap"],
                "counts": plan["counts"],
            }
        )
        return
    plan = validate(directory)
    if args.action == "verify":
        library, result = (
            load(directory / "experience-package.json"),
            load(directory / "report.json"),
        )
        if (
            digest({k: v for k, v in library.items() if k != "digest"})
            != library["digest"]
        ):
            raise ValueError("library-corrupt")
        receipt = load(directory / "COMPLETE.json")
        if receipt != {
            "fingerprint": plan["fingerprint"],
            "reportDigest": digest(result),
            "libraryDigest": library["digest"],
        }:
            raise ValueError("completion-receipt-invalid")
        print(result["summary"])
        return
    hold_experiment_lock(directory)
    if (directory / "COMPLETE.json").exists():
        print("Already complete; use verify. No new model calls.")
        return
    compat = (
        load(directory / "compatibility.json")
        if (directory / "compatibility.json").exists()
        else {}
    )
    approved_stops = compat.get("approvedStops", ["STOP.json"] if compat else [])
    if any(p.name not in approved_stops for p in directory.glob("STOP*.json")):
        raise ValueError("stopped-run-requires-investigation-before-resume")
    try:
        with GuidanceLink(directory) as link:
            calls = Calls(directory, plan, link)
            library = extract(directory, plan, calls)
            results = evaluate(directory, plan, library, calls)
            result = report(directory, plan, library, results, calls.spent())
        save(
            directory / "COMPLETE.json",
            {
                "fingerprint": plan["fingerprint"],
                "reportDigest": digest(result),
                "libraryDigest": library["digest"],
            },
        )
        print(result["summary"])
    except Exception as error:
        stop = f"STOP-resume-{len(approved_stops)}.json" if compat else "STOP.json"
        save(directory / stop, {"type": type(error).__name__, "error": str(error)})
        raise


if __name__ == "__main__":
    main()
