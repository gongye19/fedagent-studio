import html, sys

W, H = 1600, 1064
FONT = "'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Heiti SC', 'Noto Sans CJK SC', 'Microsoft YaHei', Arial, sans-serif"
L = []
def add(s): L.append(s)
def esc(s): return html.escape(s, quote=True)

def text_width(s, size):
    w = 0.0
    for ch in s:
        if ord(ch) > 0x2E7F: w += size          # CJK
        elif ch in " ·": w += size * 0.32
        elif ch in "→": w += size * 0.9
        else: w += size * 0.58
    return w

def rect(x, y, w, h, fill="#ffffff", stroke="#d1d5db", rx=8, dash=None, sw=1.2):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" ry="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')

def text(x, y, s, size=12, weight=400, fill="#111827", anchor="start"):
    add(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}">{esc(s)}</text>')

def box(x, y, w, h, title, subs=(), fill="#ffffff", stroke="#d1d5db", ts=14, ss=11.5, tw=600, tc="#111827", sc="#4b5563", dash=None, rx=8):
    rect(x, y, w, h, fill, stroke, rx=rx, dash=dash)
    gap = 5
    block = ts + len(subs) * (ss + gap)
    base = y + (h - block) / 2 + ts - 2
    cx = x + w / 2
    text(cx, round(base, 1), title, ts, tw, tc, "middle")
    for i, s in enumerate(subs):
        text(cx, round(base + (i + 1) * (ss + gap), 1), s, ss, 400, sc, "middle")
    for s in (title, *subs):
        need = text_width(s, ts if s == title else ss)
        if need > w - 12:
            print(f"WARN overflow {need:.0f}>{w-12}: {s}", file=sys.stderr)

def label(x, y, s, color, size=11.5):
    w = text_width(s, size) + 12
    add(f'<rect x="{x - w/2:.1f}" y="{y - size + 1:.1f}" width="{w:.1f}" height="{size + 7:.1f}" rx="4" fill="#ffffff" opacity="0.96"/>')
    text(x, y + 2, s, size, 500, color, "middle")

def path(d, color, width=1.6, dash=None, start=False, end=True, marker=None):
    m = marker or color_marker[color]
    dd = f' stroke-dasharray="{dash}"' if dash else ""
    ms = f' marker-start="url(#{m}-start)"' if start else ""
    me = f' marker-end="url(#{m})"' if end else ""
    add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}"{dd}{ms}{me} stroke-linejoin="round"/>')

BLUE, PURPLE, ORANGE, GREEN, GRAY = "#2563eb", "#7c3aed", "#ea580c", "#16a34a", "#64748b"
color_marker = {BLUE: "m-blue", PURPLE: "m-purple", ORANGE: "m-orange", GREEN: "m-green", GRAY: "m-gray"}

add(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">')
add(f'<style>text {{ font-family: {FONT}; }}</style>')
add('<defs>')
for color, mid in color_marker.items():
    add(f'<marker id="{mid}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="{color}"/></marker>')
    add(f'<marker id="{mid}-start" markerWidth="10" markerHeight="7" refX="1" refY="3.5" orient="auto"><polygon points="10 0, 0 3.5, 10 7" fill="{color}"/></marker>')
add('</defs>')
add(f'<rect width="{W}" height="{H}" fill="#ffffff"/>')

# ---------- 标题 ----------
text(40, 46, "Federation Studio · 平台整体架构", 24, 700)
text(40, 72, "统一 API：Web 控制台、CLI、MCP 与 SDK 共用一套接口 · 人与 Agent 走同一套权限与审计 · 原始数据始终留在参与方", 13.5, 400, "#4b5563")

# ---------- 分组容器（先画，位于底层） ----------
rect(40, 92, 1220, 106, "#f8fbff", "#bfdbfe", rx=12, dash="6,4")              # 接入层
rect(40, 314, 760, 248, "#f9fafb", "#d1d5db", rx=12, dash="6,4")              # 控制面
rect(820, 314, 440, 248, "#faf5ff", "#ddd6fe", rx=12, dash="6,4")             # Agent 层
rect(40, 598, 1220, 164, "#fffaf5", "#fed7aa", rx=12, dash="6,4")             # 执行面
rect(40, 798, 1220, 150, "#f6fdf8", "#bbf7d0", rx=12, dash="6,4")             # 参与方侧
rect(1290, 314, 270, 634, "#f8fafc", "#cbd5e1", rx=12, dash="6,4")            # 数据与基础设施

text(56, 112, "接入层", 13, 700, "#1d4ed8")
text(56, 334, "控制面", 13, 700, "#374151")
text(836, 334, "Agent 层 · 模型与框架解耦", 13, 700, "#6d28d9")
text(56, 618, "执行面 · 平台侧", 13, 700, "#c2410c")
text(56, 818, "参与方侧 · 各机构自有环境", 13, 700, "#15803d")
text(1306, 334, "数据与基础设施", 13, 700, "#334155")

# ---------- 连线（组件下方） ----------
# 接入层 → 网关
for cx in (201, 500, 799, 1098):
    path(f"M{cx},182 V226", BLUE, 1.8)
# 网关 → 控制面（配置引擎）
path("M419,282 V344", BLUE, 1.8)
# Agent 运行时 → 网关（Agent 与人走同一套 API）
path("M1040,344 V282", PURPLE, 1.8)
# 网关 → 数据与基础设施
path("M1180,254 H1425 V314", GRAY, 1.4, dash="5,4")
# 控制面行内
path("M286,380 H304", BLUE, 1.6)
path("M532,380 H550", BLUE, 1.6)
# 策略引擎 → 工作流编排（RunSpec）
path("M665,416 V442", ORANGE, 1.8)
# 工作流编排 → 执行面
path("M665,516 V582", ORANGE, 1.8, end=False)
path("M665,582 H250 V630", ORANGE, 1.8)
path("M665,582 V624", ORANGE, 1.8)
path("M665,582 H1130 V630", ORANGE, 1.8)
# Runner ↔ 参与方节点
path("M420,750 V784 H250 V826", GREEN, 1.8, start=True)
path("M650,750 V826", GREEN, 1.8, start=True)
path("M900,750 V784 H1050 V826", GREEN, 1.8, start=True)
# 控制面 / 执行面 → 基础设施
path("M1260,468 H1288", GRAY, 1.4, dash="5,4")
path("M1260,690 H1288", GRAY, 1.4, dash="5,4")

# ---------- 接入层 ----------
box(64, 118, 275, 64, "Web 控制台", ["机构用户 · 工作台 / 新建项目 / 项目详情"], "#eff6ff", "#bfdbfe")
box(363, 118, 275, 64, "CLI · fedctl", ["plan · apply -f · status --json"], "#eff6ff", "#bfdbfe")
box(662, 118, 275, 64, "MCP Server", ["外部 AI Agent 直接调用平台工具"], "#eff6ff", "#bfdbfe")
box(961, 118, 275, 64, "SDK · Python / TypeScript", ["由 OpenAPI 自动生成"], "#eff6ff", "#bfdbfe")

# ---------- 网关 ----------
box(120, 226, 1060, 56, "统一 API 网关（OpenAPI）", ["认证：OIDC / 机构令牌 / Agent 短期令牌 · 限流 · 每个请求写入审计"], "#eef2ff", "#c7d2fe", ts=15)

# ---------- 控制面 ----------
box(60, 344, 226, 72, "项目与组队", ["项目 · 成员 · 邀请", "授权与方案确认"])
box(306, 344, 226, 72, "配置引擎", ["7 个维度 · 推荐值 · 兼容规则", "plan：资源与耗时预估"])
box(552, 344, 226, 72, "策略引擎", ["OPA 硬规则 · 准入判定", "高风险操作审批闸门"])
box(60, 444, 226, 72, "身份与权限", ["OIDC / SSO · 机构与项目 RBAC", "Agent 短期令牌与权限分级"])
box(306, 444, 226, 72, "节点注册中心", ["节点证书 · 资源上报", "健康、版本与升级"])
box(552, 444, 226, 72, "工作流编排", ["Temporal 持久工作流", "准入 → 执行 → 交付 · 可重试"], "#fff7ed", "#fdba74")
text(56, 546, "配置由发起方决定 · 各方确认后生成不可变的 RunSpec · 硬规则先于 Agent，Agent 不能覆盖拒绝", 12, 400, "#6b7280")

# ---------- Agent 层 ----------
box(840, 344, 400, 52, "平台 Agent 层（自研）+ Pydantic AI", ["工具 = 平台 MCP / CLI · 权限与审批 · 在隔离工作沙箱中执行 · 审计"], "#f3e8ff", "#c4b5fd", ts=14)
agents = [
    (840, 408, "配置助手", "需求描述 → 配置草案"),
    (1046, 408, "准入解释", "规则结果 → 修复建议"),
    (840, 458, "运维 Agent", "沙箱与运行时维护 · 故障诊断"),
    (1046, 458, "评测报告", "指标 → 评测报告"),
    (840, 508, "记忆合并 Agent", "冲突仲裁（记忆联邦）"),
]
for x, y, t, s in agents:
    box(x, y, 194, 42, t, [s], "#ffffff", "#c4b5fd", ts=13, ss=11)
box(1046, 508, 194, 42, "自有大模型 API", ["OpenAI 兼容 · 经模型网关"], "#faf5ff", "#c4b5fd", ts=13, ss=11, dash="4,3")

# ---------- 执行面 ----------
box(60, 630, 240, 116, "沙箱调度（K8s Agent Sandbox）", ["默认 microVM：Kata + Firecracker", "gVisor：GPU 评测 · 无 KVM 兜底", "签名镜像 · 默认拒绝网络 · 用完即毁"], "#ffffff", "#fdba74", ts=13)
rect(320, 624, 680, 126, "#ffffff", "#fdba74", rx=10, dash="5,4")
text(334, 642, "Runner 适配器", 12.5, 700, "#c2410c")
runners = [
    (334, "Flower", ["SuperLink + ServerApp", "聚合 · SecAgg+ · DP"]),
    (500, "隐语 SecretFlow", ["Kuscia 调度", "SGB · SS-LR · PSI"]),
    (666, "统计服务", ["上传汇总表 → 隔离区检查", "重算 · 小分组抑制"]),
    (832, "记忆合并服务", ["上传记忆 → 脱敏 · 去重", "冲突仲裁 · 回放验证"]),
]
for x, t, s in runners:
    box(x, 652, 154, 88, t, s, "#fff7ed", "#fed7aa", ts=13, ss=11)
box(1020, 630, 220, 116, "独立评测环境", ["基线对比 · 交付闸门", "评测报告 → 产物登记"], "#ffffff", "#fdba74")

# ---------- 参与方侧 ----------
groups = [
    (60, "机构 A · 私有机房 · GPU 24 GB", False),
    (460, "机构 B · 阿里云 · GPU 24 GB", False),
    (860, "更多机构 / 本机构其他节点", True),
]
for gx, gt, dashed in groups:
    rect(gx, 826, 380, 108, "#ffffff", "#86efac", rx=10, dash="5,4" if dashed else None)
    text(gx + 14, 848, gt, 12.5, 700, "#166534")
    minis = [
        ("fs-node", ["节点程序 · mTLS", "资源探测 · 升级"]),
        ("联邦运行时", ["SuperNode / 隐语", "本地训练 · 加密"]),
        ("本地数据", ["只读挂载", "原始数据不出域"]),
    ]
    for i, (t, s) in enumerate(minis):
        box(gx + 12 + i * 122, 860, 112, 64, t, s, "#f0fdf4", "#bbf7d0", ts=12.5, ss=11, rx=6)

# ---------- 数据与基础设施 ----------
infra = [
    ("PostgreSQL", "项目 · 配置版本 · Run"),
    ("对象存储 MinIO / S3", "上传文件 · 报告 · 交付物"),
    ("产物与模型登记", "Adapter · 模型 · 谱系 · 签名"),
    ("审计日志", "只追加 · 人与 Agent 每次操作"),
    ("可观测性", "OpenTelemetry · Prometheus · Loki"),
    ("证书与密钥", "step-ca 节点证书 · Vault"),
    ("事件总线", "NATS · Webhook 通知"),
]
for i, (t, s) in enumerate(infra):
    box(1306, 346 + i * 84, 238, 70, t, [s], "#ffffff", "#cbd5e1", ts=13.5, ss=11.5)

# ---------- 连线标签（组件上方） ----------
label(1040, 298, "经 MCP / CLI 调用", PURPLE)
label(710, 431, "RunSpec", ORANGE)
label(905, 582, "编排：创建环境 → 执行 → 评测", ORANGE)
label(650, 784, "模型更新 / 加密中间结果 · 节点主动出站 mTLS", GREEN)
label(1302, 254, "状态 · 审计", GRAY, 11)

# ---------- 图例与权限说明 ----------
ly = 986
items = [
    (BLUE, None, "请求 / API 调用"),
    (PURPLE, None, "Agent 调用（受权限分级约束）"),
    (ORANGE, None, "编排控制"),
    (GREEN, None, "联邦数据交换（不含原始数据）"),
    (GRAY, "5,4", "状态 / 日志 / 审计"),
]
x = 40
for color, dash, name in items:
    path(f"M{x},{ly} H{x + 30}", color, 1.8, dash=dash)
    text(x + 38, ly + 4, name, 12, 400, "#4b5563")
    x += 38 + text_width(name, 12) + 28
rect(40, 1010, 1520, 36, "#faf5ff", "#ddd6fe", rx=8)
text(56, 1033, "Agent 权限分级：只读查询自动执行 · 可逆操作自动执行并审计 · 启动运行 / 交付 / 邀请外部机构 / 升级节点需人工审批 · Agent 只看描述信息、指标和脱敏日志，不接触原始数据", 12.5, 500, "#5b21b6")
print("legend end x", x, file=sys.stderr)

add('</svg>')
out = sys.argv[1]
with open(out, "w") as f:
    f.write("\n".join(L))
print("SVG written", out)
