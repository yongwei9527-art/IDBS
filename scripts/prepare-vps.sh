#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-laboratory_management_system}"
APP_BASE="${APP_BASE:-/var/www/laboratory-management-system}"
SRC_DIR="${SRC_DIR:-/var/www/laboratory-management-system-src}"
APP_USER="${APP_USER:-laboratory_management_system}"
APP_GROUP="${APP_GROUP:-$APP_USER}"
RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA="${RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA:-0}"

log() { printf '\n[prepare-laboratory_management_system] %s\n' "$*"; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    log "Run this script as root (or with sudo)."
    exit 1
  fi
}

install_base_packages() {
  export DEBIAN_FRONTEND=noninteractive
  log "Refreshing apt and installing base packages"
  apt-get update -y
  apt-get install -y curl ca-certificates gnupg git openssl nginx postgresql postgresql-client rsync
}

stop_old_services() {
  log "Stopping old 实验室管理系统 services if they exist"
  systemctl stop "${APP_NAME}" || true
  systemctl disable "${APP_NAME}" || true
  systemctl stop "${APP_NAME}-backup.timer" || true
  systemctl disable "${APP_NAME}-backup.timer" || true
  systemctl stop "${APP_NAME}-backup.service" || true

  rm -f "/etc/systemd/system/${APP_NAME}.service"
  rm -f "/etc/systemd/system/${APP_NAME}-backup.service"
  rm -f "/etc/systemd/system/${APP_NAME}-backup.timer"
  systemctl daemon-reload
}

cleanup_nginx_defaults() {
  log "Removing nginx default sites so the server IP opens 实验室管理系统"
  rm -f /etc/nginx/sites-enabled/default
  rm -f /etc/nginx/conf.d/default.conf
  rm -f "/etc/nginx/sites-enabled/${APP_NAME}.conf"
  rm -f "/etc/nginx/sites-available/${APP_NAME}.conf"
  rm -f "/etc/nginx/conf.d/${APP_NAME}.conf"
  nginx -t
  systemctl enable nginx
  systemctl restart nginx
}

ensure_runtime_dirs() {
  log "Preparing runtime directories"
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
  fi
  mkdir -p "$APP_BASE" "$SRC_DIR"
  chown -R "$APP_USER:$APP_GROUP" "$APP_BASE"
}

reset_data_if_requested() {
  if [ "$RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA" != "1" ]; then
    log "Keeping existing application data and PostgreSQL database. Set RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA=1 only for a destructive reinstall."
    return 0
  fi

  log "RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA=1 detected: deleting application files and local PostgreSQL laboratory_management_system database"
  rm -rf "$APP_BASE"
  rm -rf "$SRC_DIR"

  systemctl enable postgresql
  systemctl start postgresql
  sudo -u postgres psql -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='laboratory_management_system';" || true
  sudo -u postgres dropdb --if-exists laboratory_management_system || true
  sudo -u postgres dropuser --if-exists laboratory_management_system_user || true
}

print_next_steps() {
  log "VPS is ready for 实验室管理系统 installation"
  cat <<'EOF'
Next step:
  bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install-vps.sh)

If this is a brand-new destructive reinstall, run prepare with:
  RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA=1 bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/prepare-vps.sh)

After install, open:
  - With domain: https://your-domain/
  - Without domain: http://SERVER_IP/
EOF
}

main() {
  require_root
  install_base_packages
  stop_old_services
  cleanup_nginx_defaults
  reset_data_if_requested
  ensure_runtime_dirs
  print_next_steps
}

main "$@"
