"""用开源题库／病例在本地生成过程记录；不上传或创建平台任务。

cd server && uv run python ../tools/process-records/generate.py --help
每个源文件生成单独来源文件，并留出一条未参与生成的输入作应用评测。
"""
import argparse
import hashlib
import json
from pathlib import Path

from fedagent_evomed.bridge import diagnose
from fedagent_evomed.medical import MedicalDiagnosis, normalize_case
from fedagent_records.records import MathRecords, MedicalRecords
from fedagent_sdk import Row
from model import PlatformModel


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--application', choices=['math', 'medical'], required=True)
    parser.add_argument('--source', type=Path, action='append', required=True, help='公开数据 JSONL，每个文件是独立来源')
    parser.add_argument('--source-url', required=True, help='公开数据来源网址，写入 provenance')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--platform', default='http://127.0.0.1:8880')
    parser.add_argument('--model', required=True, help='平台登记的模型引用；不是 API 密钥')
    parser.add_argument('--count', type=int, default=1, choices=range(1, 6))
    parser.add_argument('--turns', type=int, default=12, choices=range(6, 21))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    model = PlatformModel(args.platform, args.model, args.output / 'model-cache')
    manifest = {'application': args.application, 'generated': [], 'heldout': [], 'model': args.model}
    for source_index, source in enumerate(args.source):
        raw = source.read_bytes()
        rows = [json.loads(line) for line in raw.decode().splitlines() if line.strip()]
        if len(rows) <= args.count:
            raise ValueError('每份来源需要额外一条未参与生成的独立评测输入')
        source_hash = hashlib.sha256(raw).hexdigest()
        records = []
        for index, value in enumerate(rows[:args.count]):
            identifier = f'{source.stem}-{index + 1}'
            checkpoint = args.output / f'{args.application}-{source_index + 1}-{index + 1}.record.json'
            provenance = {'kind': 'model-generated-process', 'dataset': args.source_url, 'sourceFile': source.name,
                          'sourceHash': source_hash, 'sourceIndex': index, 'model': args.model,
                          'note': '开源输入上生成的过程，不是真实用户操作或患者就诊记录'}
            if checkpoint.exists():
                record = json.loads(checkpoint.read_text())
                if record['provenance'] != provenance:
                    raise ValueError('缓存来源或模型已变化，请换输出目录')
            elif args.application == 'math':
                question = value['question']
                instruction = 'Solve the mathematical problem. Give a concise, verifiable worked solution and a final boxed answer.'
                reply = model.chat([{'role': 'system', 'content': instruction},
                                    {'role': 'user', 'content': question}])
                record = {'id': identifier, 'input': question, 'events': [{'role': 'solver', 'content': reply.text}],
                          'output': reply.text, 'answer': str(value['answer']), 'provenance': provenance}
            else:
                normalized = normalize_case(value, fallback_id=identifier)
                case = MedicalDiagnosis().strip_labels(normalized)
                result, _ = diagnose(case, None, model, turns=args.turns)
                roles = {'LocalDoctor': 'doctor', 'Patient': 'patient', 'Measurement': 'test',
                         'HospitalRoute': 'router', 'HospitalExpert': 'specialist'}
                events = [{'role': roles.get(event['speaker'], event['speaker']), 'content': event['text'],
                           'stage': event.get('stage', 'consultation')} for event in result['dialogue_history'] if event.get('text')]
                record = {'id': identifier, 'input': case, 'events': events, 'output': result['predicted_diagnosis'],
                          'answer': normalized['answer'], 'provenance': provenance}
            plugin = MathRecords() if args.application == 'math' else MedicalRecords()
            report = plugin.check([Row(1, record)])
            if not report.ok:
                raise ValueError(report.issues)
            checkpoint.write_text(json.dumps(record, ensure_ascii=False, indent=2))
            records.append(record)
            print(f'{identifier}: {len(record["events"])} steps', flush=True)
        target = args.output / f'{args.application}-source-{source_index + 1}.jsonl'
        target.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in records))
        manifest['generated'].append({'file': str(target), 'count': len(records), 'sourceHash': source_hash})
        heldout = rows[args.count]
        if args.application == 'math':
            item = {'input': heldout['question'], 'answer': str(heldout['answer'])}
        else:
            item = normalize_case(heldout, fallback_id='heldout')
            item = {'input': MedicalDiagnosis().strip_labels(item), 'answer': item['answer']}
        manifest['heldout'].append({**item, 'sourceHash': source_hash, 'sourceIndex': args.count})
    manifest['usage'] = model.usage
    (args.output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print('Records validated; no resources uploaded. Usage:', model.usage)


if __name__ == '__main__':
    main()
