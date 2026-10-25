"""Generate local, standalone live-panel diagrams; never contact task/model APIs."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
TARGET = ROOT / "app/public/algorithm-diagrams"
COLORS = {"blue": "#2563eb", "green": "#15803d", "purple": "#7c3aed", "ink": "#25262b", "muted": "#646b77"}
ALGORITHMS = {
    "fot": {"name": "FoT", "inputs": "本方题库 + 所选 LLM", "actors": "平台提供解题工作流", "local": ["解题", "反思", "提取经验"],
            "server": ["汇总经验", "归类关系", "生成经验库"], "upload": "解题经验", "artifact": "共享经验库", "return": "下一轮解题时使用"},
    "evomedclaw": {"name": "EvoMedClaw", "inputs": "本方病例 + 医疗 Agent API", "actors": "医生 / 病人 / 检查 / 专科", "local": ["本方诊断", "提炼经验卡"],
                   "server": ["按签名聚合经验卡"], "upload": "精简经验卡", "artifact": "全局医疗经验库", "return": "下一轮诊断时检索"},
}


def diagram(key: str, mobile: bool = False) -> dict:
    data = ALGORITHMS[key]
    width = 320 if mobile else 1040
    font, line = (15, 24) if mobile else (18, 26)
    margin, gap, pad = (14, 28, 8) if mobile else (48, 48, 16)
    elements: list[dict] = []
    cfg = {"meta": {"title": data["name"] + " 架构流程示意", "lang": "zh-CN"},
           "canvas": {"width": width, "height": 800, "duration": 18, "fps": 30},
           "theme": {"preset": "light-pastel", "font": "PingFang SC, Microsoft YaHei, Arial, sans-serif", "fontSize": font,
                     "lineHeight": line, "radius": 10, "borderWidth": 1.2, "packetSize": 5, "glow": False,
                     "colors": {**COLORS, "bg": "#ffffff", "fg": COLORS["ink"], "dim": COLORS["muted"], "soft": "#f8fafc", "border": "#dce1e8"}},
           "machines": {}, "elements": elements}

    def text(label: str, x: float, y: float, w: float, *, color="muted", bold=False, size=None):
        elements.append({"type": "text", "t": label, "x": x, "y": y, "w": w, "align": "center", "size": size or font,
                         "c": color, "b": int(bold)})

    def box(x, y, w, h, title, subtitle=None, *, color="blue", container=False):
        lines = [{"t": title, "c": color, "b": 1, "size": font}]
        if subtitle:
            lines.append({"t": subtitle, "c": "muted", "size": font - 2})
        top_pad = pad if container else max(0, (h - line * len(lines)) / 2)
        elements.append({"type": "box", "x": x, "y": y, "w": w, "h": h, "container": container, "color": "border" if container else color,
                         "fill": "soft" if container else "bg", "pad": [top_pad, pad], "align": "center", "lines": lines})

    def wire(points, color="blue", label=None, label_at=None, dashed=False, arrow=True):
        elements.append({"type": "path", "points": points, "color": color, "width": 1.5, "r": 10, "arrow": arrow, "dash": "5,5" if dashed else None,
                         "flow": {"period": 3.2, "offsets": [0.5], "color": color, "tail": 10}})
        if label and label_at:
            x, y = label_at
            w = len(label) * (font - 2) + 16
            elements.append({"type": "box", "x": x - w / 2, "y": y - (line + 8) / 2, "w": w, "h": line + 8, "color": "bg", "fill": "bg", "border": 0,
                             "pad": [4, 6], "lines": [{"t": label, "size": font - 2, "c": color}], "align": "center"})

    def steps(labels, x, y, w, *, color="blue", vertical=False):
        step_gap, step_h = (16, 44) if mobile else (28, 44)
        step_w = w if vertical else (w - step_gap * (len(labels) - 1)) / len(labels)
        rects = []
        for i, label in enumerate(labels):
            sx, sy = (x, y + i * (step_h + step_gap)) if vertical else (x + i * (step_w + step_gap), y)
            box(sx, sy, step_w, step_h, label, color=color)
            rects.append((sx, sy, step_w, step_h))
            if i:
                px, py, pw, ph = rects[i - 1]
                points = [[px + pw / 2, py + ph], [sx + step_w / 2, sy]] if vertical else [[px + pw, py + ph / 2], [sx, sy + step_h / 2]]
                wire(points, color)
        return rects

    top, site_h = (24, 148) if mobile else (12, 160)
    site_w = width - 2 * margin if mobile else (width - 2 * margin - gap) / 2
    sites = []
    for i in range(2):
        x, y = (margin, top + i * (site_h + gap)) if mobile else (margin + i * (site_w + gap), top)
        box(x, y, site_w, site_h, "参与方 " + ("A" if i == 0 else "B"), data["inputs"], container=True)
        text(data["actors"], x + pad, y + (72 if mobile else 84), site_w - 2 * pad, size=font - 2)
        rects = steps(data["local"], x + pad, y + (96 if mobile else 102), site_w - 2 * pad)
        sites.append((x, y, site_w, site_h, rects))

    server_y = sites[-1][1] + site_h + (76 if mobile else 64)
    server_w = width - 2 * margin if mobile else min(width - 2 * margin - 96, max(360, len(data["server"]) * 240))
    server_x = (width - server_w) / 2
    vertical = mobile and len(data["server"]) > 1
    server_h = 64 + (len(data["server"]) * 68 - 24 if vertical else 58) if mobile else 112
    box(server_x, server_y, server_w, server_h, "FedAgent Studio · 聚合端", color="green", container=True)
    steps(data["server"], server_x + pad, server_y + (58 if mobile else 52), server_w - 2 * pad, color="green", vertical=vertical)
    join_y = server_y - (56 if mobile else 40)
    for i, (x, y, w, h, rects) in enumerate(sites):
        if mobile and i == 0:
            wire([[x + w, y + h / 2], [width - 10, y + h / 2], [width - 10, join_y], [width / 2, join_y]], arrow=False)
        else:
            wire([[x + w / 2, y + h], [x + w / 2, join_y], [width / 2, join_y]], arrow=False)
    wire([[width / 2, join_y], [width / 2, server_y]], label=data["upload"],
         label_at=(width / 2 + (88 if mobile else 100), server_y - (28 if mobile else 20)))
    artifact_y = server_y + server_h + (52 if mobile else 36)
    artifact_w = min(width - 2 * margin, 360)
    artifact_x = (width - artifact_w) / 2
    wire([[width / 2, server_y + server_h], [width / 2, artifact_y]], "green")
    artifact_h = 76 if mobile else 68
    artifact_mid = artifact_y + artifact_h / 2
    box(artifact_x, artifact_y, artifact_w, artifact_h, data["artifact"], data["return"], color="purple")
    loop_x = 10 if mobile else 20
    wire([[artifact_x, artifact_mid], [loop_x, artifact_mid], [loop_x, top + 94], [margin, top + 94]], "purple", dashed=True)
    bx, by, bw, _, _ = sites[1]
    right = 10 if mobile else width - 20
    start = artifact_x if mobile else artifact_x + artifact_w
    end = bx if mobile else bx + bw
    wire([[start, artifact_mid], [right, artifact_mid], [right, by + 94], [end, by + 94]], "purple", dashed=True)
    text("共享经验下发 · 后续轮次回用", 0, artifact_y + artifact_h + (36 if mobile else 24), width, color="purple", size=font - 2)
    height = artifact_y + artifact_h + (92 if mobile else 68)
    cfg["canvas"]["height"] = height
    cfg["credit"] = {"text": "文字经验协作 · 不更新模型权重", "y": height - 20, "size": font - 3}
    return cfg


def build(check: bool = False):
    TARGET.mkdir(parents=True, exist_ok=True)
    template = (HERE / "vendor/live-panel.html").read_text()
    controller = (HERE / "controller.js").read_text() if (HERE / "controller.js").exists() else ""
    manifest = {}
    stale = []

    def output(path: Path, content: str):
        if check:
            if not path.exists() or path.read_text() != content:
                stale.append(str(path.relative_to(ROOT)))
        else:
            path.write_text(content)

    for key in ALGORITHMS:
        for mobile in (False, True):
            name = key + ("-mobile" if mobile else "")
            cfg = diagram(key, mobile)
            payload = json.dumps(cfg, ensure_ascii=False).replace("</", "<\\/")
            page = template.replace('lang="en"', 'lang="zh-CN"').replace("<!--LIVE_CONFIG-->", '<script id="live-config" type="application/json">' + payload + '</script>')
            page = page.replace("<!--LIVE_VIEWS-->", "").replace("<!--LIVE_FONTS-->", "")
            page = page.replace('<div id="stage">', '<div id="stage" role="img" aria-label="' + cfg["meta"]["title"] + '">')
            policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none'; base-uri 'none'; form-action 'none'"
            page = page.replace('<meta name="viewport"', '<meta http-equiv="Content-Security-Policy" content="' + policy + '"><meta name="viewport"')
            page = page.replace("</body>", "<script>" + controller + "</script></body>")
            page = "<!-- Generated with live-panel, MIT. License: /licenses/live-panel.txt -->\n" + page
            path = TARGET / (name + ".html")
            output(path, page)
            manifest[name] = {"width": cfg["canvas"]["width"], "height": cfg["canvas"]["height"], "sha256": hashlib.sha256(page.encode()).hexdigest()}
    output(TARGET / "manifest.json", json.dumps(manifest, indent=2) + "\n")
    output(ROOT / "app/src/ui/algorithm/diagram-assets.json", json.dumps(manifest, indent=2) + "\n")
    if stale:
        raise SystemExit("Diagram assets are stale; run npm --prefix app run diagrams:build\n" + "\n".join(stale))
    print("Diagram assets match their source" if check else json.dumps(manifest, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    build(parser.parse_args().check)
