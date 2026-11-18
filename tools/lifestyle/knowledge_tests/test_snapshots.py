import hashlib
import importlib
from pathlib import Path
from urllib.robotparser import RobotFileParser

import httpx
import pytest

from tools.lifestyle.common import jsonl, save

fetch_module = importlib.import_module("tools.lifestyle.knowledge.fetch")
build_module = importlib.import_module("tools.lifestyle.knowledge.build")


def source(raw=b"ok", **extra):
    return {
        "file": "source.html",
        "host": "www.nhs.uk",
        "requestedUrl": "https://www.nhs.uk/live-well/test",
        "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
        **extra,
    }


def robot(text="User-agent: *\nAllow: /\nCrawl-delay: 10"):
    value = RobotFileParser()
    value.parse(text.splitlines())
    return value


@pytest.mark.parametrize("url", ["http://www.nhs.uk/x", "https://evil.test/x", "https://www.nhs.uk:443/x", "https://user@www.nhs.uk/x"])
def test_rejects_unapproved_urls(url):
    with pytest.raises(ValueError, match="unapproved"):
        fetch_module.valid_url(url, "www.nhs.uk")


@pytest.mark.parametrize("status", [429, 503])
def test_retry_after_aborts_without_retry(tmp_path, status):
    client = fetch_module.Downloader()
    client.client.close()
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(status, headers={"Retry-After": "120"})

    client.client = httpx.Client(transport=httpx.MockTransport(handler))
    client.robots["www.nhs.uk"] = robot()
    try:
        with pytest.raises(ValueError, match="Retry-After=120"):
            client.download(source(), tmp_path / "part")
        assert len(requests) == 1
    finally:
        client.close()


def test_redirect_and_size_cap(tmp_path):
    client = fetch_module.Downloader()
    client.client.close()
    client.robots["www.nhs.uk"] = robot()
    client.client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(302, headers={"Location": "https://evil.test/x"})))
    with pytest.raises(ValueError, match="unapproved"):
        client.download(source(), tmp_path / "part")
    client.client.close()
    client.client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=b"too many bytes")))
    client.last.clear()
    with pytest.raises(ValueError, match="size-cap"):
        client.download(source(), tmp_path / "part")
    client.close()


def test_crawl_delay_applies_per_host(tmp_path, monkeypatch):
    sleeps = []
    monkeypatch.setattr(fetch_module.time, "monotonic", lambda: 100)
    monkeypatch.setattr(fetch_module.time, "sleep", sleeps.append)
    client = fetch_module.Downloader()
    client.client.close()
    client.client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=b"ok")))
    client.robots["www.nhs.uk"] = robot()
    client.download(source(), tmp_path / "part")
    client.download(source(), tmp_path / "part")
    assert sleeps == [0, 10]
    client.close()


def test_cached_content_still_checks_robots_and_hash(tmp_path, monkeypatch):
    package, cache, target = (tmp_path / n for n in ("package", "cache", "raw"))
    package.mkdir()
    cache.mkdir()
    robots = b"User-agent: *\nDisallow: /live-well/"
    policy = source(robots, file="robots.raw", kind="robots", url="https://www.nhs.uk/robots.txt")
    save(package / "registry.json", {"policies": [policy], "sourceLimits": {"totalBytes": 10000}})
    jsonl(package / "sources.jsonl", [source()])
    (cache / "robots.raw").write_bytes(robots)
    (cache / "source.html").write_bytes(b"ok")
    monkeypatch.setattr(fetch_module, "PACKAGE", package)
    monkeypatch.setattr(httpx.Client, "send", lambda *a, **k: pytest.fail("unexpected network"))
    with pytest.raises(ValueError, match="robots-unavailable-or-disallowed"):
        fetch_module.fetch(target, [cache])
    assert not (target / "source.html").exists()
    (target / "robots.raw").write_bytes(b"changed")
    with pytest.raises(ValueError, match="snapshot-size-or-hash"):
        fetch_module.fetch(target, [cache])
    assert not list(target.glob("*.part"))


def test_build_reproducibility_and_frozen_tamper_guard(tmp_path, monkeypatch):
    import sys

    package, run, old = (tmp_path / n for n in ("package", "run", "old"))
    package.mkdir()
    (run / "raw").mkdir(parents=True)
    old.mkdir()
    raw = ("<h1>Diet</h1><article><p>" + "Choose vegetables and whole grains. " * 20 + "</p></article>").encode()
    robots = b"User-agent: *\nAllow: /"
    policy = source(robots, file="robots.raw", kind="robots", url="https://www.nhs.uk/robots.txt")
    item = source(
        raw,
        id="one",
        publisher="NHS",
        providerGroup="NHS",
        region="England",
        topic="diet",
        population="adult",
        retrievedAt="2026-11-18",
        finalUrl="https://www.nhs.uk/live-well/test",
        policyIds=[],
    )
    registry = {
        "python": ".".join(map(str, sys.version_info[:3])),
        "dependencies": {},
        "policies": [policy],
        "similarity": {},
        "minimums": {"articles": 1, "topics": 1, "sections": 1, "eachDomain": 1},
        "reuse": {"NHS": {}},
    }
    item["domain"] = "diet"
    save(package / "registry.json", registry)
    save(package / "review-policy.json", {})
    jsonl(package / "sources.jsonl", [item])
    (package / "requirements.txt").write_text("")
    (package.parent / "common.py").write_text("")
    (package.parent / "corpus").mkdir()
    (package.parent / "corpus" / "screen.py").write_text("")
    (run / "raw" / "source.html").write_bytes(raw)
    (run / "raw" / "robots.raw").write_bytes(robots)
    save(old / "inventory.json", {"evaluation": {"HealthBench": 96}, "healthbenchRubrics": 1211})
    save(
        old / "call-estimates.json",
        {"proposals": {"first-recommendation-batch": {"baseCallsWithoutRetriesOrProbe": {"recommendationAnswers": 48, "individualRubricGrades": 682}}}},
    )
    monkeypatch.setattr(build_module, "PACKAGE", package)
    monkeypatch.setattr(build_module, "boundary", lambda *a: {"files": {}, "training": [], "protected": [], "caseQuestions": []})
    monkeypatch.setattr(httpx.Client, "send", lambda *a, **k: pytest.fail("unexpected network"))
    first = build_module.build(run, old, Path("unused"))
    assert first == build_module.build(run, old, Path("unused"))
    assert not first["inventory"]["initialDemoKnowledgeTargetMet"]
    (package.parent / "corpus" / "screen.py").write_text("changed normalization")
    with pytest.raises(ValueError, match="knowledge-input-changed"):
        build_module.build(run, old, Path("unused"))
    (package.parent / "corpus" / "screen.py").write_text("")
    (run / "prepared" / "inventory.json").write_text("{}")
    with pytest.raises(ValueError, match="knowledge-output-corrupted"):
        build_module.build(run, old, Path("unused"))
    import shutil

    shutil.rmtree(run / "prepared")
    save(package / "review-policy.json", {"missing:1": {"decision": "context-only", "textDigest": "any"}})
    with pytest.raises(ValueError, match="review-policy-unmatched"):
        build_module.build(run, old, Path("unused"))
