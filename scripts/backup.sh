#!/usr/bin/env bash
# Create a verified PostgreSQL backup plus upload/export archives on an installed VPS.
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../deploy/vps-common.sh"

usage() { echo "Usage: sudo $0 [--verify]"; }

archive_directory() {
  local source_dir="$1" label="$2" timestamp="$3" target
  [ -d "$source_dir" ] || return 0
  target="$BACKUP_DIR/${label}-${timestamp}.tar.gz"
  tar -C "$(dirname "$source_dir")" -czf "$target.tmp" "$(basename "$source_dir")"
  gzip -t "$target.tmp"
  mv "$target.tmp" "$target"
  printf '[backup] archive=%s\n' "$target"
}

main() {
  require_root
  [ -f "$ENV_FILE" ] || die "No installed environment found at $ENV_FILE."
  [ -d "$APP_CURRENT" ] || die "Application release missing: $APP_CURRENT"
  local verify=0
  case "${1:-}" in '') ;; --verify) verify=1 ;; -h|--help) usage; exit 0 ;; *) usage >&2; exit 2 ;; esac

  BACKUP_DIR="$(read_env_value BACKUP_DIR)"
  BACKUP_DIR="${BACKUP_DIR:-$APP_BASE/backups}"
  local upload_dir export_dir database_dir retention timestamp lock_file
  upload_dir="$(read_env_value UPLOAD_DIR)"
  export_dir="$(read_env_value EXPORT_DIR)"
  database_dir="$(read_env_value DATABASE_DIR)"
  BACKUP_DIR="$(canonicalize_absolute_dir "$BACKUP_DIR" 'Backup directory')"
  upload_dir="$(canonicalize_absolute_dir "${upload_dir:-$APP_BASE/uploads}" 'Upload directory')"
  export_dir="$(canonicalize_absolute_dir "${export_dir:-$APP_BASE/exports}" 'Export directory')"
  database_dir="$(canonicalize_absolute_dir "${database_dir:-$APP_BASE/database}" 'Database operations directory')"
  validate_managed_root "$APP_BASE" 'Application base directory'
  validate_absolute_dir "$BACKUP_DIR" 'Backup directory'
  validate_absolute_dir "$upload_dir" 'Upload directory'
  validate_absolute_dir "$export_dir" 'Export directory'
  validate_absolute_dir "$database_dir" 'Database operations directory'
  validate_disjoint_directories \
    'Upload directory' "$upload_dir" \
    'Export directory' "$export_dir" \
    'Backup directory' "$BACKUP_DIR" \
    'Database operations directory' "$database_dir"
  retention="$(read_env_value BACKUP_RETENTION_DAYS)"
  retention="${retention:-14}"
  [[ "$retention" =~ ^[0-9]+$ ]] && [ "$retention" -ge 1 ] && [ "$retention" -le 3650 ] \
    || die 'BACKUP_RETENTION_DAYS must be a whole number from 1 to 3650.'
  ensure_directory "$BACKUP_DIR" root:root 750
  lock_file="$BACKUP_DIR/.backup.lock"
  exec 9>"$lock_file"
  flock -n 9 || die 'Another backup job is already running.'

  if [ "$verify" = '1' ]; then
    ENV_FILE="$ENV_FILE" BACKUP_DIR="$BACKUP_DIR/db" node "$APP_CURRENT/scripts/backup-database.js" --verify-latest
    exit 0
  fi

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  local database_backup_dir="$BACKUP_DIR/db"
  ENV_FILE="$ENV_FILE" BACKUP_DIR="$database_backup_dir" \
    node "$APP_CURRENT/scripts/backup-database.js" --dir "$database_backup_dir" --keep-days "$retention"
  archive_directory "$upload_dir" uploads "$timestamp"
  if [ -n "$export_dir" ] && [ "$export_dir" != "$upload_dir" ]; then archive_directory "$export_dir" exports "$timestamp"; fi
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type f \
    \( -name 'uploads-*.tar.gz' -o -name 'exports-*.tar.gz' \) \
    -mtime +"$retention" -delete
  echo '[backup] completed successfully.'
}

main "$@"
