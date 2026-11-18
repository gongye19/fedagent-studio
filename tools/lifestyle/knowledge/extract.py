"""按原文小节提取，保留完整上下文；只接受已核实的发布方正文选择器。"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup, Comment, NavigableString

SELECTORS = {
    "NHS": "article",
    "NIDDK": "article.dk-content .health-detail-content",
    "NHLBI": "article .field--name-field-component-sections",
    "CDC": ".cdc-dfe-body",
}
META = re.compile(
    r"^(references?|resources?|additional .*resources|on this page|related|more (in|information)|"
    r"further information|healthy eating recipes|about this page|download|share|contents)$",
    re.I,
)
ACTION = re.compile(r"\b(eat|drink|choose|limit|avoid|try|aim|start|increase|reduce|should|can help|recommend|keep|build|walk|exercise|stay|do not)\w*\b", re.I)
BLOCK = {"p", "div", "section", "blockquote", "br", "article"}


def text(node):
    return " ".join(node.stripped_strings)


def list_text(node, depth=0):
    lines = []
    for li in node.find_all("li", recursive=False):
        own = BeautifulSoup(str(li), "html.parser")
        for nested in own.select("ul,ol"):
            nested.decompose()
        lines.append("  " * depth + "- " + text(own))
        for nested in li.find_all(["ul", "ol"], recursive=False):
            lines.append(list_text(nested, depth + 1))
    return "\n".join(lines)


def tokens(node):
    if isinstance(node, Comment):
        return
    if isinstance(node, NavigableString):
        if node.strip():
            yield "text", str(node)
        return
    if node.name in ("h1", "h2", "h3", "h4", "h5", "h6"):
        yield node.name, text(node)
        return
    if node.name in ("ul", "ol"):
        yield "block", list_text(node)
        return
    if node.name == "table":
        lines = [text(node.caption)] if node.caption else []
        lines.extend(" | ".join(text(c) for c in row.find_all(["th", "td"], recursive=False)) for row in node.find_all("tr"))
        yield "block", "\n".join(lines)
        return
    for child in node.children:
        yield from tokens(child)
    if node.name in BLOCK:
        yield "break", ""


def extract(raw: bytes, publisher: str):
    soup = BeautifulSoup(raw, "html.parser", from_encoding="utf-8")
    if not soup.h1:
        raise ValueError("missing-title")
    title = text(soup.h1)
    selected = soup.select_one(SELECTORS[publisher])
    if selected is None:
        raise ValueError("selector-missing")
    body = BeautifulSoup(str(selected), "html.parser")
    for tag in body.select("script,style,noscript,nav,aside,form,button,img,svg,video,iframe,picture,.dfe-section__nav,.nhsuk-video,.glossarydefinition"):
        tag.decompose()
    for figure in body.select("figure"):
        if not figure.find("table"):
            figure.decompose()
    for toc in list(body.select("ul,ol")):
        anchors = toc.select("a[href]")
        if anchors and all(a["href"].startswith("#") for a in anchors) and len(text(toc)) <= sum(len(text(a)) for a in anchors) + 10:
            toc.decompose()
    if body.select(".nhsuk-hub-key-links,.beta-hub-key-links"):
        raise ValueError("directory-not-guidance")
    prose = sum(len(text(p)) for p in body.find_all("p"))
    if prose < 300 or not ACTION.search(text(body)):
        raise ValueError("insufficient-guidance-prose")
    dates = [text(n) for n in soup.select(".dk-review-date,.nhsuk-review-date,time[datetime]")]
    dates.extend(text(n.parent) for n in soup.find_all(string=re.compile(r"Last (?:updated|reviewed)", re.I)) if len(text(n.parent)) < 250)
    cautions = [text(n) for n in body.select(".nhsuk-warning-callout,.nhsuk-inset-text,[role=alert],.alert")]
    sections, paragraph, blocks = [], [], []
    heading, level = title, 1

    def flush():
        if paragraph:
            blocks.append(re.sub(r"\s+", " ", " ".join(paragraph)).strip())
            paragraph.clear()

    def section():
        flush()
        value = "\n\n".join(b for b in blocks if b)
        if value:
            sections.append({"heading": heading, "level": level, "text": value})
        blocks.clear()

    for kind, value in tokens(body):
        if kind == "h2":
            section()
            heading, level = value, 2
        elif kind.startswith("h"):
            flush()
            blocks.append(value)
        elif kind == "text":
            paragraph.append(value)
        else:
            flush()
            if value:
                blocks.append(value)
    section()
    full = "\n\n".join(s["heading"] + "\n" + s["text"] for s in sections)
    if len(full) < 400:
        raise ValueError("insufficient-full-context")
    units, review = [], []
    for index, part in enumerate(sections):
        row = {**part, "ordinal": index}
        if META.search(part["heading"].strip()) or re.search(r"^(video:|take .*quiz|sign up|download .*app)", part["heading"], re.I):
            review.append({**row, "reason": "reference-or-navigation"})
        elif len(part["text"]) < 160 or not ACTION.search(part["text"]):
            review.append({**row, "reason": "short-or-not-actionable"})
        elif len(full) > 40000:
            review.append({**row, "reason": "full-context-oversize"})
        else:
            units.append(row)
    return {"title": title, "fullText": full, "cautions": cautions, "sourceDates": dates, "sections": units, "reviewSections": review}
