#!/usr/bin/env bash
# Install a daily cron job for IDBS database backups (02:15 server time).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_SCRIPT="$ROOT_DIR/scripts/backup-database.sh"
LOG_DIR="${IDBS_LOG_DIR:-/var/log/idbs}"
CRON_MARKER="# idbs-db-backup"

if [[ ! -f "$BACKUP_SCRIPT" ]]; then
  echo "missing $BACKUP_SCRIPT" >&2
  exit 1
fi
chmod +x "$BACKUP_SCRIPT" "$ROOT_DIR/scripts/backup-database.js" || true
mkdir -p "$LOG_DIR" "$ROOT_DIR/backups/db"

LINE="15 2 * * * cd $ROOT_DIR && /usr/bin/env bash $BACKUP_SCRIPT >> $LOG_DIR/db-backup.log 2>&1 $CRON_MARKER"
TMP="$(mktemp)"
crontab -l 2>/dev/null | grep -v "$CRON_MARKER" > "$TMP" || true
echo "$LINE" >> "$TMP"
crontab "$TMP"
rm -f "$TMP"
echo "Installed cron:"
echo "  $LINE"
echo "Manual run:"
echo "  npm run db:backup"
