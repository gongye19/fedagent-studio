"""配置检查的线程安全进度；独立接口限量并行，失败后不启动下一批。"""

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

from fedagent_sdk import ModelError, StepFailed

from .. import models as m
from ..errors import ServiceError
from ..schemas.checks import CheckResult


class Progress:
    def __init__(self, platform, check_id: str):
        self.platform = platform
        self.check_id = check_id
        self.results: list[CheckResult] = []
        self.lock = Lock()

    def put(self, entry: CheckResult, index: int | None = None) -> int:
        with self.lock:
            if index is None:
                index = len(self.results)
                self.results.append(entry)
            else:
                self.results[index] = entry
            with self.platform.db.session() as session:
                row = session.get(m.TaskCheck, self.check_id)
                if row:
                    row.results = [result.model_dump() for result in self.results]
            return index

    def attempt(self, field: str, label: str, call: Callable[[Callable[[str], None]], str]) -> bool:
        index = self.put(CheckResult(field=field, resource=label, status="running", message="正在检查"))

        def update(message: str):
            self.put(CheckResult(field=field, resource=label, status="running", message=message), index)

        try:
            message = call(update)
            status = "passed"
        except (ValueError, OSError, ModelError, StepFailed, ServiceError) as error:
            message = str(error) if not isinstance(error, OSError) else "数据文件无法读取，请恢复或重新上传"
            status = "failed"
        self.put(CheckResult(field=field, resource=label, status=status, message=message[:500]), index)
        return status == "passed"


def parallel(jobs: list[Callable[[], bool]]) -> bool:
    # 至多两份同时执行，避免大量测试挤占正式任务的模型额度。
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="config-check") as pool:
        for start in range(0, len(jobs), 2):
            futures = [pool.submit(job) for job in jobs[start:start + 2]]
            passed = [future.result() for future in futures]
            if not all(passed):
                return False
    return True
