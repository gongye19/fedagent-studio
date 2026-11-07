#!/usr/bin/env bash
# 服务器端：从 GitHub 对象导出指定 main 提交，构建成功后才停止服务。
# 一次性配置见 docs/DEVELOPMENT.md；常规由本机 deploy.sh 调用。
set -euo pipefail
ROOT="${FEDAGENT_DEPLOY_ROOT:-$HOME/fedagent-studio}"
cd "$ROOT"
mkdir -p run builds
exec 9>run/deploy.lock
flock -n 9 || { echo '已有部署正在执行' >&2; exit 1; }
export GIT_SSH_COMMAND="ssh -F /dev/null -o Hostname=ssh.github.com -i $ROOT/access/github_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$ROOT/access/github_known_hosts -p 443"
git --git-dir=repository.git fetch origin refs/heads/main:refs/remotes/origin/main
latest=$(git --git-dir=repository.git rev-parse refs/remotes/origin/main)
revision=${1:-$latest}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] && [ "$revision" = "$latest" ] || { echo '只能部署 GitHub main 的当前完整提交号' >&2; exit 1; }
stage=$(mktemp -d "$ROOT/builds/$revision.XXXXXX")
git --git-dir=repository.git archive "$revision" | tar -x -C "$stage"
python3 "$stage/deploy/check_idle.py" "$ROOT"

export UV_CACHE_DIR="$ROOT/cache/uv"
export UV_PYTHON_INSTALL_DIR="$ROOT/python"
export UV_PYTHON_PREFERENCE=only-managed
export UV_NO_PROGRESS=1
uv="$ROOT/bin/uv"
[ -x "$uv" ] || { echo '缺少已有运行环境 bin/uv，请先初始化服务器' >&2; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(!((a===20&&b>=19)||(a===22&&b>=12)||a>22)) process.exit(1)' || { echo 'Node 版本不满足前端构建要求' >&2; exit 1; }
(cd "$stage/app" && npm ci --no-audit --no-fund && npm run build)
# 先下载并验证运行依赖，减少停机时间；不更改当前运行中的虚拟环境。
(cd "$stage/server" && "$uv" sync --frozen --no-dev --python 3.12)
mkdir -p "$stage/wheels"
for package in fedagent-sdk fedagent-client fedagent-fot fedagent-math-reasoning fedagent-evomedclaw fedagent-records; do
  (cd "$stage/server" && "$uv" build --package "$package" --wheel --out-dir "$stage/wheels" -q)
done
rm -f "$stage/wheels/.gitignore"

stopped=0
changed=0
backup_dir=
schema() {
  python3 - "$ROOT/data/fedagent.db" <<'PY'
import sqlite3, sys
from pathlib import Path
with sqlite3.connect(Path(sys.argv[1]).resolve().as_uri() + '?mode=ro', uri=True) as db:
    print(db.execute('select version_num from alembic_version').fetchone()[0])
PY
}
previous_schema=$(schema)
recover() {
  result=$?
  trap - EXIT
  if [ "$result" != 0 ] && [ "$stopped" = 1 ]; then
    if [ "$changed" = 1 ]; then
      bash "$ROOT/serve.sh" stop 9>&- || true
      rollback="$stage/rollback"
      mkdir -p "$rollback"
      tar -xzf "$backup_dir/runtime.tar.gz" -C "$rollback"
      for directory in server dist client; do
        rsync -a --delete --exclude .venv --exclude __pycache__ --exclude .data "$rollback/$directory/" "$ROOT/$directory/"
      done
      cp "$rollback/serve.sh" "$rollback/backup.py" "$rollback/medical-agents.sh" "$ROOT/"
    fi
    if [ "$(schema)" = "$previous_schema" ]; then
      echo '部署失败，恢复上一版程序并启动；原始数据未覆盖' >&2
      bash "$ROOT/serve.sh" 9>&- || true
    else
      echo "部署失败且数据库版本已变化，服务保持停止；请检查备份 $backup_dir" >&2
    fi
  fi
  exit "$result"
}
trap recover EXIT
# 构建期间可能有人启动任务，再检查一次；停止后再次检查以处理并发请求。
python3 "$stage/deploy/check_idle.py" "$ROOT"
stopped=1
bash "$ROOT/serve.sh" stop 9>&-
python3 "$stage/deploy/check_idle.py" "$ROOT"
backup_dir=$(python3 "$stage/deploy/backup.py" "$ROOT" | sed -n 's/^backup: //p')
[ -d "$backup_dir/data" ] || { echo '完整备份未成功，停止发布' >&2; exit 1; }
tar --exclude='server/.venv' --exclude='server/.data' --exclude='__pycache__' \
  -czf "$backup_dir/runtime.tar.gz" server dist client serve.sh backup.py medical-agents.sh
printf '%s\n' "$revision" > "$backup_dir/target-revision"
changed=1
rsync -a --delete --exclude .venv --exclude .data --exclude __pycache__ "$stage/server/" "$ROOT/server/"
rsync -a "$stage/app/dist/" "$ROOT/dist/"
rsync -a --delete "$stage/wheels/" "$ROOT/client/"
cp "$stage/deploy/serve.sh" "$stage/deploy/backup.py" "$stage/deploy/medical-agents.sh" "$ROOT/"
bash "$ROOT/serve.sh" 9>&-
printf '%s\n' "$revision" > run/deployed-revision.next
mv run/deployed-revision.next run/deployed-revision
trap - EXIT
# 保留导出的源码用于追溯，清掉可重新生成的构建依赖；不自动清理历史备份。
rm -rf "$stage/app/node_modules" "$stage/server/.venv"
echo "部署完成：$revision；完整备份：$backup_dir"
