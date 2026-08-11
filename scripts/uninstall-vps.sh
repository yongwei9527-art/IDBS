#!/usr/bin/env bash
set -euo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=''
if [ -n "$SCRIPT_SOURCE" ] && [ -f "$SCRIPT_SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
fi

TEMP_COMMON_HELPER=''
cleanup() {
  [ -z "$TEMP_COMMON_HELPER" ] || rm -f -- "$TEMP_COMMON_HELPER"
}
trap cleanup EXIT

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../deploy/vps-common.sh" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/../deploy/vps-common.sh"
else
  BRANCH="${BRANCH:-main}"
  RAW_BASE_URL="${RAW_BASE_URL:-https://raw.githubusercontent.com/yongwei9527-art/IDBS/$BRANCH}"
  TEMP_COMMON_HELPER="$(mktemp)"
  curl -fsSL "$RAW_BASE_URL/deploy/vps-common.sh" -o "$TEMP_COMMON_HELPER"
  # shellcheck disable=SC1090
  source "$TEMP_COMMON_HELPER"
fi

require_root
validate_systemd_unit_name "$SERVICE_NAME" 'Canonical service name'
validate_systemd_unit_name "$LEGACY_SERVICE_NAME" 'Legacy service name'
validate_managed_root "$APP_BASE" 'Application base directory'
validate_managed_root "$SRC_DIR" 'Source directory'
validate_disjoint_directories \
  'Application base directory' "$APP_BASE" \
  'Source directory' "$SRC_DIR"

remove_app_data="${REMOVE_APP_DATA:-0}"
case "$remove_app_data" in
  0) ;;
  1)
    [ "${UNINSTALL_CONFIRMATION:-}" = 'DELETE-LABORATORY-MANAGEMENT-SYSTEM' ] \
      || die 'Set UNINSTALL_CONFIRMATION=DELETE-LABORATORY-MANAGEMENT-SYSTEM together with REMOVE_APP_DATA=1 to delete application data.'
    lexical_app_base="$(realpath -m -s -- "$APP_BASE")"
    resolved_app_base="$(readlink -m -- "$APP_BASE")"
    lexical_src_dir="$(realpath -m -s -- "$SRC_DIR")"
    resolved_src_dir="$(readlink -m -- "$SRC_DIR")"
    [ "$lexical_app_base" = "$resolved_app_base" ] \
      || die 'Application base directory traverses a symbolic link; refusing destructive removal.'
    [ "$lexical_src_dir" = "$resolved_src_dir" ] \
      || die 'Source directory traverses a symbolic link; refusing destructive removal.'
    [ ! -L "$APP_BASE" ] || die 'Application base directory is a symbolic link; refusing destructive removal.'
    [ ! -L "$SRC_DIR" ] || die 'Source directory is a symbolic link; refusing destructive removal.'
    ;;
  *) die 'REMOVE_APP_DATA must be 0 or 1.' ;;
esac

echo "[1/4] Stopping Laboratory Management System services"
for service in "$SERVICE_NAME" "$LEGACY_SERVICE_NAME"; do
  systemctl disable --now "$service" || true
  systemctl disable --now "${service}-backup.timer" || true
  systemctl stop "${service}-backup.service" || true
done

echo "[2/4] Removing systemd and Nginx configuration"
for service in "$SERVICE_NAME" "$LEGACY_SERVICE_NAME"; do
  rm -f -- \
    "/etc/systemd/system/${service}.service" \
    "/etc/systemd/system/${service}-backup.service" \
    "/etc/systemd/system/${service}-backup.timer" \
    "/etc/nginx/conf.d/${service}.conf" \
    "/etc/nginx/sites-enabled/${service}.conf" \
    "/etc/nginx/sites-available/${service}.conf"
done
systemctl daemon-reload
systemctl reload nginx || true
rm -f -- \
  /usr/local/bin/laboratory-management-system-update \
  "/usr/local/bin/${LEGACY_SERVICE_NAME}-update" \
  "/usr/local/bin/${SERVICE_NAME}-reset-admin-password" \
  "/usr/local/bin/${LEGACY_SERVICE_NAME}-reset-admin-password" \
  /usr/local/sbin/laboratory-management-system-configure-firebase

if [ -f /usr/local/bin/db ] && grep -Fq 'vps-db-panel.sh' /usr/local/bin/db; then
  rm -f -- /usr/local/bin/db
elif [ -e /usr/local/bin/db ]; then
  echo 'Preserving /usr/local/bin/db because it is not the Laboratory Management System panel wrapper.'
fi

echo "[3/4] Preserving application data by default"
if [ "$remove_app_data" = '1' ]; then
  rm -rf --one-file-system -- "$resolved_app_base"
  rm -rf --one-file-system -- "$resolved_src_dir"
  echo "Application files, source code, and default in-tree persistent directories were removed: $resolved_app_base, $resolved_src_dir"
  echo 'Custom upload, export, backup, or database-operation directories outside the application base were preserved.'
else
  echo "Application files, source code, and persistent data were preserved at: $APP_BASE and $SRC_DIR"
  echo 'To delete the application base and source code, rerun with REMOVE_APP_DATA=1 and the documented UNINSTALL_CONFIRMATION value.'
fi

echo "[4/4] Cleanup reminder"
echo "If you want to remove the PostgreSQL database and user as well, please back up data first and delete them manually in PostgreSQL."
echo "Any existing Let's Encrypt certificate is intentionally preserved; remove it with Certbot only after confirming no other site uses it."
