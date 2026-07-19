#!/usr/bin/env bash
# Daily database backup helper for Linux/VPS.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
elif [[ -f /var/www/idbs/shared/.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /var/www/idbs/shared/.env
  set +a
fi
export BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/db}"
export BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
node "$ROOT_DIR/scripts/backup-database.js"
node "$ROOT_DIR/scripts/backup-database.js" --verify-latest
