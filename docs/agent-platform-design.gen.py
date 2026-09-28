import html, sys
W, H = 1600, 930
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

text(40, 46, "联邦 Agent 平台 · 整体设计", 24, 700)
text(40, 72, "先选场景，再选算法和数据；各方 Agent 只上传文本形式的推理经验（trace），服务端汇成洞见库下发，题目与解答不离开本方", 13.5, 400, "#4b5563")

# 分组容器
rect(40, 92, 1520, 72, "#f8fafc", "#cbd5e1", rx=12, dash="6,4")
rect(40, 184, 1520, 106, "#f8fbff", "#bfdbfe", rx=12, dash="6,4")
rect(40, 368, 1520, 106, "#f9fafb", "#d1d5db", rx=12, dash="6,4")
rect(40, 498, 1520, 236, "#fffaf5", "#fed7aa", rx=12, dash="6,4")
rect(40, 758, 1520, 96, "#f8fafc", "#cbd5e1", rx=12, dash="6,4")

text(56, 112, "场景", 13, 700, "#334155")
text(56, 204, "页面", 13, 700, "#1d4ed8")
text(56, 388, "后端服务", 13, 700, "#374151")
text(56, 518, "FoT 的一轮（横向与迁移共用）", 13, 700, "#c2410c")
text(56, 778, "基础设施", 13, 700, "#334155")

rect(60, 530, 700, 156, "#ffffff", "#fdba74", rx=10, dash="5,4")
text(76, 552, "参与方 Agent × N（每方只读自己的任务数据）", 12.5, 700, "#c2410c")
rect(840, 530, 700, 156, "#ffffff", "#fdba74", rx=10, dash="5,4")
text(856, 552, "服务端（只接收 trace）", 12.5, 700, "#c2410c")
# 连线（底层）
for cx in (192, 490, 788, 1086, 1384):
    path(f"M{cx},276 V300", BLUE)
path("M800,344 V380", BLUE)
path("M788,462 V530", ORANGE)
path("M300,690 V772", GRAY, 1.4, dash="5,4")
path("M1470,690 V772", GRAY, 1.4, dash="5,4")
path("M760,618 H832", GREEN, 2)
path("M1414,662 V706 H182 V664", PURPLE, 1.8)

# 场景
scen = [
    ("横向联邦 Agent · 可运行", "同类任务、不同题目 · 算法：FoT"),
    ("联邦迁移 Agent · 开发中", "源领域的洞见库迁到目标领域 · 算法：FoT（源 → 目标）"),
    ("纵向联邦 Agent · 规划中", "同一问题、信息分在多方 · 算法：协调者协同推理（自研）"),
]
for i, (t, s) in enumerate(scen):
    fill = ["#f0fdf4", "#fff7ed", "#f8fafc"][i]
    stroke = ["#86efac", "#fdba74", "#cbd5e1"][i]
    box(120 + i * 480, 102, 456, 52, t, [s], fill, stroke, ts=14, ss=11.5, dash="4,3" if i == 2 else None)

# 页面
pages = [
    ("首页 · 选场景", ["三个场景卡片 · 最近任务"]),
    ("新建任务", ["算法 · 数据与参与方 · 运行参数", "配置清单 + 调用量与费用预估"]),
    ("任务详情", ["每轮进度流程图 · 本地 vs 联邦对比", "准确率曲线 · 洞见库各轮版本"]),
    ("应用", ["选一个洞见库解新题", "有库 / 无库 答案对比"]),
    ("基础管理", ["参与方 · 数据集 · 模型", "用户与角色"]),
]
for i, (t, s) in enumerate(pages):
    box(64 + i * 298, 212, 256, 64, t, s, "#eff6ff", "#bfdbfe")

box(120, 300, 1360, 44, "后端 API（FastAPI）", ["界面与命令行 fedagent run -f task.yaml 共用一套接口"], "#eef2ff", "#c7d2fe", ts=14)

services = [
    ("注册表", ["场景 → 算法 → 数据集", "数据格式与评测方式"]),
    ("任务管理", ["排队 · 断点续跑 · 进度", "配置与提示词哈希审计"]),
    ("FoT 运行引擎", ["基于已审计的复现器", "上游 Prompt 1–5 原样使用"]),
    ("应用推理", ["洞见库 + 模型 → 解新题", "单题 / 批量 · 有库无库对比"]),
    ("评测与指标", ["逐题判分 · 每轮准确率", "负迁移率 · token 与费用"]),
]
for i, (t, s) in enumerate(services):
    fill = "#fff7ed" if i == 2 else "#ffffff"
    stroke = "#fdba74" if i == 2 else "#d1d5db"
    box(64 + i * 298, 396, 256, 66, t, s, fill, stroke)

# FoT 一轮
steps_c = [("① 解题", ["带当前洞见库", "第 1 轮无库 = 各方独立基线"]),
           ("② 反思", ["分析自己的解法", "提炼可复用的步骤"]),
           ("③ 提取 trace", ["输出 JSON：", "insight_* → 做法与适用条件"])]
for i, (t, s) in enumerate(steps_c):
    box(80 + i * 226, 572, 204, 90, t, s, "#fff7ed", "#fed7aa", ts=13.5, ss=11)
for i in range(2):
    x = 80 + (i + 1) * 226 - 22
    path(f"M{x},617 H{x + 20}", ORANGE, 1.6)
text(744, 678, "题目、标准答案与解答都留在本方，不上传", 11.5, 400, "#6b7280", "end")

steps_s = [("④ 汇总 trace", ["收集本轮所有参与方", "上传的推理经验"]),
           ("⑤ 关系分析", ["聚类 · 前置 / 互补 / 替代", "每条 trace 恰好归入一类"]),
           ("⑥ 生成洞见库", ["合并上一版洞见库", "输出下一轮的 insight_* 列表"])]
for i, (t, s) in enumerate(steps_s):
    box(860 + i * 226, 572, 204, 90, t, s, "#fff7ed", "#fed7aa", ts=13.5, ss=11)
for i in range(2):
    x = 860 + (i + 1) * 226 - 22
    path(f"M{x},617 H{x + 20}", ORANGE, 1.6)

# 基础设施
box(64, 786, 480, 56, "模型网关（OpenAI 兼容）", ["OpenRouter / GLM · 每个参与方可配不同模型 · 并发与用量统计"], "#ffffff", "#cbd5e1")
box(560, 786, 480, 56, "存储", ["SQLite 索引 + 每个任务一个目录：检查点 · 各轮洞见库 · 指标"], "#ffffff", "#cbd5e1")
box(1056, 786, 480, 56, "不需要", ["GPU（模型走 API）· K8s · 沙箱（FoT 不执行代码）"], "#f8fafc", "#cbd5e1", dash="4,3")

# 连线标签
label(800, 361, "REST", BLUE)
label(788, 505, "编排每一轮", ORANGE)
label(796, 600, "只上传 trace", GREEN)
label(800, 710, "下发完整洞见库，进入下一轮", PURPLE)
label(300, 748, "模型调用", GRAY, 11)
label(1470, 748, "模型调用", GRAY, 11)

# 图例
ly = 890
items = [(BLUE, None, "请求 / API"), (ORANGE, None, "运行编排"), (GREEN, None, "上传的只有 trace"), (PURPLE, None, "洞见库下发"), (GRAY, "5,4", "模型调用")]
x = 40
for c, d, n in items:
    path(f"M{x},{ly} H{x + 30}", c, 1.8, dash=d)
    text(x + 38, ly + 4, n, 12, 400, "#4b5563")
    x += 38 + tw(n, 12) + 28
add('</svg>')
open(sys.argv[1], "w").write("\n".join(L))
print("ok")
