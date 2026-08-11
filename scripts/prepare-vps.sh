#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-laboratory-management-system}"
LEGACY_SERVICE_NAME="${LEGACY_SERVICE_NAME:-laboratory_management_system}"
APP_BASE="${APP_BASE:-/var/www/laboratory-management-system}"
SRC_DIR="${SRC_DIR:-/var/www/laboratory-management-system-src}"
APP_USER="${APP_USER:-laboratory_management_system}"
RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA="${RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA:-0}"
RESET_CONFIRMATION="${RESET_CONFIRMATION:-}"

log() { printf '\n[prepare-vps] %s\n' "$*"; }
die() { printf '[prepare-vps] ERROR: %s\n' "$*" >&2; exit 1; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    log "Run this script as root (or with sudo)."
    exit 1
  fi
}

canonicalize_managed_root() {
  local value="$1" label="$2" lexical resolved
  [[ "$value" == /* ]] || die "$label must be an absolute Linux path."
  [[ "$value" =~ ^/[A-Za-z0-9._/+@-]+$ ]] \
    || die "$label contains unsupported characters."
  [[ "/$value/" != *'/../'* && "/$value/" != *'/./'* ]] \
    || die "$label must not contain . or .. path segments."
  lexical="$(realpath -m -s -- "$value")"
  resolved="$(readlink -m -- "$value")"
  [ "$lexical" = "$resolved" ] \
    || die "$label must not traverse symbolic links: $value"
  case "$resolved" in
    /|/bin|/bin/*|/boot|/boot/*|/dev|/dev/*|/etc|/etc/*|/lib|/lib/*|/lib32|/lib32/*|/lib64|/lib64/*|/proc|/proc/*|/root|/root/*|/run|/run/*|/sbin|/sbin/*|/sys|/sys/*|/tmp|/tmp/*|/usr|/usr/*|/var|/var/cache|/var/cache/*|/var/lib/postgresql|/var/lib/postgresql/*|/var/log|/var/log/*|/var/run|/var/run/*|/var/spool|/var/spool/*|/var/tmp|/var/tmp/*|/var/www)
      die "$label must be a dedicated application directory, not a system directory: $resolved"
      ;;
  esac
  printf '%s' "$resolved"
}

path_is_same_or_within() {
  local candidate="$1" parent="$2"
  [ "$candidate" = "$parent" ] || [[ "$candidate" == "$parent"/* ]]
}

validate_configuration() {
  [[ "$SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+$ ]] || die 'Canonical service name is invalid.'
  [[ "$LEGACY_SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+$ ]] || die 'Legacy service name is invalid.'
  [[ "$APP_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die 'Application user name is invalid.'
  APP_BASE="$(canonicalize_managed_root "$APP_BASE" 'Application base directory')"
  SRC_DIR="$(canonicalize_managed_root "$SRC_DIR" 'Source directory')"
  if path_is_same_or_within "$APP_BASE" "$SRC_DIR" \
    || path_is_same_or_within "$SRC_DIR" "$APP_BASE"; then
    die 'Application base and source directories must be separate, non-nested directories.'
  fi
}

remove_managed_tree() {
  local target="$1" label="$2"
  [ ! -L "$target" ] || die "$label unexpectedly became a symbolic link; refusing destructive removal."
  [ ! -e "$target" ] || rm -rf --one-file-system -- "$target"
}

disable_retired_bullseye_backports() {
  local source_file
  [ -r /etc/os-release ] || return 0
  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = 'debian' ] && [ "${VERSION_CODENAME:-}" = 'bullseye' ] || return 0
  for source_file in /etc/apt/sources.list /etc/apt/sources.list.d/*.list; do
    [ -f "$source_file" ] || continue
    grep -Eq '^[[:space:]]*deb(-src)?[[:space:]].*[[:space:]]bullseye-backports([[:space:]]|$)' "$source_file" || continue
    [ -e "${source_file}.laboratory-management-system-backup" ] \
      || cp -a -- "$source_file" "${source_file}.laboratory-management-system-backup"
    sed -E -i \
      '/^[[:space:]]*deb(-src)?[[:space:]].*[[:space:]]bullseye-backports([[:space:]]|$)/ s|^|# Disabled retired bullseye-backports by Laboratory Management System: |' \
      "$source_file"
    log "Disabled retired Debian 11 backports entry in $source_file"
  done
  for source_file in /etc/apt/sources.list.d/*.sources; do
    [ -f "$source_file" ] || continue
    grep -Eq '^[[:space:]]*Suites:.*bullseye-backports([[:space:]]|$)' "$source_file" || continue
    [ -e "${source_file}.laboratory-management-system-backup" ] \
      || cp -a -- "$source_file" "${source_file}.laboratory-management-system-backup"
    sed -E -i \
      -e 's/^[[:space:]]*Suites:[[:space:]]*bullseye-backports[[:space:]]*$/Suites: bullseye/' \
      -e '/^[[:space:]]*Suites:/ s/(^|[[:space:]])bullseye-backports([[:space:]]|$)/ /g' \
      "$source_file"
    log "Removed retired Debian 11 backports suite from $source_file"
  done
}

install_base_packages() {
  export DEBIAN_FRONTEND=noninteractive
  log "Refreshing apt and installing base packages"
  disable_retired_bullseye_backports
  apt-get update -y
  apt-get install -y curl ca-certificates gnupg git openssl nginx postgresql postgresql-client rsync sudo
}

stop_old_services() {
  log "Stopping old 实验室管理系统 services if they exist"
  local name
  for name in "$SERVICE_NAME" "$LEGACY_SERVICE_NAME"; do
    systemctl stop "$name" || true
    systemctl disable "$name" || true
    systemctl stop "${name}-backup.timer" || true
    systemctl disable "${name}-backup.timer" || true
    systemctl stop "${name}-backup.service" || true
    rm -f "/etc/systemd/system/${name}.service"
    rm -f "/etc/systemd/system/${name}-backup.service"
    rm -f "/etc/systemd/system/${name}-backup.timer"
  done
  systemctl daemon-reload
}

cleanup_nginx_defaults() {
  log "Removing nginx default sites so the server IP opens 实验室管理系统"
  rm -f /etc/nginx/sites-enabled/default
  rm -f /etc/nginx/conf.d/default.conf
  local name
  for name in "$SERVICE_NAME" "$LEGACY_SERVICE_NAME"; do
    rm -f "/etc/nginx/sites-enabled/${name}.conf"
    rm -f "/etc/nginx/sites-available/${name}.conf"
    rm -f "/etc/nginx/conf.d/${name}.conf"
  done
  nginx -t
  systemctl enable nginx
  systemctl restart nginx
}

ensure_runtime_dirs() {
  log "Preparing runtime directories"
  if ! getent group "$APP_USER" >/dev/null 2>&1; then
    groupadd --system "$APP_USER"
  fi
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --create-home --shell /usr/sbin/nologin --gid "$APP_USER" "$APP_USER"
  fi
  mkdir -p "$APP_BASE" "$SRC_DIR"
  # Never recursively hand shared/.env or pending root credentials to the runtime user.
  chown root:root "$APP_BASE"
  chmod 755 "$APP_BASE"
}

reset_data_if_requested() {
  log "RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA=1 detected: deleting application files and local PostgreSQL laboratory_management_system database"
  remove_managed_tree "$APP_BASE" 'Application base directory'
  remove_managed_tree "$SRC_DIR" 'Source directory'

  systemctl enable postgresql
  systemctl start postgresql
  sudo -u postgres psql -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='laboratory_management_system';" || true
  sudo -u postgres dropdb --if-exists laboratory_management_system || true
  sudo -u postgres dropuser --if-exists laboratory_management_system_user || true
}

validate_reset_request() {
  case "$RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA" in
    0) return 0 ;;
    1)
      [ "$RESET_CONFIRMATION" = 'DELETE-LABORATORY-MANAGEMENT-SYSTEM-DATA' ] \
        || die 'Destructive reset also requires RESET_CONFIRMATION=DELETE-LABORATORY-MANAGEMENT-SYSTEM-DATA.'
      ;;
    *) die 'RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA must be 0 or 1.' ;;
  esac
}

print_next_steps() {
  log "VPS is ready for 实验室管理系统 installation"
  cat <<'EOF'
Next step:
  tmp="$(mktemp)"
  curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install.sh -o "$tmp"
  sudo bash "$tmp"
  rm -f "$tmp"

If this is a brand-new destructive reinstall, run prepare with:
  tmp="$(mktemp)"
  curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/prepare-vps.sh -o "$tmp"
  sudo env RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA=1 RESET_CONFIRMATION=DELETE-LABORATORY-MANAGEMENT-SYSTEM-DATA bash "$tmp"
  rm -f "$tmp"

After install, open:
  - With domain: https://your-domain/v5/
  - Without domain: http://SERVER_IP/v5/
EOF
}

main() {
  require_root
  validate_configuration
  validate_reset_request
  install_base_packages
  if [ "$RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA" = '1' ]; then
    # Destructive preparation is the only mode allowed to interrupt an existing install.
    stop_old_services
    cleanup_nginx_defaults
    reset_data_if_requested
  else
    log 'Keeping the existing service, Nginx configuration, application data, and PostgreSQL database.'
    log 'Normal prepare mode only installs prerequisites and ensures managed roots exist.'
  fi
  ensure_runtime_dirs
  print_next_steps
}

main "$@"
