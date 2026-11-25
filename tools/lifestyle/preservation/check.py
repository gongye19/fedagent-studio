"""逐阶段比较规范字段并核验真实父记录；纯文本和叙述不冒充已核验事实。"""

from copy import deepcopy

from ..common import digest
from .reference import (
    PROTOCOL,
    canonical,
    reference_digest,
    source_refs,
    validate_reference,
)

KEYS = {"protocol", "id", "stage", "kind", "evidenceKind", "referenceId", "referenceDigest", "sourceRefs", "fields", "parentRefs"}


def check(reference, cards, *, stage, parents=None):
    validate_reference(reference)
    if stage not in {"trace", "aggregate"}:
        raise ValueError("unsupported-stage")
    parents = [] if parents is None else parents
    issues = []

    def issue(code, card=None, field=None):
        issues.append({"code": code, "card": card, "field": field})

    parent_map = {}
    if stage == "aggregate":
        parent_report = check(reference, parents, stage="trace")
        if not parent_report["structurePreserved"]:
            issue("invalid-or-incomplete-parent-stage")
        if parent_report["structurePreserved"]:
            parent_map = {digest(card): card for card in parents if isinstance(card, dict)}
    if not isinstance(cards, list) or not cards:
        issue("structured-card-list-required")
        cards = []
    expected = {key: fact["value"] for key, fact in reference["fields"].items()}
    covered, identifiers = set(), set()
    for card in cards:
        try:
            canonical(card)
        except (ValueError, TypeError):
            issue("non-json-or-nonfinite-value")
            continue
        if not isinstance(card, dict) or set(card) != KEYS:
            issue("card-schema")
            continue
        key = card["id"]
        if not isinstance(key, str) or not key.strip() or key in identifiers:
            issue("invalid-or-duplicate-card-id")
            continue
        identifiers.add(key)
        if card["protocol"] != PROTOCOL or card["stage"] != stage:
            issue("card-version-or-stage", key)
        if card["kind"] != reference["kind"] or card["evidenceKind"] != reference["evidenceKind"]:
            issue("evidence-kind-changed", key)
        if card["referenceId"] != reference["id"] or card["referenceDigest"] != reference_digest(reference):
            issue("reference-binding-changed", key)
        if card["sourceRefs"] != source_refs(reference):
            issue("source-or-version-binding-changed", key)
        fields = card["fields"]
        if not isinstance(fields, dict) or not fields:
            issue("card-fields-required", key)
            continue
        links = card["parentRefs"]
        if not isinstance(links, list) or any(not isinstance(v, str) for v in links) or len(links) != len(set(links)):
            issue("invalid-parent-references", key)
            links = []
        if stage == "trace" and links:
            issue("trace-must-bind-source-not-invent-parent", key)
        if stage == "aggregate" and (not links or any(v not in parent_map for v in links)):
            issue("unresolved-parent-reference", key)
        for name, value in fields.items():
            if name not in expected:
                issue("unregistered-field", key, name)
            elif canonical(value) != canonical(expected[name]):
                issue("field-value-changed", key, name)
            else:
                covered.add(name)
            if stage == "aggregate" and not any(
                link in parent_map
                and name in parent_map[link].get("fields", {})
                and canonical(parent_map[link]["fields"][name]) == canonical(value)
                for link in links
            ):
                issue("field-not-supported-by-selected-parents", key, name)
    for field in sorted(expected.keys() - covered):
        issue("required-field-missing", field=field)
    return {
        "protocol": PROTOCOL,
        "referenceId": reference["id"],
        "referenceDigest": reference_digest(reference),
        "stage": stage,
        "structurePreserved": not issues,
        "coveredFields": sorted(covered),
        "issues": issues,
        "scope": "registered-structured-fields-and-lineage-only",
        "narrativeValidated": False,
        "medicalEfficacyValidated": False,
        "platformAdmission": False,
    }


def regression_control(reference, *, stage="trace", parents=None, fields=None):
    """人工正向验收夹具，不是算法生成的经验；保留显式control名称。"""
    validate_reference(reference)
    return {
        "protocol": PROTOCOL,
        "id": "manual-control-" + reference["id"] + "-" + stage,
        "stage": stage,
        "kind": reference["kind"],
        "evidenceKind": reference["evidenceKind"],
        "referenceId": reference["id"],
        "referenceDigest": reference_digest(reference),
        "sourceRefs": source_refs(reference),
        "fields": deepcopy({k: v["value"] for k, v in reference["fields"].items()} if fields is None else fields),
        "parentRefs": [digest(p) for p in (parents or [])],
    }
