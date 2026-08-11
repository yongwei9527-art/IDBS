#!/usr/bin/env bash
# Safe VPS update entrypoint. Keeps the current release if the source tree is dirty or health checks fail.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../deploy/vps-common.sh"

main() {
  require_root
  require_debian
  [ -f "$ENV_FILE" ] || die "No installed environment found at $ENV_FILE. Run scripts/install.sh first."
  [ -f "$APP_CURRENT/scripts/update-vps.sh" ] || die "Installed update implementation not found at $APP_CURRENT/scripts/update-vps.sh."
  exec env \
    APP_BASE="$APP_BASE" \
    SRC_DIR="$SRC_DIR" \
    ENV_FILE="$ENV_FILE" \
    SERVICE_NAME="$SERVICE_NAME" \
    LEGACY_SERVICE_NAME="$LEGACY_SERVICE_NAME" \
    APP_USER="$APP_USER" \
    APP_GROUP="${APP_GROUP:-$APP_USER}" \
    bash "$APP_CURRENT/scripts/update-vps.sh" "$@"
}

main "$@"