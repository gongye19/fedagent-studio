#!/usr/bin/env bash
# 在 main 上检查、推送 GitHub，再让服务器从同一提交构建和部署。
set -euo pipefail
cd "$(dirname "$0")/.."
REPOSITORY=git@github.com:gongye19/fedagent-studio.git
HOST=poly-zhu@100.111.198.54
SSH=(ssh -T -p 10022 -o IPQoS=cs0 -o BatchMode=yes -o ConnectTimeout=12
  -o ServerAliveInterval=10 -o ServerAliveCountMax=3)

[ "$(git branch --show-current)" = main ] || { echo '请先将改动合并到 main 再部署' >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo '请先提交改动；部署不上传工作区文件' >&2; exit 1; }
[ "$(git remote get-url origin)" = "$REPOSITORY" ] || { echo 'origin 与部署仓库不一致' >&2; exit 1; }
if [ "${SKIP_CHECKS:-0}" != 1 ]; then
  (cd app && npm run check)
  (cd server && uv run --frozen python ../tools/check_structure.py && uv run --frozen ruff check . && uv run --frozen pyright && uv run --frozen pytest -q)
fi
revision=$(git rev-parse HEAD)
git push -u origin main
[ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$revision" ] || { echo 'GitHub main 已变化，请重新同步' >&2; exit 1; }

control=$(mktemp -d)
SSH+=(-o ControlMaster=auto -o ControlPersist=60 -o "ControlPath=$control/socket")
trap '"${SSH[@]}" -O exit "$HOST" >/dev/null 2>&1 || true; rm -rf "$control"' EXIT
# 脚本和源码都从 GitHub 获取；SSH 只传递已推送的提交号。
"${SSH[@]}" "$HOST" "set -euo pipefail; cd ~/fedagent-studio; export GIT_SSH_COMMAND='ssh -F /dev/null -o Hostname=ssh.github.com -i ~/fedagent-studio/access/github_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=~/fedagent-studio/access/github_known_hosts -p 443'; git --git-dir=repository.git fetch origin refs/heads/main:refs/remotes/origin/main; git --git-dir=repository.git show '$revision:deploy/update.sh' | bash -s -- '$revision'"

# 数据始终留在运行目录；完整备份另存到本机，不进入 GitHub。
mkdir -p .backups
chmod 700 .backups
rsync -az -e "${SSH[*]}" "$HOST":fedagent-studio/backups/ .backups/
echo "已部署 GitHub 提交 $revision"
