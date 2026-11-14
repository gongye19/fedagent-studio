"""平台从上传问诊记录编译过程卡，复用 EvoMedClaw 原版签名聚合。"""
import hashlib
import re
from pathlib import Path

from fedagent_evomed import EvoMedClaw
from fedagent_evomed.grading import DiagnosisClinicalGrader
from fedagent_evomed.vendor.learning.trajectory_canonicalizer import canonicalize_artifacts
from fedagent_evomed.vendor.learning.types import RawScenarioArtifacts
from fedagent_sdk import Algorithm, StepFailed, load_manifest, step

from .application import answer

ROLES = {'doctor': 'LocalDoctor', 'patient': 'Patient', 'test': 'Measurement',
         'router': 'HospitalRoute', 'specialist': 'HospitalExpert'}


class RecordEvo(Algorithm):
    manifest = load_manifest(Path(__file__).with_name('evo.yaml'))
    aggregate = EvoMedClaw.aggregate
    describe = EvoMedClaw.describe
    describe_message = EvoMedClaw.describe_message
    describe_message_items = EvoMedClaw.describe_message_items

    def code_hash(self):
        return hashlib.sha256((super().code_hash() + EvoMedClaw().code_hash()).encode()).hexdigest()

    @step('extract')
    def extract(self, ctx):
        record = ctx.item
        if not record.get('answer'):
            raise StepFailed('EvoMedClaw 经验校验需要记录的参考诊断 answer', pause=True)
        output = re.sub(r'^DIAGNOSIS READY:\s*', '', record['output'], flags=re.I)
        correct = DiagnosisClinicalGrader().evaluate(output, {'answer': record['answer']}, ctx.model)
        dialogue = [{"speaker": ROLES.get(event['role'], event['role']), "text": event['content'],
                     "stage": event.get('stage', 'consultation')} for event in record['events']]
        if not any(event['speaker'] == 'LocalDoctor' and event['text'].startswith('DIAGNOSIS READY:') for event in dialogue):
            dialogue.append({'speaker': 'LocalDoctor', 'text': 'DIAGNOSIS READY: ' + output, 'stage': 'final'})
        outcome = {'scenario_id': int(hashlib.sha256(f'{ctx.site.id}:{record.id}'.encode()).hexdigest()[:12], 16), 'answer': output, 'is_correct': correct}
        raw = RawScenarioArtifacts(Path('uploaded-record'), outcome, dialogue, [])
        # 保存输入的校验结果，编译仍在站点逻辑分组内完成，随后按来源编译增量；上传过程保存在平台。
        ctx.keep('checked_trajectory', {'outcome': outcome, 'dialogue': dialogue})
        ctx.report('processed', 1)
        ctx.report('recordVerified', correct)
        canonicalize_artifacts(raw)

    @step('compile')
    def compile(self, ctx):
        from fedagent_evomed.vendor.federated.sanitize import build_federated_site_delta
        from fedagent_evomed.vendor.learning.card_compiler import compile_card_bank
        from fedagent_evomed.vendor.learning.retrieve_trace import generate_retrieval_traces
        from fedagent_evomed.vendor.learning.skill_attribution import summarize_skill_attribution
        trajectories = []
        for item in ctx.items():
            stored = ctx.recall('checked_trajectory', item_id=item.id)
            if not isinstance(stored, dict):
                raise StepFailed('记录尚未完成校验', pause=True)
            trajectories.append(canonicalize_artifacts(RawScenarioArtifacts(Path('uploaded-record'), stored['outcome'], stored['dialogue'], [])))
        bank = compile_card_bank(trajectories)
        attribution = summarize_skill_attribution(generate_retrieval_traces(trajectories, bank, top_k=3), bank)
        delta = build_federated_site_delta(site_id=ctx.site.id, card_bank=bank, attribution_report=attribution).to_dict()
        delta['metadata'] = {'round': ctx.round, 'plugin_version': self.version}
        ctx.keep('local_card_bank', bank.to_dict())
        ctx.report('localCards', len(bank.cards))
        ctx.send('clinical-cards', delta)

    def apply(self, artifact, request, model):
        return answer(artifact, request, model, cards=True)

    def model_settings(self):
        return {'max_tokens': 4096, 'temperature': 0}

    def fake_reply(self, step_id, prompt, seed):
        if "return JSON with diagnosis" in prompt:
            return '{"diagnosis":"Pneumonia","explanation":"Synthetic test diagnosis."}'
        return EvoMedClaw().fake_reply(step_id, prompt, seed)
