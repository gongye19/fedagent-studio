"""固定对照的经验边界：同样聚合／转换，本地版本与联邦版本分别校验。"""
import hashlib
import json

from fedagent_sdk import StepFailed

from .vendor.federated.aggregate import aggregate_site_deltas
from .vendor.federated.types import FederatedSiteDelta
from .vendor.learning.legacy_bank_export import build_legacy_bank_payload


def content_receipt(memory):
    return {"sha256": hashlib.sha256(json.dumps(memory, sort_keys=True, ensure_ascii=False).encode()).hexdigest(),
            "entries": sorted(entry["entry_id"] for entry in memory["entries"])}


def shared_content(deltas):
    bank = aggregate_site_deltas([FederatedSiteDelta.from_dict(delta) for delta in deltas])
    memory = build_legacy_bank_payload(bank)
    for entry in memory["entries"]:
        entry.pop("heldout_success_rate", None)
    cards = bank.to_dict()["cards"]
    for card in cards:
        for field in ("heldout_lift", "verifier_score", "false_trigger_rate", "source_cases"):
            card.pop(field, None)
    return {"cards": cards, "memory": memory}


def scope(round):
    return {1: "none", 2: "local", 3: "federated"}[round]


def evaluation_memory(ctx):
    mode = scope(ctx.round)
    if mode != "federated" and ctx.artifact() is not None:
        raise StepFailed("无经验或本地经验组不能加载共享经验", pause=True)
    if mode == "none":
        return None
    if mode == "local":
        memory = ctx.recall("local_memory", item_id="")
        proof = ctx.recall("local_memory_receipt", item_id="")
        if not isinstance(memory, dict) or proof != content_receipt(memory):
            raise StepFailed("本地经验未确认或内容已变化", pause=True)
        return memory
    artifact = ctx.artifact()
    from .site import receipt
    if artifact is None or ctx.recall("memory_receipt", item_id="") != receipt(artifact):
        raise StepFailed("共享记忆尚未确认加载或版本不一致", pause=True)
    return artifact.content["memory"]
