#!/usr/bin/env bash
# Shared helpers for the VPS entrypoint scripts. Do not print secrets from here.
set -euo pipefail

APP_NAME="${APP_NAME:-laboratory_management_system}"
APP_BASE="${APP_BASE:-/var/www/laboratory-management-system}"
SRC_DIR="${SRC_DIR:-/var/www/laboratory-management-system-src}"
APP_CURRENT="${APP_CURRENT:-$APP_BASE/current}"
ENV_FILE="${ENV_FILE:-$APP_BASE/shared/.env}"
APP_USER="${APP_USER:-laboratory_management_system}"

log() { printf '\n[vps] %s\n' "$*"; }
die() { printf '[vps] ERROR: %s\n' "$*" >&2; exit 1; }

require_root() {
  [ "$(id -u)" -eq 0 ] || die 'Run this script as root or with sudo.'
}

require_debian() {
  [ -r /etc/os-release ] || die 'Only Ubuntu/Debian VPS hosts are supported.'
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) ;;
    *) die "Unsupported operating system: ${ID:-unknown}." ;;
  esac
}

ask_value() {
  local prompt="$1" default="${2:-}" reply
  read -r -p "${prompt}${default:+ [$default]}: " reply </dev/tty || true
  printf '%s' "${reply:-$default}"
}

ask_yes_no() {
  local prompt="$1" default="$2" reply
  read -r -p "${prompt} [${default}] " reply </dev/tty || true
  reply="${reply:-$default}"
  case "$reply" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

normalize_host() {
  local value="$1"
  value="${value#http://}"
  value="${value#https://}"
  value="${value%%/*}"
  value="${value%.}"
  printf '%s' "$value"
}

validate_domain() {
  [ -z "$1" ] && return 0
  [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die 'Domain must not include protocol, port, or path.'
}

validate_phone() {
  [[ "$1" =~ ^\+?[0-9-]{6,20}$ ]] || die 'Administrator phone/login must contain 6-20 digits (optional + or hyphens).'
}

validate_absolute_dir() {
  local value="$1" label="$2"
  [[ "$value" == /* ]] || die "$label must be an absolute Linux path."
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || die "$label contains an invalid newline."
}

generate_secret() {
  openssl rand -hex 32
}

generate_password() {
  printf 'Lms!%s' "$(openssl rand -hex 12)"
}

detect_public_ip() {
  local ip
  ip="$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  [ -n "$ip" ] || ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf '%s' "$ip"
}

ensure_directory() {
  local target="$1" owner="$2" mode="$3"
  mkdir -p "$target"
  chown "$owner" "$target"
  chmod "$mode" "$target"
}

set_env_value() {
  local key="$1" value="$2" temp
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "Invalid environment key: $key"
  mkdir -p "$(dirname "$ENV_FILE")"
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  temp="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { done = 0 }
    index($0, key "=") == 1 { if (!done) print key "=" value; done = 1; next }
    { print }
    END { if (!done) print key "=" value }
  ' "$ENV_FILE" > "$temp"
  install -m 600 "$temp" "$ENV_FILE"
  rm -f "$temp"
}

read_env_value() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  awk -v key="$key" 'index($0, key "=") == 1 { value = substr($0, length(key) + 2) } END { print value }' "$ENV_FILE"
}

public_origin() {
  local host="$1" https="$2"
  if [ "$https" = '1' ]; then printf 'https://%s' "$host"; else printf 'http://%s' "$host"; fi
}
