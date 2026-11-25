"""人工审定的参考字段是信任边界；代码验证出处与结构，不判断医学真伪。"""

import json

from ..common import digest

PROTOCOL = "lifestyle-preservation/1"
SCHEMAS = {
    "guideline-action": (
        "official-guidance",
        "published-source",
        {"population", "goal", "action", "parameters", "exceptions", "unknowns"},
    ),
    "observational-pattern": (
        "observational-association",
        "dataset-snapshot",
        {
            "populationAndContext",
            "exposureDefinition",
            "outcomeDefinition",
            "deviceAndQuality",
            "subjectCount",
            "observationCount",
            "analysisMethod",
            "uncertainty",
            "confoundingLimits",
            "trainingSplitDigest",
        },
    ),
    "workflow-strategy": (
        "derived-procedural-strategy",
        "trace-snapshot",
        {"algorithmAndPromptVersion", "applicableTask", "inputConditions", "steps", "limits", "sourceMappingStatus"},
    ),
}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def nonempty(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("nonempty-text-required")
    return value


def reference_digest(reference):
    return digest(reference)


def validate_reference(reference):
    canonical(reference)
    expected = {"protocol", "id", "kind", "evidenceKind", "sources", "fields", "review"}
    if not isinstance(reference, dict) or set(reference) != expected or reference["protocol"] != PROTOCOL:
        raise ValueError("reference-schema")
    nonempty(reference["id"])
    if not isinstance(reference["kind"], str) or reference["kind"] not in SCHEMAS:
        raise ValueError("unsupported-reference-kind")
    evidence, source_kind, fields = SCHEMAS[reference["kind"]]
    if reference["evidenceKind"] != evidence:
        raise ValueError("evidence-kind-mismatch")
    review = reference["review"]
    if (
        not isinstance(review, dict)
        or set(review) != {"reviewer", "scope", "medicalEfficacyReviewed"}
        or review["scope"] != "source-context-and-field-annotation"
        or review["medicalEfficacyReviewed"] is not False
    ):
        raise ValueError("reference-review-scope")
    nonempty(review["reviewer"])
    sources = reference["sources"]
    if not isinstance(sources, list) or not sources:
        raise ValueError("source-required")
    source_map = {}
    for source in sources:
        if not isinstance(source, dict) or set(source) != {"id", "kind", "body", "bodyDigest", "metadata"}:
            raise ValueError("source-schema")
        nonempty(source["id"])
        nonempty(source["body"])
        if source["id"] in source_map or source["kind"] != source_kind or digest(source["body"]) != source["bodyDigest"]:
            raise ValueError("source-identity-or-body-changed")
        if not isinstance(source["metadata"], dict) or not {"url", "version", "dateStatus"} <= source["metadata"].keys():
            raise ValueError("source-version-metadata")
        for key in ("url", "version", "dateStatus"):
            nonempty(source["metadata"][key])
        source_map[source["id"]] = source
    if not isinstance(reference["fields"], dict) or set(reference["fields"]) != fields:
        raise ValueError("reference-required-fields")
    for fact in reference["fields"].values():
        if not isinstance(fact, dict) or set(fact) != {"value", "support", "annotation"}:
            raise ValueError("reference-fact-schema")
        if fact["value"] is None or fact["value"] in ("", [], {}):
            raise ValueError("reference-fact-value-required")
        nonempty(fact["annotation"])
        if not isinstance(fact["support"], list) or not fact["support"]:
            raise ValueError("fact-source-span-required")
        for support in fact["support"]:
            if not isinstance(support, dict) or set(support) != {"sourceId", "quote"}:
                raise ValueError("source-span-schema")
            quote = " ".join(nonempty(support["quote"]).split())
            if support["sourceId"] not in source_map or quote not in " ".join(source_map[support["sourceId"]]["body"].split()):
                raise ValueError("source-span-not-found")
    if reference["kind"] == "observational-pattern":
        subjects, observations = (reference["fields"][k]["value"] for k in ("subjectCount", "observationCount"))
        if type(subjects) is not int or type(observations) is not int or not 1 <= subjects <= observations:
            raise ValueError("invalid-subject-or-observation-count")
    return reference


def source_refs(reference):
    return {s["id"]: digest(s) for s in reference["sources"]}
