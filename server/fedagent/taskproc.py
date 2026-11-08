"""任务进程：python -m fedagent.taskproc <任务 id>。由 runner 启动，跑完（或暂停、取消）后退出。"""

from __future__ import annotations

import logging
import os
import sys

from . import models as m
from .engine import TaskEngine
from .experience import consultation_comparison, evaluation, package_evaluation
from .platform import Platform


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    task_id = sys.argv[1]
    status = "error"
    try:
        platform = Platform.create(migrate=False)
        with platform.db.session() as session:
            job = session.get(m.Task, task_id)
        if job and job.task_type == m.CONSULTATION_COMPARISON:
            status = consultation_comparison.run(platform, job)
        elif job and job.evaluation_package_id:
            status = package_evaluation.run(platform, job)
        elif job and job.source_task_id:
            status = evaluation.run(platform, job)
        else:
            status = TaskEngine(platform, task_id).run()
        logging.getLogger("fedagent.taskproc").info("task %s finished with status %s", task_id, status)
    except Exception:
        logging.getLogger("fedagent.taskproc").exception("task %s crashed", task_id)
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)
    sys.stdout.flush()
    sys.stderr.flush()
    # 暂停、取消时可能还有线程在等模型返回，直接结束进程；这些单元下次续跑时重新执行，已完成的调用从账本取
    os._exit(0)


if __name__ == "__main__":
    main()
