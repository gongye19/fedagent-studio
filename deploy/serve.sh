#!/usr/bin/env bash
# FedAgent Studio 在实验室服务器上运行：API（同时提供前端页面）和 runner 两个用户进程，
# 只监听本机的 Tailscale 地址，不对校园网和公网开放。没有 Docker 和 sudo，也不往系统里装东西。
#
#   启动或重启：bash ~/fedagent-studio/serve.sh
#   停止：      bash ~/fedagent-studio/serve.sh stop
#   状态：      bash ~/fedagent-studio/serve.sh status
#   备份：      bash ~/fedagent-studio/serve.sh stop && bash ~/fedagent-studio/serve.sh backup
#   访问令牌：  bash ~/fedagent-studio/serve.sh token on | off（改完自动重启）
#
# 访问令牌是可选的：data/admin-token 存在时，界面和 API 都要带这个令牌；不存在时不需要令牌，
# Tailscale 内网里能访问这个地址的人都能使用全部功能。部署不会自动生成令牌。
#
# 所有文件都在这个目录里，删掉目录就干净了：
#   bin/uv          uv（从 GitHub 发布页下载，核对 sha256）
#   python/         uv 下载的 Python 3.12
#   cache/          uv 的下载缓存
#   dist/           前端构建产物
#   client/         参与方客户端、SDK 和插件的安装包（*.whl），在 /client/ 下提供
#   server/         后端代码，虚拟环境在 server/.venv
#   data/           数据库、数据集、运行目录、模型密钥的加密密钥、访问令牌（开启时才有；部署不覆盖）
#   logs/  run/     日志和进程号
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
HOST=100.111.198.54
PORT=8880
UV_VERSION=0.11.1
UV_TARGET=uv-x86_64-unknown-linux-gnu

export UV_CACHE_DIR="$ROOT/cache/uv"
export UV_PYTHON_INSTALL_DIR="$ROOT/python"
export UV_PYTHON_PREFERENCE=only-managed
export UV_NO_PROGRESS=1
export FEDAGENT_DATA_DIR="$ROOT/data"
export FEDAGENT_FRONTEND_DIST="$ROOT/dist"
export FEDAGENT_CLIENT_DIST="$ROOT/client"
export FEDAGENT_FAKE_ENDPOINT=0
FEDAGENT="$ROOT/server/.venv/bin/fedagent"

alive() {
  local pid command=$1 line
  [ -f "run/$1.pid" ] || return 1
  pid=$(cat "run/$1.pid")
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  [ -r "/proc/$pid/cmdline" ] || return 1
  [ "$command" = api ] && command=serve
  line=$(tr '\0' ' ' < "/proc/$pid/cmdline")
  [[ "$line" == *"$FEDAGENT $command "* ]]
}

# 结束一个进程并等它退出。runner 收到 SIGTERM 后先结束它起的任务进程（最多 10 秒），
# 任务保持"运行中"，下次启动后从检查点继续。
stop_one() {
  local name=$1
  if alive "$name"; then
    local pid
    pid=$(cat "run/$name.pid")
    kill -TERM "$pid"
    for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid"; fi
    echo "stopped $name (pid $pid)"
  fi
  rm -f "run/$name.pid"
}

stop_all() {
  stop_one runner
  [ ! -f "$ROOT/medical-agents.sh" ] || bash "$ROOT/medical-agents.sh" stop
  stop_one api
}

ensure_uv() {
  if [ -x bin/uv ] && [ "$(bin/uv --version | awk '{print $2}')" = "$UV_VERSION" ]; then return; fi
  local tmp url
  tmp=$(mktemp -d)
  url="https://github.com/astral-sh/uv/releases/download/$UV_VERSION/$UV_TARGET.tar.gz"
  curl -fsSL --retry 3 -o "$tmp/$UV_TARGET.tar.gz" "$url"
  curl -fsSL --retry 3 -o "$tmp/$UV_TARGET.tar.gz.sha256" "$url.sha256"
  (cd "$tmp" && sha256sum --check --quiet "$UV_TARGET.tar.gz.sha256")
  tar -xzf "$tmp/$UV_TARGET.tar.gz" -C "$tmp"
  install -m 755 "$tmp/$UV_TARGET/uv" "$tmp/$UV_TARGET/uvx" bin/
  rm -rf "$tmp"
  echo "installed $(bin/uv --version)"
}

token_state() { if [ -s data/admin-token ]; then echo on; else echo off; fi; }

# 开启：生成令牌，只保存在 data/admin-token（只有本用户能读），浏览器第一次打开时要填；关闭：删掉这个文件。
set_token() {
  mkdir -p data
  case "${1:-}" in
    on)
      if [ ! -s data/admin-token ]; then
        (umask 077 && python3 -c 'import secrets; print(secrets.token_urlsafe(32))' > data/admin-token)
      fi
      ;;
    off) rm -f data/admin-token ;;
    *) echo "usage: $0 token on|off" >&2; exit 2 ;;
  esac
  echo "access token: $(token_state)"
}

start_all() {
  mkdir -p bin data logs run
  stop_all
  ensure_uv
  # 按 uv.lock 装依赖（不装开发依赖）；需要时先下载 Python 3.12 到 python/
  (cd server && ../bin/uv sync --frozen --no-dev --python 3.12)
  "$FEDAGENT" db upgrade
  [ ! -f "$ROOT/medical-agents.sh" ] || bash "$ROOT/medical-agents.sh" start
  # 令牌只交给 api 进程
  (
    unset FEDAGENT_ADMIN_TOKEN
    if [ -s data/admin-token ]; then export FEDAGENT_ADMIN_TOKEN; FEDAGENT_ADMIN_TOKEN=$(cat data/admin-token); fi
    exec setsid nohup "$FEDAGENT" serve --host "$HOST" --port "$PORT" >> logs/api.log 2>&1 < /dev/null
  ) &
  echo $! > run/api.pid
  setsid nohup "$FEDAGENT" runner >> logs/runner.log 2>&1 < /dev/null &
  echo $! > run/runner.pid
  for _ in $(seq 1 60); do
    if curl -fsS "http://$HOST:$PORT/healthz" > /dev/null 2>&1 && alive runner; then
      echo "serving on http://$HOST:$PORT/ (api pid $(cat run/api.pid), runner pid $(cat run/runner.pid), access token $(token_state))"
      return 0
    fi
    alive api || break
    sleep 1
  done
  echo "health check failed; last lines of logs/api.log:" >&2
  tail -n 30 logs/api.log >&2
  return 1
}

status() {
  [ ! -f "$ROOT/medical-agents.sh" ] || bash "$ROOT/medical-agents.sh" status
  for name in api runner; do
    if alive "$name"; then echo "$name: running (pid $(cat "run/$name.pid"))"; else echo "$name: stopped"; fi
  done
  if curl -fsS "http://$HOST:$PORT/healthz" > /dev/null 2>&1; then echo "health: ok"; else echo "health: unreachable"; fi
  echo "access token: $(token_state)"
}

case "${1:-start}" in
  start | restart) start_all ;;
  stop) mkdir -p run && stop_all ;;
  status) status ;;
  backup) python3 "$ROOT/backup.py" "$ROOT" ;;
  token) set_token "${2:-}" && start_all ;;
  *) echo "usage: $0 [start|stop|status|backup|token on|off]" >&2; exit 2 ;;
esac
