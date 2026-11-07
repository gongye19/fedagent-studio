"""复用 FoT 聚合；平台读取既有过程记录，不重新解题或问诊。"""
from pathlib import Path

from fedagent_fot import FoT
from fedagent_sdk import load_manifest, step

from .application import answer


class RecordFoT(FoT):
    manifest = load_manifest(Path(__file__).with_name('fot.yaml'))

    def code_hash(self):
        import hashlib
        return hashlib.sha256((super().code_hash() + FoT().code_hash()).encode()).hexdigest()

    def solve(self, ctx):
        raise NotImplementedError('过程记录任务不重新生成解答')

    @staticmethod
    def _problem(ctx):
        import json
        value = ctx.item['input']
        return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)

    @step('prepare')
    def prepare(self, ctx):
        events = '\n'.join(f"{event['role']}: {event['content']}" for event in ctx.item['events'])
        ctx.keep('solution', events + '\nFinal result: ' + ctx.item['output'])
        ctx.report('processed', 1)

    def apply(self, artifact, request, model):
        return answer(artifact, request, model)
