"""复用单个SSH Python进程；执行既有桥代码，请求/身份/模型参数均不变。"""

import json
import shlex
import subprocess
import threading

from fedagent_sdk import ModelError

from ..diet_transport import REMOTE


def worker_script(program=REMOTE):
    return """import io,json,sys
original_in,original_out=sys.stdin,sys.stdout
program=compile(PROGRAM,'<existing-fedagent-bridge>','exec')
for line in original_in:
    namespace={}
    capture=io.StringIO()
    sys.stdin,sys.stdout=io.StringIO(line),capture
    failure=None
    try:
        exec(program,namespace)
    except SystemExit as error:
        if error.code not in (None,0): failure='SystemExit'
    except BaseException as error:
        failure=type(error).__name__
    finally:
        if 'runtime' in namespace and 'original' in namespace:
            namespace['runtime'].read_stream=namespace['original']
        if 'gateway' in namespace:
            namespace['gateway'].db.engine.dispose()
        sys.stdin,sys.stdout=original_in,original_out
    if failure:
        print(json.dumps({'workerFailure':failure}),flush=True)
    else:
        try: result=json.loads(capture.getvalue())
        except ValueError: result={'workerFailure':'InvalidBridgeOutput'}
        print(json.dumps(result),flush=True)
""".replace("PROGRAM", repr(program), 1)


WORKER_COMMAND = (
    'cd "$HOME/fedagent-studio/server" && FEDAGENT_DATA_DIR="$HOME/fedagent-studio/data" FEDAGENT_FAKE_ENDPOINT=0 .venv/bin/python -u -c '
    + shlex.quote(worker_script())
)


class Worker:
    def __init__(self, command):
        self.process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )

    def exchange(self, request, timeout):
        result = {}

        def transact():
            try:
                self.process.stdin.write(json.dumps(request) + "\n")
                self.process.stdin.flush()
                result["value"] = json.loads(self.process.stdout.readline())
            except (OSError, ValueError) as error:
                result["error"] = type(error).__name__

        thread = threading.Thread(target=transact, daemon=True)
        thread.start()
        thread.join(timeout)
        if thread.is_alive():
            self.process.kill()
            self.process.wait(timeout=5)
            thread.join(5)
            raise ModelError("SSH工作进程等待超时；结果未知，未重发请求")
        if "error" in result or "workerFailure" in result.get("value", {}):
            raise ModelError("SSH工作进程未完整返回；未重发请求")
        return result["value"]

    def close(self):
        try:
            self.process.stdin.close()
            self.process.wait(timeout=5)
        except (OSError, subprocess.SubprocessError):
            self.process.kill()
            self.process.wait(timeout=5)
        finally:
            self.process.stdout.close()
