"""代码结构审查：自有源码大小、Python 顶层依赖环和领域层越界。生成文件及固定上游源码单独维护。"""
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def inspect():
    files = [p for base in ("server/fedagent", "server/sdk", "server/client", "server/plugins", "app/src")
             for p in (ROOT / base).rglob("*") if p.suffix in (".py", ".ts", ".tsx", ".css")
             and "vendor" not in p.parts and "migrations" not in p.parts and p.name != "schema.d.ts" and ".test." not in p.name]
    sizes = sorted([(len(p.read_text().splitlines()), str(p.relative_to(ROOT))) for p in files], reverse=True)
    modules = {}
    for p in (ROOT / "server/fedagent").rglob("*.py"):
        if "migrations" in p.parts:
            continue
        parts = list(p.relative_to(ROOT / "server").with_suffix("").parts)
        if parts[-1] == "__init__":
            parts.pop()
        modules[".".join(parts)] = p
    graph = {}
    for name, p in modules.items():
        package = name.split(".") if p.name == "__init__.py" else name.split(".")[:-1]
        graph[name] = set()
        for node in ast.parse(p.read_text()).body:
            if not isinstance(node, ast.ImportFrom):
                continue
            base = package[:len(package) - node.level + 1] if node.level else []
            target = ".".join([*base, *((node.module or "").split(".") if node.module else [])])
            candidates = [target, *(target + "." + alias.name for alias in node.names)]
            graph[name].update(c for c in candidates if c in modules and c != name)
    active, done, cycles = [], set(), set()

    def visit(name):
        if name in active:
            cycle = active[active.index(name):]
            cycles.add(tuple(sorted(cycle)))
            return
        if name in done:
            return
        active.append(name)
        for child in sorted(graph[name]):
            visit(child)
        active.pop()
        done.add(name)

    for name in graph:
        visit(name)
    violations = []
    for folder in ("resource_services", "task_services", "checks"):
        for p in (ROOT / "server/fedagent" / folder).glob("*.py"):
            for node in ast.walk(ast.parse(p.read_text())):
                if isinstance(node, ast.ImportFrom) and (node.module or "").startswith(("fastapi", "starlette")):
                    violations.append(str(p.relative_to(ROOT)))
    return {"files": len(sizes), "largest": sizes[:15], "over400": [r for r in sizes if r[0] > 400],
            "pythonRuntimeCycles": sorted(cycles), "businessHttpImports": sorted(set(violations))}


if __name__ == "__main__":
    result = inspect()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(bool(result["over400"] or result["pythonRuntimeCycles"] or result["businessHttpImports"]))
