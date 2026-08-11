#!/usr/bin/env bash
# Daily database backup helper for Linux/VPS.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
if [[ -f "$ROOT_DIR/.env" ]]; then
  export ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
elif [[ -f /var/www/laboratory-management-system/shared/.env ]]; then
  export ENV_FILE="${ENV_FILE:-/var/www/laboratory-management-system/shared/.env}"
fi
node "$ROOT_DIR/scripts/backup-database.js"
node "$ROOT_DIR/scripts/backup-database.js" --verify-latest
