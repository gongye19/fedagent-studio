"""医疗横向经验共享：一次生成、一次聚合、三组独立对照；不绘制虚构的循环。"""


def diagram(mobile=False):
    width, height = (320, 880) if mobile else (1040, 500)
    font = 14 if mobile else 17
    elements = []
    colors = {"blue": "#2563eb", "green": "#15803d", "purple": "#7c3aed", "ink": "#25262b", "muted": "#646b77"}
    cfg = {"meta": {"title": "EvoMedClaw 三组对照", "lang": "zh-CN"},
           "canvas": {"width": width, "height": height, "duration": 18, "fps": 30},
           "theme": {"preset": "light-pastel", "font": "PingFang SC, Microsoft YaHei, Arial, sans-serif", "fontSize": font,
                     "lineHeight": 24, "radius": 10, "borderWidth": 1.2, "packetSize": 5, "glow": False,
                     "colors": {**colors, "bg": "#ffffff", "fg": colors["ink"], "dim": colors["muted"], "soft": "#f8fafc", "border": "#dce1e8"}},
           "machines": {}, "elements": elements,
           "credit": {"text": "同一批独立病例 · 只改变经验来源", "y": height - 16, "size": font - 2}}

    def box(x, y, w, h, title, subtitle=None, color="blue", container=False):
        lines = [{"t": title, "c": "ink" if container else color, "b": 1, "size": font}]
        if subtitle:
            lines.append({"t": subtitle, "c": "muted", "size": font - 2})
        elements.append({"type": "box", "x": x, "y": y, "w": w, "h": h, "container": container,
                         "color": "border" if container else color, "fill": "soft" if container else "bg",
                         "pad": [10 if container else max(0, (h - 24 * len(lines)) / 2), 8], "align": "center", "lines": lines})

    def text(t, x, y, w):
        elements.append({"type": "text", "t": t, "x": x, "y": y, "w": w, "align": "center", "size": font - 2, "c": "muted"})

    def wire(points, color="blue"):
        elements.append({"type": "path", "points": points, "color": color, "width": 1.5, "r": 8, "arrow": True,
                         "flow": {"period": 3.2, "offsets": [0.5], "color": color, "tail": 8}})

    if not mobile:
        for i, x in enumerate((24, 716)):
            name = "A" if i == 0 else "B"
            box(x, 12, 300, 448, f"参与方 {name} · 医疗 Agent", container=True)
            box(x + 18, 65, 264, 48, "学习病例 → 生成经验")
            box(x + 60, 145, 180, 48, f"本地经验 {name}")
            wire([[x + 150, 113], [x + 150, 145]])
            text("同一批本方独立评测病例", x + 18, 220, 264)
            box(x + 52, 251, 230, 48, "① 无经验评测", color="muted")
            box(x + 52, 325, 230, 48, "② 本地经验评测")
            box(x + 52, 399, 230, 48, "③ 联邦经验评测", color="green")
            wire([[x + 60, 169], [x + 34, 169], [x + 34, 349], [x + 52, 349]])
        box(395, 130, 250, 64, "平台聚合", "共享精简经验卡", color="green")
        wire([[264, 169], [360, 169], [360, 162], [395, 162]])
        wire([[776, 169], [680, 169], [680, 162], [645, 162]])
        box(395, 272, 250, 64, "共享经验 A + B", "冻结版本 · 不继续学习", color="green")
        wire([[520, 194], [520, 272]], "green")
        wire([[395, 304], [354, 304], [354, 423], [306, 423]], "green")
        wire([[645, 304], [686, 304], [686, 423], [768, 423]], "green")
    else:
        for i, y in enumerate((12, 192)):
            name = "A" if i == 0 else "B"
            box(16, y, 288, 144, f"参与方 {name} · 医疗 Agent", container=True)
            box(42, y + 48, 236, 38, "本方学习病例 → 生成经验")
            box(80, y + 102, 160, 32, f"本地经验 {name}")
            wire([[160, y + 86], [160, y + 102]])
        box(48, 384, 224, 60, "平台聚合", "共享精简经验卡", color="green")
        wire([[240, 130], [310, 130], [310, 367], [214, 367], [214, 384]])
        wire([[160, 336], [160, 384]])
        box(48, 486, 224, 60, "共享经验 A + B", "冻结版本 · 不继续学习", color="green")
        wire([[160, 444], [160, 486]], "green")
        box(16, 590, 288, 258, "各方分别完成三组评测", "使用同一批本方独立评测病例", container=True)
        box(42, 666, 236, 40, "① 无经验", color="muted")
        box(42, 722, 236, 40, "② 只用本方经验")
        box(42, 778, 236, 40, "③ 使用共享经验 A + B", color="green")
        wire([[48, 516], [8, 516], [8, 798], [42, 798]], "green")
    return cfg
