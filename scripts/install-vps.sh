#!/usr/bin/env bash
# Compatibility entrypoint. The project has one canonical VPS installer: install.sh.
set -euo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=''
if [ -n "$SCRIPT_SOURCE" ] && [ -f "$SCRIPT_SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
fi
LOCAL_INSTALLER="${SCRIPT_DIR:+$SCRIPT_DIR/install.sh}"

if [ -n "$LOCAL_INSTALLER" ] && [ -f "$LOCAL_INSTALLER" ]; then
  exec bash "$LOCAL_INSTALLER" "$@"
fi

BRANCH="${BRANCH:-main}"
RAW_BASE_URL="${RAW_BASE_URL:-https://raw.githubusercontent.com/yongwei9527-art/IDBS/$BRANCH}"
TEMP_INSTALLER="$(mktemp)"
cleanup() { rm -f "$TEMP_INSTALLER"; }
trap cleanup EXIT

echo '[vps] scripts/install-vps.sh is a compatibility alias; starting scripts/install.sh.'
curl -fsSL "$RAW_BASE_URL/scripts/install.sh" -o "$TEMP_INSTALLER"
bash "$TEMP_INSTALLER" "$@"
