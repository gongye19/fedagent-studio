#!/usr/bin/env bash
# 同机运行两个接入方医疗系统；独立 HTTP 端口、运行记录与经验库，复用已保存模型但不复制密钥。
# 仅 data/medical-model.ref 存在时启用。独立部署可改用 medical-serve 的环境变量模式。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
FEDAGENT="$ROOT/server/.venv/bin/fedagent"
export FEDAGENT_DATA_DIR="$ROOT/data"
MODEL_FILE="$ROOT/data/medical-model.ref"
mkdir -p "$ROOT/run" "$ROOT/logs"

alive() {
  local name=$1 pid line
  [ -f "$ROOT/run/$name.pid" ] || return 1
  pid=$(cat "$ROOT/run/$name.pid")
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  [ -r "/proc/$pid/cmdline" ] || return 1
  line=$(tr '\0' ' ' < "/proc/$pid/cmdline")
  [[ "$line" == *"$FEDAGENT medical-serve "* && "$line" == *"$ROOT/data/medical-agents/$name"* ]]
}

stop_one() {
  local name=$1 pid
  if alive "$name"; then
    pid=$(cat "$ROOT/run/$name.pid")
    kill -TERM "$pid"
    for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid"; fi
  fi
  rm -f "$ROOT/run/$name.pid"
}

start_one() {
  local name=$1 port=$2 label=$3 model
  alive "$name" && return 0
  model=$(cat "$MODEL_FILE")
  [ -n "$model" ] || { echo "missing medical model reference" >&2; return 1; }
  setsid nohup "$FEDAGENT" medical-serve --port "$port" --name "$label" \
    --store "$ROOT/data/medical-agents/$name" --platform-model "$model" >> "$ROOT/logs/$name.log" 2>&1 < /dev/null &
  echo $! > "$ROOT/run/$name.pid"
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$port/healthz" > /dev/null 2>&1 && alive "$name"; then return 0; fi
    alive "$name" || break
    sleep 1
  done
  echo "$label failed to start; see logs/$name.log" >&2
  return 1
}

case "${1:-start}" in
  start)
    [ -f "$MODEL_FILE" ] || exit 0
    if ! start_one medical-a 9031 "医疗 Agent A" || ! start_one medical-b 9032 "医疗 Agent B"; then
      stop_one medical-a
      stop_one medical-b
      exit 1
    fi
    ;;
  stop) stop_one medical-a; stop_one medical-b ;;
  status)
    for name in medical-a medical-b; do
      if alive "$name"; then echo "$name: running"; else echo "$name: stopped"; fi
    done
    ;;
  *) echo "usage: $0 [start|stop|status]" >&2; exit 2 ;;
esac
