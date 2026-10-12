#!/usr/bin/env bash
# 部署到实验室服务器，只在 Tailscale 内网访问：http://100.111.198.54:8880/
# 用法（在仓库根目录）：bash deploy/deploy.sh
#   SKIP_CHECKS=1 bash deploy/deploy.sh   跳过本地检查，只构建前端
# 需要本机已加入 Tailscale，并且能用密钥登录服务器（不用密码）。
# 服务器上的文件都在 ~/fedagent-studio 里，启动、停止和目录布局见 deploy/serve.sh。
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=poly-zhu@100.111.198.54
SSH=(ssh -p 10022 -o IPQoS=none -o BatchMode=yes -o ConnectTimeout=12 -o ServerAliveInterval=15 -o ServerAliveCountMax=2)

# 1. 本地检查：前端 lint、类型、测试、构建；后端 lint、类型、测试
if [ "${SKIP_CHECKS:-}" = 1 ]; then
  (cd app && npm run build)
else
  (cd app && npm run check)
  (cd server && uv run --frozen ruff check . && uv run --frozen pyright && uv run --frozen pytest -q)
fi

# 参与方客户端的安装包（客户端、SDK、插件），平台在 /client/ 下提供，界面上的连接命令从这里安装
PACKAGES=$(mktemp -d)
# 同一次部署复用已认证连接，减少 Tailscale 中继下的重复握手。
SSH+=(-o ControlMaster=auto -o ControlPersist=60 -o "ControlPath=${SSH_CONTROL_PATH:-$PACKAGES/ssh.sock}")
trap '"${SSH[@]}" -O exit "$HOST" >/dev/null 2>&1 || true; rm -rf "$PACKAGES"' EXIT
for package in fedagent-sdk fedagent-client fedagent-fot fedagent-math-reasoning; do
  (cd server && uv build --package "$package" --wheel --out-dir "$PACKAGES" -q)
done
rm -f "$PACKAGES/.gitignore"

# 2. 先停下旧进程，再同步代码，免得旧进程读到一半新代码
"${SSH[@]}" "$HOST" true
"${SSH[@]}" "$HOST" 'mkdir -p ~/fedagent-studio/backups && chmod 700 ~/fedagent-studio/backups'
rsync -az -e "${SSH[*]}" deploy/serve.sh deploy/backup.py "$HOST":fedagent-studio/
"${SSH[@]}" "$HOST" 'bash ~/fedagent-studio/serve.sh stop'
# 数据和解密密钥必须一起备份；备份失败时不覆盖服务器代码。
if ! "${SSH[@]}" "$HOST" 'bash ~/fedagent-studio/serve.sh backup'; then
  "${SSH[@]}" "$HOST" 'bash ~/fedagent-studio/serve.sh'
  echo 'backup failed; existing service restarted, deployment aborted' >&2
  exit 1
fi
# 保留一份在这台 Mac，避免服务器磁盘故障时所有副本一起丢失。
mkdir -p .backups
chmod 700 .backups
if ! rsync -az -e "${SSH[*]}" "$HOST":fedagent-studio/backups/ .backups/; then
  "${SSH[@]}" "$HOST" 'bash ~/fedagent-studio/serve.sh'
  echo 'backup download failed; existing service restarted, deployment aborted' >&2
  exit 1
fi
# 保留旧的带哈希资源：已经打开的页面稍后懒加载图表时仍需要旧文件。
rsync -az -e "${SSH[*]}" app/dist/ "$HOST":fedagent-studio/dist/
rsync -az --delete -e "${SSH[*]}" "$PACKAGES"/ "$HOST":fedagent-studio/client/
# 虚拟环境和数据不同步；--delete 不会删掉被排除的文件
rsync -az --delete -e "${SSH[*]}" \
  --exclude .venv --exclude .data --exclude __pycache__ --exclude .pytest_cache --exclude .ruff_cache --exclude .DS_Store \
  server/ "$HOST":fedagent-studio/server/

# 3. 安装依赖、迁移数据库、启动 API 和 runner、健康检查
"${SSH[@]}" "$HOST" 'bash ~/fedagent-studio/serve.sh'
