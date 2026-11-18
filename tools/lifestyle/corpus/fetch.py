"""固定版本、精确大小和 SHA256 的公共数据下载；支持复用已有本机文件。"""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

import httpx

from ..common import load

CATALOG = Path(__file__).with_name("sources.json")


def verify(path: Path, source: dict) -> None:
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if path.stat().st_size != source["bytes"] or actual != source["sha256"]:
        raise ValueError(f"来源大小或摘要不匹配：{source['file']}")


def fetch(directory: Path, reuse: list[Path]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for source in load(CATALOG)["files"]:
        destination = directory / source["file"]
        if destination.exists():
            verify(destination, source)
            continue
        cached = next((p / source["file"] for p in reuse if (p / source["file"]).is_file()), None)
        temporary = destination.with_suffix(destination.suffix + ".part")
        try:
            if cached:
                verify(cached, source)
                shutil.copyfile(cached, temporary)
            else:
                with (
                    httpx.Client(timeout=60, follow_redirects=True) as client,
                    client.stream("GET", source["url"]) as response,
                ):
                    response.raise_for_status()
                    size = 0
                    with temporary.open("wb") as stream:
                        for chunk in response.iter_bytes():
                            size += len(chunk)
                            if size > source["bytes"]:
                                raise ValueError(f"下载超过来源清单大小：{source['file']}")
                            stream.write(chunk)
            verify(temporary, source)
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
