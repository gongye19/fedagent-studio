import hashlib
import json

from .. import models as m
from ..gateway import parse_ref


def fingerprint(platform, session, body) -> str:
    config = body.model_dump(exclude={"name", "check_id"}, by_alias=True)
    files = []
    for choice in body.participants:
        row = session.get(m.Dataset, choice.dataset_id)
        if row:
            path = platform.settings.datasets_dir / (row.content_path or "__missing")
            stamp = path.stat() if path.is_file() else None
            files.append(
                [
                    row.id,
                    row.content_hash,
                    row.schema_version,
                    row.count,
                    row.answered,
                    row.resource_space,
                    row.item_ids,
                    [stamp.st_mtime_ns, stamp.st_size] if stamp else None,
                ]
            )
    refs = {body.client_model, *body.client_overrides.values()} if body.execution == "builtin" else set()
    algorithm = platform.registry.algorithms.get(body.algorithm)
    if algorithm and any(step.at == "server" and step.model for step in algorithm.manifest.steps):
        refs.add(body.server_model)
    models = []
    for ref in sorted(refs):
        row = session.get(m.Endpoint, parse_ref(ref)[0])
        if row:
            models.append([row.id, row.base_url, row.api_key_enc, row.models, row.kind, row.timeout, row.price])
    agents = []
    if body.execution == "agent":
        for agent_id in sorted({body.agent_id or "", *body.agent_overrides.values()}):
            row = session.get(m.AgentEndpoint, agent_id)
            if row:
                agents.append([row.id, row.revision])
    payload = [config, files, models, agents, algorithm.code_hash() if algorithm else None]
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()
