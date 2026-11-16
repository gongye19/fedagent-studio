"""有版本的公开知识和合成画像。读取压缩包而不解压；不传播合成身份字段。"""

from __future__ import annotations

import csv
import hashlib
import io
import re
import xml.etree.ElementTree as ET
import zipfile
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

import httpx

from .common import load, save

PINNED = {
    "medquad.zip": (
        "https://codeload.github.com/abachaa/MedQuAD/zip/577bd37b96c02d1833b2c9eed2de9f96964e96cb",
        "161d948f8ce8f82accca1f5769a512dff2a01af2b3004d48f2b3da2758a38a09",
    ),
    "synthea.csv.zip": (
        "https://raw.githubusercontent.com/synthetichealth/synthea-sample-data/"
        "84f59805d481b9f01f3141ef39e68bdbbeb80132/downloads/latest/synthea_sample_data_csv_latest.zip",
        "990d52064037bbf83d10f13163da428964b56ae673b7f39bf549d78c1e7eda16",
    ),
}
PAGES = {
    "cdc-arthritis": "https://www.cdc.gov/arthritis/prevention/index.html",
    "niddk-living": "https://www.niddk.nih.gov/health-information/diabetes/overview/healthy-living-with-diabetes",
    "nhlbi-dash": "https://www.nhlbi.nih.gov/health/dash-eating-plan",
}
CUTOFF = date(2026, 1, 1)


class PageText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ignore = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.ignore += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.ignore = max(0, self.ignore - 1)

    def handle_data(self, data):
        if not self.ignore and data.strip():
            self.parts.append(data.strip())


def download(url: str) -> bytes:
    with httpx.Client(timeout=60, follow_redirects=True) as client, client.stream("GET", url) as response:
        response.raise_for_status()
        content = bytearray()
        for part in response.iter_bytes():
            content.extend(part)
            if len(content) > 25_000_000:
                raise ValueError("公开源超过 25 MB 限额")
        return bytes(content)


def prepare_sources(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for name, (url, expected) in PINNED.items():
        path = directory / name
        if not path.exists():
            path.write_bytes(download(url))
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"{name} 来源校验失败")
    for key, url in PAGES.items():
        path = directory / (key + ".json")
        if path.exists():
            page = load(path)
            if page["url"] != url or hashlib.sha256(page["text"].encode()).hexdigest() != page["sha256"]:
                raise ValueError(f"{key} 网页快照校验失败")
            continue
        parser = PageText()
        parser.feed(download(url).decode())
        text = "\n".join(parser.parts)
        if len(text) < 1000:
            raise ValueError(f"{key} 没有获得正文")
        save(
            path,
            {
                "url": url,
                "fetched": date.today().isoformat(),
                "text": text,
                "sha256": hashlib.sha256(text.encode()).hexdigest(),
                "license": "US federal health information; retain attribution",
            },
        )


def medquad(directory: Path, collection: str, filename: str):
    with zipfile.ZipFile(directory / "medquad.zip") as archive:
        name = next(n for n in archive.namelist() if n.endswith(f"/{collection}/{filename}.xml"))
        raw = archive.read(name)
    root = ET.fromstring(raw)
    pairs = [
        {"question": q.findtext("Question"), "answer": q.findtext("Answer")} for q in root.findall("./QAPairs/QAPair") if (q.findtext("Answer") or "").strip()
    ]
    if not pairs:
        raise ValueError("MedQuAD 来源没有可用答案（不能使用版权删除的答案）")
    return {
        "document": name,
        "focus": root.findtext("Focus"),
        "url": root.attrib["url"],
        "pairs": pairs,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "license": "CC BY 4.0, MedQuAD / NIH; model-generated adaptation",
    }


def profile(directory: Path, identifier: str) -> dict:
    with zipfile.ZipFile(directory / "synthea.csv.zip") as archive:

        def table(name):
            return list(csv.DictReader(io.StringIO(archive.read(name + ".csv").decode())))

        patient = next(p for p in table("patients") if p["Id"] == identifier)
        born = date.fromisoformat(patient["BIRTHDATE"])
        age = CUTOFF.year - born.year - ((CUTOFF.month, CUTOFF.day) < (born.month, born.day))
        if age < 18 or (patient["DEATHDATE"] and patient["DEATHDATE"] <= CUTOFF.isoformat()):
            raise ValueError("仅使用快照日期时存活的合成成年人")
        clinical = ("diabetes", "hypertension", "obesity", "arthritis", "myocardial", "ischemic", "kidney", "asthma")
        conditions = sorted(
            {
                p["DESCRIPTION"]
                for p in table("conditions")
                if p["PATIENT"] == identifier
                and p["START"][:10] <= CUTOFF.isoformat()
                and (not p["STOP"] or p["STOP"][:10] > CUTOFF.isoformat())
                and any(word in p["DESCRIPTION"].lower() for word in clinical)
            }
        )
        # 不从合成病历推断真实生活习惯、用药或检查结果；未知即未知。
        value = f"合成用户，{age} 岁，性别 {patient['GENDER']}。记录的情况：" + ("；".join(conditions) or "未提供相关慢性病记录")
        value += "。当前用药、运动能力、饮食偏好与近期检查结果未知，请先考虑这些信息缺口。"
        return {
            "id": hashlib.sha256(identifier.encode()).hexdigest()[:16],
            "text": value,
            "asOf": CUTOFF.isoformat(),
            "source": PINNED["synthea.csv.zip"][0],
            "synthetic": True,
        }


def assert_separated(training, heldout) -> None:
    for key in ("person", "document", "focus"):
        left = {str(v[key]).strip().casefold() for v in training}
        right = {str(v[key]).strip().casefold() for v in heldout}
        if left & right:
            raise ValueError(f"训练／留出 {key} 重叠")
    texts = [re.sub(r"\s+", "", v["input"]["profile"] + v["input"]["question"]).casefold() for v in training + heldout]
    if len(texts) != len(set(texts)):
        raise ValueError("训练／留出输入重复")
