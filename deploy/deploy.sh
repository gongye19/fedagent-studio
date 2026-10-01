#!/usr/bin/env bash
# 构建前端并部署到实验室服务器，只在 Tailscale 内网访问：http://100.111.198.54:8880/
# 用法（在仓库根目录）：bash deploy/deploy.sh
# 需要本机已加入 Tailscale，并且能用密钥登录服务器（不用密码）。
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=poly-zhu@100.111.198.54
SSH=(ssh -p 10022 -o BatchMode=yes -o ConnectTimeout=12)

(cd app && npm run build)
"${SSH[@]}" "$HOST" 'mkdir -p ~/fedagent-studio'
rsync -az --delete -e "${SSH[*]}" app/dist/ "$HOST":~/fedagent-studio/dist/
scp -q -P 10022 -o BatchMode=yes deploy/serve.sh "$HOST":~/fedagent-studio/serve.sh
"${SSH[@]}" "$HOST" 'bash ~/fedagent-studio/serve.sh'
