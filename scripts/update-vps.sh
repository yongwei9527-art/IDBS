#!/usr/bin/env bash
set -euo pipefail
umask 077

SERVICE_NAME="${SERVICE_NAME:-laboratory-management-system}"
LEGACY_SERVICE_NAME="${LEGACY_SERVICE_NAME:-laboratory_management_system}"
APP_USER="${APP_USER:-laboratory_management_system}"
APP_GROUP="${APP_GROUP:-$APP_USER}"
APP_BASE="${APP_BASE:-/var/www/laboratory-management-system}"
SRC_DIR="${SRC_DIR:-/var/www/laboratory-management-system-src}"
REPO_URL="${REPO_URL:-https://github.com/yongwei9527-art/IDBS.git}"
RELEASE_REF="${RELEASE_REF:-main}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../deploy/vps-common.sh"
ENV_FILE="$APP_BASE/shared/.env"
BACKUP_DIR="$APP_BASE/backups"
LOCK_FILE="$APP_BASE/shared/update.lock"
VERIFIED_PRE_MIGRATION_BACKUP_DIR=''

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

acquire_update_lock() {
  mkdir -p "$(dirname "$LOCK_FILE")"
  exec 9>"$LOCK_FILE"
  flock -n 9 || { echo "已有升级任务正在运行，请稍后重试。" >&2; exit 1; }
}

backup_before_update() {
  local upload_dir="$1" export_dir="$2" timestamp database_backup_dir retention uploads_target exports_target
  timestamp="$(date +%Y%m%d-%H%M%S)"
  retention="$(read_env_value BACKUP_RETENTION_DAYS || true)"
  retention="${retention:-14}"
  [[ "$retention" =~ ^[0-9]+$ ]] && [ "$retention" -ge 1 ] && [ "$retention" -le 3650 ] \
    || die 'BACKUP_RETENTION_DAYS must be a whole number from 1 to 3650.'
  mkdir -p -- "$BACKUP_DIR"

  log "Creating pre-update PostgreSQL backup"
  database_backup_dir="$BACKUP_DIR/pre-update-db"
  ENV_FILE="$ENV_FILE" BACKUP_DIR="$database_backup_dir" \
    node "$SCRIPT_DIR/backup-database.js" --dir "$database_backup_dir" --keep-days "$retention"
  ENV_FILE="$ENV_FILE" BACKUP_DIR="$database_backup_dir" \
    node "$SCRIPT_DIR/backup-database.js" --verify-latest --dir "$database_backup_dir"
  VERIFIED_PRE_MIGRATION_BACKUP_DIR="$database_backup_dir"

  if [ -d "$upload_dir" ]; then
    log "Creating pre-update upload backup"
    uploads_target="$BACKUP_DIR/pre-update-uploads-${timestamp}.tar.gz"
    tar -czf "$uploads_target.tmp" -C "$(dirname "$upload_dir")" -- "$(basename "$upload_dir")"
    gzip -t "$uploads_target.tmp"
    mv -- "$uploads_target.tmp" "$uploads_target"
  fi
  if [ -d "$export_dir" ]; then
    log "Creating pre-update export backup"
    exports_target="$BACKUP_DIR/pre-update-exports-${timestamp}.tar.gz"
    tar -czf "$exports_target.tmp" -C "$(dirname "$export_dir")" -- "$(basename "$export_dir")"
    gzip -t "$exports_target.tmp"
    mv -- "$exports_target.tmp" "$exports_target"
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
    if git_src show-ref --verify --quiet "refs/heads/$RELEASE_REF"; then
      git_src checkout "$RELEASE_REF"
    else
      git_src checkout -b "$RELEASE_REF" "origin/$RELEASE_REF"
    fi
    git_src merge --ff-only "origin/$RELEASE_REF"
    [ "$(git_src rev-parse HEAD)" = "$(git_src rev-parse "origin/$RELEASE_REF")" ] \
      || die "Local source branch contains unpublished commits: $SRC_DIR ($RELEASE_REF)"
  elif git_src show-ref --verify --quiet "refs/tags/$RELEASE_REF"; then
    git_src checkout --detach "refs/tags/$RELEASE_REF"
  else
    die "Git branch or tag not found on origin: $RELEASE_REF"
  fi
}

refresh_managed_apk_download_url() {
  local apk_url managed_mode
  managed_mode="$(read_env_value APK_DOWNLOAD_URL_MANAGED || true)"
  [ "$managed_mode" = 'github_release' ] || return 0
  apk_url="$(github_release_apk_url "$SRC_DIR" || true)"
  [ -n "$apk_url" ] || {
    log 'Keeping the existing APK download URL because the current source version has no valid release asset name.'
    return 0
  }
  set_env_value APK_DOWNLOAD_URL "$apk_url"
}

detect_domain() {
  local nginx_file="/etc/nginx/sites-available/${SERVICE_NAME}.conf"
  if [ ! -f "$nginx_file" ]; then
    nginx_file="/etc/nginx/sites-available/${LEGACY_SERVICE_NAME}.conf"
  fi
  if [ -f "$nginx_file" ]; then
    awk '$1 == "server_name" { gsub(/;/, "", $2); print $2; exit }' "$nginx_file"
  else
    printf '_'
  fi
}

main() {
  require_root
  [ -f "$ENV_FILE" ] || { echo "未找到安装环境：$ENV_FILE" >&2; exit 1; }
  validate_systemd_unit_name "$SERVICE_NAME" 'Canonical service name'
  validate_systemd_unit_name "$LEGACY_SERVICE_NAME" 'Legacy service name'
  validate_managed_root "$APP_BASE" 'Application base directory'
  validate_managed_root "$SRC_DIR" 'Source directory'
  validate_disjoint_directories \
    'Application base directory' "$APP_BASE" \
    'Source directory' "$SRC_DIR"
  command -v git >/dev/null
  command -v node >/dev/null
  command -v gzip >/dev/null
  command -v tar >/dev/null
  command -v flock >/dev/null
  local domain port upload_dir export_dir backup_dir database_dir export_retention release_id
  upload_dir="$(read_env_value UPLOAD_DIR || true)"
  export_dir="$(read_env_value EXPORT_DIR || true)"
  backup_dir="$(read_env_value BACKUP_DIR || true)"
  database_dir="$(read_env_value DATABASE_DIR || true)"
  upload_dir="$(canonicalize_absolute_dir "${upload_dir:-$APP_BASE/uploads}" 'Upload directory')"
  export_dir="$(canonicalize_absolute_dir "${export_dir:-$APP_BASE/exports}" 'Export directory')"
  backup_dir="$(canonicalize_absolute_dir "${backup_dir:-$APP_BASE/backups}" 'Backup directory')"
  database_dir="$(canonicalize_absolute_dir "${database_dir:-$APP_BASE/database}" 'Database operations directory')"
  validate_absolute_dir "$upload_dir" 'Upload directory'
  validate_absolute_dir "$export_dir" 'Export directory'
  validate_absolute_dir "$backup_dir" 'Backup directory'
  validate_absolute_dir "$database_dir" 'Database operations directory'
  validate_disjoint_directories \
    'Upload directory' "$upload_dir" \
    'Export directory' "$export_dir" \
    'Backup directory' "$backup_dir" \
    'Database operations directory' "$database_dir"
  export_retention="$(read_env_value EXPORT_RETENTION_DAYS || true)"
  if [ -z "$export_retention" ]; then
    set_env_value EXPORT_RETENTION_DAYS 30
  elif ! [[ "$export_retention" =~ ^[0-9]+$ ]] \
    || [ "$export_retention" -lt 1 ] \
    || [ "$export_retention" -gt 3650 ]; then
    die 'EXPORT_RETENTION_DAYS must be a whole number from 1 to 3650.'
  fi
  BACKUP_DIR="$backup_dir"
  acquire_update_lock
  backup_before_update "$upload_dir" "$export_dir"
  update_source
  release_id="$(date -u +%Y%m%dT%H%M%SZ)-$(git_src rev-parse --short=12 HEAD)"
  refresh_managed_apk_download_url

  domain="$(detect_domain)"
  port="$(read_env_value PORT || true)"
  port="${port:-3000}"
  [[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ] \
    || die 'PORT must be a whole number from 1 to 65535.'
  log "Deploying $RELEASE_REF"
  APP_BASE="$APP_BASE" \
    SERVICE_NAME="$SERVICE_NAME" \
    LEGACY_SERVICE_NAME="$LEGACY_SERVICE_NAME" \
    APP_USER="$APP_USER" \
    APP_GROUP="$APP_GROUP" \
    HOST="127.0.0.1" \
    PORT="$port" \
    ENABLE_HTTPS=auto \
    DOMAIN_NAME="${domain:-_}" \
    UPLOAD_DIR="$upload_dir" \
    EXPORT_DIR="$export_dir" \
    BACKUP_DIR="$backup_dir" \
    DATABASE_DIR="$database_dir" \
    RELEASE_ID="$release_id" \
    PRE_MIGRATION_BACKUP_DIR="$VERIFIED_PRE_MIGRATION_BACKUP_DIR" \
    bash "$SRC_DIR/scripts/deploy-ubuntu.sh"

  curl -fsS "http://127.0.0.1:${port}/ready" >/dev/null
  log "Update complete: $(git_src rev-parse --short HEAD)"
  log "Backups: $BACKUP_DIR"
  log "Management panel: sudo db"
}

main "$@"
