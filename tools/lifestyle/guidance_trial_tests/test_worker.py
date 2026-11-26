import sys

import pytest
from fedagent_sdk import ModelError

from tools.lifestyle.guidance_trial.worker import Worker, worker_script


def test_worker_reuses_interpreter_and_preserves_request_values():
    program = """import json,sys
request=json.load(sys.stdin)
sys.test_guidance_count=getattr(sys,'test_guidance_count',0)+1
print(json.dumps({'request':request,'count':sys.test_guidance_count}))
"""
    worker = Worker([sys.executable, "-u", "-c", worker_script(program)])
    try:
        for i in (1, 2):
            body = {
                "messages": [{"role": "user", "content": "中文\nquote"}],
                "settings": {"temperature": 0.7},
                "inspect": i == 1,
            }
            assert worker.exchange(body, 5) == {"request": body, "count": i}
    finally:
        worker.close()
    assert worker.process.poll() == 0


def test_worker_exception_does_not_expose_sensitive_text_or_retry():
    worker = Worker(
        [
            sys.executable,
            "-u",
            "-c",
            worker_script("raise RuntimeError('SECRET-SHOULD-NOT-LEAK')"),
        ]
    )
    try:
        with pytest.raises(ModelError) as error:
            worker.exchange({"inspect": True}, 5)
        assert "SECRET" not in str(error.value)
    finally:
        worker.close()


def test_worker_timeout_ends_local_channel_without_automatic_resend():
    program = "import time; time.sleep(20)"
    worker = Worker([sys.executable, "-u", "-c", worker_script(program)])
    try:
        with pytest.raises(ModelError, match="结果未知"):
            worker.exchange({"messages": []}, 0.1)
        assert worker.process.poll() is not None
    finally:
        worker.close()
