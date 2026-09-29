import html, sys
W, H = 1600, 980
FONT = "'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Heiti SC', 'Noto Sans CJK SC', 'Microsoft YaHei', Arial, sans-serif"
L = []
def add(s): L.append(s)
def esc(s): return html.escape(s, quote=True)
def tw(s, size):
    w = 0.0
    for ch in s:
        if ord(ch) > 0x2E7F: w += size
        elif ch in " ·": w += size * 0.32
        elif ch in "→×": w += size * 0.9
        else: w += size * 0.58
    return w
def rect(x, y, w, h, fill="#ffffff", stroke="#d1d5db", rx=8, dash=None, sw=1.2):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" ry="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')
def text(x, y, s, size=12, weight=400, fill="#111827", anchor="start"):
    add(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}">{esc(s)}</text>')
def box(x, y, w, h, title, subs=(), fill="#ffffff", stroke="#d1d5db", ts=14, ss=11.5, tc="#111827", sc="#4b5563", dash=None, rx=8):
    rect(x, y, w, h, fill, stroke, rx=rx, dash=dash)
    gap = 5
    block = ts + len(subs) * (ss + gap)
    base = y + (h - block) / 2 + ts - 2
    cx = x + w / 2
    text(cx, round(base, 1), title, ts, 600, tc, "middle")
    for i, s in enumerate(subs):
        text(cx, round(base + (i + 1) * (ss + gap), 1), s, ss, 400, sc, "middle")
    for s in (title, *subs):
        need = tw(s, ts if s == title else ss)
        if need > w - 12: print(f"WARN {need:.0f}>{w-12}: {s}", file=sys.stderr)
def label(x, y, s, color, size=11.5):
    w = tw(s, size) + 12
    add(f'<rect x="{x - w/2:.1f}" y="{y - size + 1:.1f}" width="{w:.1f}" height="{size + 7:.1f}" rx="4" fill="#ffffff" opacity="0.96"/>')
    text(x, y + 2, s, size, 500, color, "middle")
BLUE, PURPLE, ORANGE, GREEN, GRAY = "#2563eb", "#7c3aed", "#ea580c", "#16a34a", "#64748b"
MK = {BLUE: "m-blue", PURPLE: "m-purple", ORANGE: "m-orange", GREEN: "m-green", GRAY: "m-gray"}
def path(d, color, width=1.7, dash=None, end=True):
    dd = f' stroke-dasharray="{dash}"' if dash else ""
    me = f' marker-end="url(#{MK[color]})"' if end else ""
    add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}"{dd}{me} stroke-linejoin="round"/>')


add(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">')
add(f'<style>text {{ font-family: {FONT}; }}</style>')
add('<defs>')
for c, m in MK.items():
    add(f'<marker id="{m}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="{c}"/></marker>')
add('</defs>')
add(f'<rect width="{W}" height="{H}" fill="#ffffff"/>')

text(40, 46, "FedAgent Studio · 联邦 Agent 平台整体架构", 24, 700)
text(40, 72, "通用平台：场景 → 任务类型 → 算法（插件）→ 参与方；各方之间不交换原始数据，只交换算法声明的内容；任务产出发布为应用。下半部分以 FoT 为例", 13.5, 400, "#4b5563")

# 分组容器
rect(40, 92, 1520, 88, "#f8fafc", "#cbd5e1", rx=12, dash="6,4")
rect(40, 196, 1520, 104, "#f8fbff", "#bfdbfe", rx=12, dash="6,4")
rect(40, 388, 1520, 128, "#f9fafb", "#d1d5db", rx=12, dash="6,4")
rect(40, 534, 1520, 228, "#fffaf5", "#fed7aa", rx=12, dash="6,4")
rect(40, 800, 1520, 104, "#f8fafc", "#cbd5e1", rx=12, dash="6,4")
text(56, 112, "使用者", 13, 700, "#334155")
text(56, 216, "界面", 13, 700, "#1d4ed8")
text(56, 408, "核心服务", 13, 700, "#374151")
text(56, 554, "示例：FoT 的一轮（横向联邦，目前登记的算法插件）", 13, 700, "#c2410c")
text(56, 820, "基础设施", 13, 700, "#334155")

# 连线（底层）
for cx in (178, 428, 678, 928, 1178, 1428):
    path(f"M{cx},284 V316", BLUE)
path("M802,368 V414", BLUE)
path("M802,498 V560", ORANGE)
path("M686,628 H912", GREEN, 2)
path("M914,700 H688", PURPLE, 2)
path("M224,736 V842", GRAY, 1.4, dash="5,4")
path("M1000,752 V781 H840 V842", GRAY, 1.4, dash="5,4")

# 使用者
users = [
    ("任务发起人", "选场景、任务类型、算法和参与方，看结果，发布应用"),
    ("参与方", "持有数据集：平台托管，或在本地运行客户端"),
    ("管理员", "参与方、算法、模型接口"),
    ("外部 Agent / 脚本", "通过 API 和命令行操作平台"),
]
for i, (t, s) in enumerate(users):
    box(60 + i * 374, 122, 356, 46, t, (s,), "#ffffff", "#cbd5e1", ts=13, ss=11)

# 界面
pages = [
    ("首页", ("三种联邦场景", "一个联邦任务怎么进行")),
    ("联邦任务", ("列表 · 控制台式新建", "概览 · 进度 · 产出 · 配置")),
    ("应用", ("任务产出发布后的成果", "试用 · 内容 · 接入")),
    ("参与方与数据", ("平台托管 / 参与方本地", "上传数据集，浏览器内检查")),
    ("算法", ("注册表：场景、任务类型", "交换内容、产出、参数")),
    ("模型接口", ("预留的默认 LLM 接口", "服务与模型后续配置")),
]
for i, (t, s2) in enumerate(pages):
    box(60 + i * 250, 226, 236, 58, t, s2, "#eff6ff", "#93c5fd", ts=13.5, ss=10.5)

box(150, 318, 1300, 50, "后端 API（REST）", ("界面、命令行 fedagent、参与方客户端 fedagent-client 共用一套接口，权限与审计一致",), "#eff6ff", "#60a5fa", ts=14.5, ss=11.5)

# 核心服务
box(60, 416, 250, 82, "注册表", ("场景 → 任务类型 → 算法", "交换内容 · 产出 · 参数 · 步骤"))
box(326, 416, 250, 82, "任务调度", ("冻结配置 · 排队 · 按轮推进", "暂停 / 继续 · 断点续跑"))
rect(592, 416, 420, 82, "#fff7ed", "#fb923c")
text(802, 436, "算法运行时（插件）", 14, 600, "#111827", "middle")
for i, (t, fill, stroke, color) in enumerate([
    ("横向 · FoT", "#dcfce7", "#86efac", "#166534"),
    ("纵向 · 待接入", "#f3f4f6", "#d1d5db", "#6b7280"),
    ("迁移 · 待接入", "#f3f4f6", "#d1d5db", "#6b7280"),
]):
    rect(606 + i * 134, 446, 124, 26, fill, stroke, rx=6)
    text(668 + i * 134, 463, t, 11.5, 600, color, "middle")
text(802, 489, "插件 = 参与方步骤 + 服务端步骤 + 交换内容 + 产出 + 参数", 11, 400, "#6b7280", "middle")
box(1028, 416, 250, 82, "评测与指标", ("按任务类型评分", "本地 vs 联邦 · 负迁移 · 用量"))
box(1294, 416, 246, 82, "产出与应用", ("每轮一版产出 · 发布为应用", "试用 · 导出 · API"))

# FoT 一轮：参与方
rect(60, 566, 640, 184, "#ffffff", "#fdba74", rx=10, dash="5,4")
text(76, 586, "参与方 × N（每方只读自己的数据集）", 12.5, 700, "#c2410c")
steps_left = [("① 解题", ("带当前经验库作答", "第 1 轮没有经验库 = 本地基线")),
              ("② 反思", ("回顾自己的解法", "找出有效和无效的步骤")),
              ("③ 提取经验", ("可复用的做法与适用条件", "每条是一段文本（论文里的 trace）")) ]
for i, (t, s) in enumerate(steps_left):
    box(76 + i * 208, 598, 192, 60, t, s, "#fff7ed", "#fdba74", ts=13.5, ss=10.5)
box(76, 670, 296, 64, "平台托管", ("平台 worker 运行这一方的 Agent", "数据集在平台：公开数据、演示、验证"), "#ffffff", "#e5e7eb", ts=12.5, ss=10.5)
box(388, 670, 296, 64, "参与方本地", ("fedagent-client 在参与方环境运行", "数据和密钥留本地，上传前可审查"), "#ffffff", "#e5e7eb", ts=12.5, ss=10.5)

# FoT 一轮：服务端
rect(900, 566, 640, 184, "#ffffff", "#fdba74", rx=10, dash="5,4")
text(916, 586, "服务端（只接收解题经验）", 12.5, 700, "#c2410c")
steps_right = [("④ 汇总", ("收集本轮所有参与方", "上传的解题经验")),
               ("⑤ 归类", ("标出前置 / 互补 / 替代关系", "每条经验恰好归入一类")),
               ("⑥ 生成经验库", ("合并上一版经验库", "输出下一轮使用的经验列表")) ]
for i, (t, s) in enumerate(steps_right):
    box(916 + i * 208, 598, 192, 60, t, s, "#fff7ed", "#fdba74", ts=13.5, ss=10.5)
box(916, 670, 608, 64, "产出：经验库（每轮一版）", ("下发给所有参与方，进入下一轮；任意一版可发布为应用，供试用、导出和 API 调用",), "#f5f3ff", "#c4b5fd", ts=13, ss=11)

# 基础设施
box(60, 842, 820, 50, "模型网关（预留 OpenAI 兼容的 LLM API）", ("服务与模型后续配置 · 可给参与方单独指定 · 并发、重试、用量与单价；本地参与方用自己的模型，不经过这里",), ts=13.5, ss=11)
box(896, 842, 320, 50, "存储", ("SQLite 索引 + 每个任务一个运行目录",), ts=13.5, ss=11)
box(1232, 842, 308, 50, "算力", ("FoT 只调模型 API，不需要 GPU；其他算法按需接入",), "#f9fafb", "#d1d5db", ts=13.5, ss=11, dash="5,4")

# 连线标签
label(802, 395, "REST", BLUE)
label(802, 522, "编排每一轮", ORANGE)
label(800, 618, "只上传解题经验", GREEN)
label(800, 690, "下发经验库", PURPLE)
label(224, 781, "模型调用（平台托管）", GRAY, 11)
label(920, 781, "模型调用（服务端）", GRAY, 11)

# 图例
ly = 944
items = [(BLUE, "请求 / API", None), (ORANGE, "运行编排", None), (GREEN, "上传交换内容（FoT：解题经验）", None), (PURPLE, "下发产出（FoT：经验库）", None), (GRAY, "模型调用", "5,4")]
lx = 40
for color, name, dash in items:
    path(f"M{lx},{ly} H{lx + 36}", color, 1.8, dash=dash)
    text(lx + 46, ly + 4, name, 12, 400, "#374151")
    lx += 46 + tw(name, 12) + 40
text(1560, ly + 4, "新算法作为插件登记后，页面按注册表生成，调度不变", 12, 400, "#6b7280", "end")

add('</svg>')
open(sys.argv[1], "w").write("\n".join(L))
print("ok")
