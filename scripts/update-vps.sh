#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-laboratory_management_system}"
APP_BASE="${APP_BASE:-/var/www/laboratory-management-system}"
SRC_DIR="${SRC_DIR:-/var/www/laboratory-management-system-src}"
REPO_URL="${REPO_URL:-https://github.com/yongwei9527-art/IDBS.git}"
RELEASE_REF="${RELEASE_REF:-main}"
ENV_FILE="$APP_BASE/shared/.env"
BACKUP_DIR="$APP_BASE/backups"
LOCK_FILE="$APP_BASE/shared/update.lock"

log() { printf '\n[update] %s\n' "$*"; }

git_src() {
  git -c safe.directory="$SRC_DIR" -c core.fileMode=false -C "$SRC_DIR" "$@"
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "请使用 sudo laboratory-management-system-update 运行升级。" >&2
    exit 1
  fi
}

read_env_value() {
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d '=' -f 2-
}

acquire_update_lock() {
  mkdir -p "$(dirname "$LOCK_FILE")"
  exec 9>"$LOCK_FILE"
  flock -n 9 || { echo "已有升级任务正在运行，请稍后重试。" >&2; exit 1; }
}

backup_before_update() {
  local timestamp database_url
  timestamp="$(date +%Y%m%d-%H%M%S)"
  database_url="$(read_env_value DATABASE_URL)"
  [ -n "$database_url" ] || { echo "DATABASE_URL 未配置，无法在升级前备份。" >&2; exit 1; }
  mkdir -p "$BACKUP_DIR"

  log "Creating pre-update PostgreSQL backup"
  pg_dump "$database_url" | gzip > "$BACKUP_DIR/pre-update-${timestamp}.sql.gz"
  gzip -t "$BACKUP_DIR/pre-update-${timestamp}.sql.gz"

  if [ -d "$APP_BASE/uploads" ]; then
    log "Creating pre-update uploads backup (generated export files are excluded)"
    tar --exclude='uploads/exports' -czf "$BACKUP_DIR/pre-update-uploads-${timestamp}.tar.gz" -C "$APP_BASE" uploads
  fi
}

update_source() {
  if [ ! -d "$SRC_DIR/.git" ]; then
    git clone "$REPO_URL" "$SRC_DIR"
    git -C "$SRC_DIR" config core.fileMode false
  fi
  if [ -n "$(git_src status --porcelain)" ]; then
    echo "源码目录存在本地修改，升级已中止：$SRC_DIR" >&2
    exit 1
  fi

  git_src fetch origin --tags --prune
  if git_src show-ref --verify --quiet "refs/remotes/origin/$RELEASE_REF"; then
    git_src checkout "$RELEASE_REF"
    git_src pull --ff-only origin "$RELEASE_REF"
  else
    git_src checkout --detach "$RELEASE_REF"
  fi
}

detect_domain() {
  local nginx_file="/etc/nginx/sites-available/${APP_NAME}.conf"
  if [ -f "$nginx_file" ]; then
    awk '$1 == "server_name" { gsub(/;/, "", $2); print $2; exit }' "$nginx_file"
  else
    printf '_'
  fi
}

main() {
  require_root
  [ -f "$ENV_FILE" ] || { echo "未找到安装环境：$ENV_FILE" >&2; exit 1; }
  command -v git >/dev/null
  command -v pg_dump >/dev/null
  command -v gzip >/dev/null
  command -v tar >/dev/null
  command -v flock >/dev/null
  acquire_update_lock

  backup_before_update
  update_source

  local domain port
  domain="$(detect_domain)"
  port="$(read_env_value PORT || true)"
  port="${port:-3000}"
  log "Deploying $RELEASE_REF"
  APP_BASE="$APP_BASE" DOMAIN_NAME="${domain:-_}" bash "$SRC_DIR/scripts/deploy-ubuntu.sh"

  curl -fsS "http://127.0.0.1:${port}/ready" >/dev/null
  log "Update complete: $(git_src rev-parse --short HEAD)"
  log "Backups: $BACKUP_DIR"
  log "Management panel: sudo db"
}

main "$@"