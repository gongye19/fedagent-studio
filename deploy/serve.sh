#!/usr/bin/env bash
# FedAgent Studio 前端（构建好的静态文件）：只在本机的 Tailscale 地址上监听，不对校园网和公网开放。
# 重启：bash ~/fedagent-studio/serve.sh    停止：kill "$(cat ~/fedagent-studio/serve.pid)"
set -euo pipefail
cd "$(dirname "$0")"
PORT=8880
HOST=100.111.198.54
if [ -f serve.pid ] && kill -0 "$(cat serve.pid)" 2>/dev/null; then
  kill "$(cat serve.pid)"
  sleep 1
fi
setsid nohup python3 -m http.server "$PORT" --bind "$HOST" --directory dist > serve.log 2>&1 < /dev/null &
echo $! > serve.pid
echo "serving on http://$HOST:$PORT/ (pid $(cat serve.pid))"
