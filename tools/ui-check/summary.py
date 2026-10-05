"""汇总 a11y.json / wrap.json：python3 summary.py [a11y.json] [wrap.json]
已核实的误报：手机卡片里的 table-link（::after 覆盖整张卡片）、row-button（整行可点）、1x1 的隐藏文件输入框（用可见的"选择文件"按钮代替）。"""
import json, sys
a11y_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fedagent-audit/a11y.json"
wrap_path = sys.argv[2] if len(sys.argv) > 2 else "/tmp/fedagent-audit/wrap.json"
KNOWN_SMALL = ("table-link", "row-button", "INPUT 1x1")
r = json.load(open(a11y_path))
bad = 0
for k, v in r.items():
    if not isinstance(v, dict):
        print("A11Y", k, "ERR", str(v)[:200]); bad += 1; continue
    issues = {x: v[x] for x in ["unnamed", "unlabeled", "dupIds", "tabindex", "tiny", "contrast", "offright"] if v.get(x)}
    small = [x for x in v.get("small", []) if not x.startswith(KNOWN_SMALL)]
    if small: issues["small"] = small
    if v.get("overflow"): issues["overflow"] = v["overflow"]
    hs = v["headings"]; levels = [int(h[1]) for h in hs]
    skips = [f"{hs[i-1]} -> {hs[i]}" for i in range(1, len(levels)) if levels[i] > levels[i-1] + 1]
    if skips: issues["skips"] = skips
    if not levels or levels[0] != 1: issues["first-heading"] = hs[:1]
    if issues:
        bad += 1; print("A11Y", k, json.dumps(issues, ensure_ascii=False)[:400])
print(f"a11y: {len(r)} combos, {bad} with new issues")
try:
    w = json.load(open(wrap_path))
except FileNotFoundError:
    print("wrap: not finished"); sys.exit(1)
lines = {}
for k, items in w.items():
    for item in items:
        # 上传提示在分号后断行正常；仅过滤已核实的这一条，不隐藏其他短文字问题。
        if item.replace('\u00a0', ' ') == 'SHORT SPAN | ；不超过 20 MB | 末行: 不超过 20 MB':
            continue
        lines.setdefault(item, []).append(k)
for item, where in sorted(lines.items(), key=lambda x: -len(x[1])):
    print("WRAP", item, "|", len(where), "处:", ", ".join(where[:4]) + (" …" if len(where) > 4 else ""))
print(f"wrap: {len(w)} page-width combos with findings, {len(lines)} distinct texts")
sys.exit(1 if bad or lines else 0)
