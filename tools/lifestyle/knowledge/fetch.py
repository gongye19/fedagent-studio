"""固定快照复制／下载。每站串行，逐跳验证 URL、robots 与间隔，不绕过拒绝。"""

from __future__ import annotations

import hashlib
import shutil
import time
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import httpx

from ..common import load, rows

PACKAGE = Path(__file__).parent
USER_AGENT = "FedAgentStudio-Research/1.0"
HOSTS = {"www.nhs.uk", "www.niddk.nih.gov", "www.nhlbi.nih.gov", "www.cdc.gov"}


def file_hash(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify(path, source):
    if path.name != source["file"] or path.stat().st_size != source["bytes"] or source["bytes"] > 2000000 or file_hash(path) != source["sha256"]:
        raise ValueError("snapshot-size-or-hash-mismatch: " + source["file"])


def valid_url(url, host):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc != host or host not in HOSTS or parsed.username or parsed.fragment:
        raise ValueError("unapproved-source-or-redirect")


class Downloader:
    def __init__(self):
        self.robots, self.last = {}, {}
        self.client = httpx.Client(timeout=45, follow_redirects=False, headers={"User-Agent": USER_AGENT})

    def close(self):
        self.client.close()

    def download(self, source, destination):
        host = source["host"]
        current = source.get("requestedUrl", source.get("url"))
        for _ in range(6):
            valid_url(current, host)
            robot = self.robots.get(host)
            if source.get("kind") != "robots" and (robot is None or not robot.can_fetch(USER_AGENT, current)):
                raise ValueError("robots-unavailable-or-disallowed")
            delay = max(1, (robot.crawl_delay(USER_AGENT) if robot else None) or 0)
            time.sleep(max(0, delay - (time.monotonic() - self.last.get(host, 0))))
            self.last[host] = time.monotonic()
            with self.client.stream("GET", current) as response:
                if response.status_code in (429, 503):
                    raise ValueError("source-deferred; Retry-After=" + response.headers.get("retry-after", "unspecified"))
                if response.is_redirect:
                    current = urljoin(current, response.headers["location"])
                    continue
                response.raise_for_status()
                if source.get("finalUrl") and current != source["finalUrl"]:
                    raise ValueError("source-final-url-changed")
                if source.get("publisher") and "text/html" not in response.headers.get("content-type", ""):
                    raise ValueError("source-not-html")
                count = 0
                with destination.open("wb") as stream:
                    for chunk in response.iter_bytes():
                        count += len(chunk)
                        if count > min(source["bytes"], 2000000):
                            raise ValueError("source-exceeds-size-cap")
                        stream.write(chunk)
                return
        raise ValueError("source-redirect-limit")


def fetch(directory: Path, cache: list[Path]):
    registry = load(PACKAGE / "registry.json")
    sources = registry["policies"] + rows(PACKAGE / "sources.jsonl")
    if sum(s["bytes"] for s in sources) > registry["sourceLimits"]["totalBytes"]:
        raise ValueError("source-total-cap")
    directory.mkdir(parents=True, exist_ok=True)
    client = Downloader()
    try:
        ordered = sorted(sources, key=lambda s: (s.get("kind") != "robots", s["file"]))
        for source in ordered:
            if Path(source["file"]).name != source["file"]:
                raise ValueError("invalid-snapshot-filename")
            if source.get("kind") != "robots":
                robot = client.robots.get(source["host"])
                for url in (source.get("requestedUrl", source.get("url")), source.get("finalUrl", source.get("url", source.get("requestedUrl")))):
                    valid_url(url, source["host"])
                    if robot is None or not robot.can_fetch(USER_AGENT, url):
                        raise ValueError("robots-unavailable-or-disallowed")
            destination = directory / source["file"]
            if not destination.exists():
                cached = next((p / source["file"] for p in cache if (p / source["file"]).is_file()), None)
                temporary = directory / (source["file"] + ".part")
                try:
                    if cached:
                        verify(cached, source)
                        shutil.copyfile(cached, temporary)
                    else:
                        client.download(source, temporary)
                    if temporary.stat().st_size != source["bytes"] or file_hash(temporary) != source["sha256"]:
                        raise ValueError("source-content-changed; use new registry and directory")
                    temporary.replace(destination)
                finally:
                    temporary.unlink(missing_ok=True)
            verify(destination, source)
            if source.get("kind") == "robots":
                robot = RobotFileParser()
                robot.parse(destination.read_text().splitlines())
                client.robots[source["host"]] = robot
    finally:
        client.close()
