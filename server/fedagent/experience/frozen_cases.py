"""评测输入放在校验哈希的运行文件中，进度仅使用紧凑索引。"""
from .. import models as m
from ..data import DatasetFiles
from ..errors import ServiceError
from ..platform import Platform


def freeze(platform: Platform, job_id: str, cases: list[dict]) -> dict:
    files = DatasetFiles(platform.settings.runs_dir / job_id)
    path, checksum = files.save("cases", cases)
    return {"cases_path": path, "cases_digest": checksum,
            "case_index": [{key: value for key, value in case.items() if key not in ("input", "reference")} for case in cases]}


def index(job: m.Task) -> list[dict]:
    return job.config.get("case_index", job.config.get("cases", []))


def load(platform: Platform, job: m.Task) -> list[dict]:
    if "cases_path" not in job.config:
        return job.config["cases"]
    try:
        checksum = job.config["cases_digest"]
        if job.config["cases_path"] != f"cases/{checksum}.jsonl" or len(checksum) != 64:
            raise ValueError("invalid path")
        cases = DatasetFiles(platform.settings.runs_dir / job.id).load(job.config["cases_path"])
        if [{key: value for key, value in case.items() if key not in ("input", "reference")} for case in cases] != index(job):
            raise ValueError("index mismatch")
        return cases
    except (ValueError, OSError, KeyError, TypeError) as error:
        raise ServiceError(409, "冻结的评测病例校验失败，请恢复运行文件") from error
