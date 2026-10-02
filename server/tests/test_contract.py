import json

from fedagent.seed import BUILTIN_DIR
from fedagent.testing import run_contract


def test_fot_contract(tmp_path) -> None:
    datasets = {path.stem: [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()[:2]] for path in sorted(BUILTIN_DIR.glob("*.jsonl"))}
    report = run_contract("fot", datasets=datasets, workdir=tmp_path)
    assert report.ok, report
    assert report.details["messages"] > 0 and report.details["artifacts"] == 2
