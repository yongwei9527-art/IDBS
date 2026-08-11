#!/usr/bin/env bash
# Shared helpers for the VPS entrypoint scripts. Do not print secrets from here.
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-laboratory-management-system}"
LEGACY_SERVICE_NAME="${LEGACY_SERVICE_NAME:-laboratory_management_system}"
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

disable_retired_bullseye_backports() {
  local source_file backup_suffix
  [ -r /etc/os-release ] || return 0
  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = 'debian' ] && [ "${VERSION_CODENAME:-}" = 'bullseye' ] || return 0

  backup_suffix=".laboratory-management-system-backup"
  for source_file in /etc/apt/sources.list /etc/apt/sources.list.d/*.list; do
    [ -f "$source_file" ] || continue
    grep -Eq '^[[:space:]]*deb(-src)?[[:space:]].*[[:space:]]bullseye-backports([[:space:]]|$)' "$source_file" || continue
    [ -e "${source_file}${backup_suffix}" ] || cp -a -- "$source_file" "${source_file}${backup_suffix}"
    sed -E -i \
      '/^[[:space:]]*deb(-src)?[[:space:]].*[[:space:]]bullseye-backports([[:space:]]|$)/ s|^|# Disabled retired bullseye-backports by Laboratory Management System: |' \
      "$source_file"
    log "Disabled retired Debian 11 backports entry in $source_file"
  done

  for source_file in /etc/apt/sources.list.d/*.sources; do
    [ -f "$source_file" ] || continue
    grep -Eq '^[[:space:]]*Suites:.*(^|[[:space:]])bullseye-backports([[:space:]]|$)' "$source_file" || continue
    [ -e "${source_file}${backup_suffix}" ] || cp -a -- "$source_file" "${source_file}${backup_suffix}"
    sed -E -i \
      -e 's/^[[:space:]]*Suites:[[:space:]]*bullseye-backports[[:space:]]*$/Suites: bullseye/' \
      -e '/^[[:space:]]*Suites:/ s/(^|[[:space:]])bullseye-backports([[:space:]]|$)/ /g' \
      "$source_file"
    log "Removed retired Debian 11 backports suite from $source_file"
  done
}

safe_apt_update() {
  disable_retired_bullseye_backports
  apt-get update "$@"
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
  value="${value,,}"
  value="${value#http://}"
  value="${value#https://}"
  value="${value%%/*}"
  value="${value%.}"
  printf '%s' "$value"
}

validate_domain() {
  local value="$1" label
  [ -z "$value" ] && return 0
  [ "${#value}" -le 253 ] || die 'Domain name must be 253 characters or fewer.'
  [[ "$value" != *'..'* && "$value" != .* && "$value" != *. ]] \
    || die 'Domain name contains an empty label.'
  IFS='.' read -r -a domain_labels <<< "$value"
  [ "${#domain_labels[@]}" -ge 2 ] || die 'Enter a fully qualified domain name such as lab.example.com.'
  for label in "${domain_labels[@]}"; do
    [ "${#label}" -ge 1 ] && [ "${#label}" -le 63 ] \
      || die 'Each domain label must contain 1-63 characters.'
    [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] \
      || die 'Domain labels may contain only letters, digits, and internal hyphens.'
  done
  [[ "${domain_labels[${#domain_labels[@]}-1]}" =~ [A-Za-z] ]] \
    || die 'The final domain label must contain a letter.'
}

letsencrypt_paths_match_domain() {
  local domain="$1" certificate="$2" certificate_key="$3" certificate_dir key_dir name suffix
  validate_domain "$domain"
  [[ "$certificate" == /etc/letsencrypt/live/*/fullchain.pem ]] || return 1
  [[ "$certificate_key" == /etc/letsencrypt/live/*/privkey.pem ]] || return 1
  certificate_dir="${certificate%/fullchain.pem}"
  key_dir="${certificate_key%/privkey.pem}"
  [ "$certificate_dir" = "$key_dir" ] || return 1
  name="${certificate_dir##*/}"
  if [ "$name" != "$domain" ]; then
    suffix="${name#"$domain"-}"
    [[ "$suffix" =~ ^[0-9]+$ ]] || return 1
  fi
  [ -r "$certificate" ] && [ -r "$certificate_key" ]
}

find_letsencrypt_live_dir() {
  local domain="$1" candidate name suffix
  validate_domain "$domain"
  for candidate in "/etc/letsencrypt/live/$domain" "/etc/letsencrypt/live/$domain"-*; do
    [ -d "$candidate" ] || continue
    name="${candidate##*/}"
    if [ "$name" != "$domain" ]; then
      suffix="${name#"$domain"-}"
      [[ "$suffix" =~ ^[0-9]+$ ]] || continue
    fi
    [ -r "$candidate/fullchain.pem" ] && [ -r "$candidate/privkey.pem" ] || continue
    printf '%s' "$candidate"
    return 0
  done
  return 1
}

validate_phone() {
  [[ "$1" =~ ^\+?[0-9-]{6,20}$ ]] || die 'Administrator phone/login must contain 6-20 digits (optional + or hyphens).'
}

canonicalize_absolute_dir() {
  local value="$1" label="${2:-Directory}" normalized
  [[ "$value" == /* ]] || die "$label must be an absolute Linux path."
  [[ "$value" =~ ^/[A-Za-z0-9._/+@-]+$ ]] \
    || die "$label may contain only letters, digits, dot, underscore, plus, at-sign, slash, and hyphen."
  [[ "/$value/" != *'/../'* && "/$value/" != *'/./'* ]] \
    || die "$label must not contain . or .. path segments."
  normalized="$(readlink -m -- "$value")"
  [ -n "$normalized" ] || normalized='/'
  printf '%s' "$normalized"
}

validate_managed_root() {
  local value="$1" label="$2" normalized
  normalized="$(canonicalize_absolute_dir "$value" "$label")"
  case "$normalized" in
    /|/bin|/bin/*|/boot|/boot/*|/dev|/dev/*|/etc|/etc/*|/home|/lib|/lib/*|/lib32|/lib32/*|/lib64|/lib64/*|/media|/mnt|/opt|/proc|/proc/*|/root|/root/*|/run|/run/*|/sbin|/sbin/*|/srv|/sys|/sys/*|/tmp|/tmp/*|/usr|/usr/*|/var|/var/cache|/var/cache/*|/var/lib|/var/lib/postgresql|/var/lib/postgresql/*|/var/log|/var/log/*|/var/run|/var/run/*|/var/spool|/var/spool/*|/var/tmp|/var/tmp/*|/var/www)
      die "$label must be a dedicated application directory, not a system directory: $normalized"
      ;;
  esac
}

path_is_same_or_within() {
  local candidate="$1" parent="$2"
  [ "$candidate" = "$parent" ] || [[ "$candidate" == "$parent"/* ]]
}

validate_absolute_dir() {
  local value="$1" label="$2" normalized app_base app_current app_previous app_releases app_shared app_downloads source_root protected
  normalized="$(canonicalize_absolute_dir "$value" "$label")"
  case "$normalized" in
    /|/bin|/bin/*|/boot|/boot/*|/dev|/dev/*|/etc|/etc/*|/home|/lib|/lib/*|/lib32|/lib32/*|/lib64|/lib64/*|/media|/mnt|/opt|/proc|/proc/*|/root|/root/*|/run|/run/*|/sbin|/sbin/*|/srv|/sys|/sys/*|/tmp|/tmp/*|/usr|/usr/*|/var|/var/cache|/var/cache/*|/var/lib/postgresql|/var/lib/postgresql/*|/var/log|/var/log/*|/var/run|/var/run/*|/var/spool|/var/spool/*|/var/tmp|/var/tmp/*|/var/www)
      die "$label must be a dedicated subdirectory, not a system root directory: $normalized"
      ;;
  esac

  app_base="$(readlink -m -- "$APP_BASE")"
  app_current="$(readlink -m -- "$APP_CURRENT")"
  app_previous="$(readlink -m -- "$APP_BASE/previous")"
  app_releases="$(readlink -m -- "$APP_BASE/releases")"
  app_shared="$(readlink -m -- "$APP_BASE/shared")"
  app_downloads="$(readlink -m -- "$APP_BASE/downloads")"
  source_root="$(readlink -m -- "$SRC_DIR")"
  [ "$normalized" != "$app_base" ] \
    || die "$label must not be the application base directory itself: $normalized"
  for protected in "$app_current" "$app_previous" "$app_releases" "$app_shared" "$app_downloads" "$source_root"; do
    if path_is_same_or_within "$normalized" "$protected" \
      || path_is_same_or_within "$protected" "$normalized"; then
      die "$label must not overlap release, download, source, or shared-secret directories: $normalized"
    fi
  done
}

validate_disjoint_directories() {
  local -a labels=() paths=()
  local label value normalized i j
  [ $(( $# % 2 )) -eq 0 ] || die 'Directory validation requires label/path pairs.'
  while [ "$#" -gt 0 ]; do
    label="$1"
    value="$2"
    shift 2
    normalized="$(canonicalize_absolute_dir "$value" "$label")"
    labels+=("$label")
    paths+=("$normalized")
  done
  for ((i = 0; i < ${#paths[@]}; i++)); do
    for ((j = i + 1; j < ${#paths[@]}; j++)); do
      if path_is_same_or_within "${paths[$i]}" "${paths[$j]}" \
        || path_is_same_or_within "${paths[$j]}" "${paths[$i]}"; then
        die "${labels[$i]} and ${labels[$j]} must be separate, non-nested directories."
      fi
    done
  done
}

validate_systemd_unit_name() {
  local value="$1" label="$2"
  [[ "$value" =~ ^[A-Za-z0-9_.@-]+$ ]] || die "$label is not a valid systemd unit name."
}

encode_firebase_service_account() {
  local source_file="$1"
  [ -f "$source_file" ] || die "Firebase service-account file not found: $source_file"
  node - "$source_file" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const source = process.argv[2];
let account;
try {
  account = JSON.parse(fs.readFileSync(source, 'utf8'));
} catch (_) {
  process.stderr.write('Firebase service-account file is not valid JSON.\n');
  process.exit(1);
}
if (account?.type !== 'service_account'
  || typeof account.project_id !== 'string' || !account.project_id
  || typeof account.client_email !== 'string' || !account.client_email
  || typeof account.private_key !== 'string' || !account.private_key.includes('BEGIN PRIVATE KEY')) {
  process.stderr.write('Firebase service-account JSON is missing required fields.\n');
  process.exit(1);
}
try {
  crypto.createPrivateKey(account.private_key);
} catch (_) {
  process.stderr.write('Firebase service-account private key is invalid.\n');
  process.exit(1);
}
process.stdout.write(Buffer.from(JSON.stringify(account), 'utf8').toString('base64'));
NODE
}

generate_secret() {
  openssl rand -hex 32
}

generate_password() {
  printf 'Lms!%s' "$(openssl rand -hex 12)"
}

github_release_apk_url() {
  local source_dir="$1" package_file version
  package_file="$source_dir/package.json"
  [ -f "$package_file" ] || return 1
  version="$(node -e 'const fs = require("node:fs"); const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(pkg.version || ""));' "$package_file" 2>/dev/null || true)"
  [[ "$version" =~ ^[0-9][0-9A-Za-z.+-]*$ ]] || return 1
  printf 'https://github.com/yongwei9527-art/IDBS/releases/download/v%s/Laboratory-Management-System-v%s.apk' "$version" "$version"
}

is_ipv4() {
  local value="$1" octet
  local -a octets
  [[ "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  IFS='.' read -r -a octets <<< "$value"
  [ "${#octets[@]}" -eq 4 ] || return 1
  for octet in "${octets[@]}"; do
    [ "$((10#$octet))" -le 255 ] || return 1
  done
}

is_non_public_ipv4() {
  local value="$1" first second _third _fourth
  is_ipv4 "$value" || return 1
  IFS='.' read -r first second _third _fourth <<< "$value"
  case "$first" in
    0|10|127) return 0 ;;
    100) [ "$second" -ge 64 ] && [ "$second" -le 127 ] && return 0 ;;
    169) [ "$second" -eq 254 ] && return 0 ;;
    172) [ "$second" -ge 16 ] && [ "$second" -le 31 ] && return 0 ;;
    192)
      case "$second" in
        0|2|168) return 0 ;;
        88) [ "$_third" -eq 99 ] && return 0 ;;
      esac
      ;;
    198)
      case "$second" in
        18|19) return 0 ;;
        51) [ "$_third" -eq 100 ] && return 0 ;;
      esac
      ;;
    203) [ "$second" -eq 0 ] && [ "$_third" -eq 113 ] && return 0 ;;
  esac
  [ "$first" -ge 224 ]
}

detect_public_ip() {
  local ip candidate
  ip="$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null | tr -d '[:space:]' || true)"
  if is_ipv4 "$ip"; then
    printf '%s' "$ip"
    return 0
  fi
  while IFS= read -r candidate; do
    if is_ipv4 "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  done < <(hostname -I 2>/dev/null | tr '[:space:]' '\n' || true)
  return 1
}

ensure_directory() {
  local target="$1" owner="$2" mode="$3"
  mkdir -p -- "$target"
  chown -- "$owner" "$target"
  chmod -- "$mode" "$target"
}

set_env_value() {
  local key="$1" value="$2" temp value_file
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "Invalid environment key: $key"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || die "Environment value for $key contains an invalid newline."
  mkdir -p "$(dirname "$ENV_FILE")"
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  temp="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  value_file="$(mktemp "${ENV_FILE}.value.XXXXXX")"
  chmod 600 "$temp" "$value_file"
  printf '%s' "$value" > "$value_file"
  if ! awk -v key="$key" -v value_file="$value_file" '
    BEGIN {
      if ((getline value < value_file) < 0) exit 2
      close(value_file)
      done = 0
    }
    index($0, key "=") == 1 { if (!done) print key "=" value; done = 1; next }
    { print }
    END { if (!done) print key "=" value }
  ' "$ENV_FILE" > "$temp"; then
    rm -f "$temp" "$value_file"
    die "Could not update environment key: $key"
  fi
  install -m 600 "$temp" "$ENV_FILE"
  rm -f "$temp" "$value_file"
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

validate_release_id() {
  local value="$1"
  [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ ]] \
    || die 'Release id must contain only letters, digits, dot, underscore, and hyphen (maximum 80 characters).'
}

release_path_is_managed() {
  local candidate="$1" releases_root="$2" resolved_candidate resolved_root
  resolved_candidate="$(readlink -m -- "$candidate")"
  resolved_root="$(readlink -m -- "$releases_root")"
  [ "$resolved_candidate" != "$resolved_root" ] \
    && path_is_same_or_within "$resolved_candidate" "$resolved_root"
}

atomic_symlink_replace() {
  local target="$1" link_path="$2" link_parent temp_dir temp_link
  [ -n "$target" ] && [ -n "$link_path" ] || die 'Atomic symlink replacement requires a target and link path.'
  link_parent="$(dirname "$link_path")"
  mkdir -p -- "$link_parent"
  temp_dir="$(mktemp -d "$link_parent/.release-link.XXXXXX")"
  temp_link="$temp_dir/link"
  ln -s -- "$target" "$temp_link"
  if ! mv -Tf -- "$temp_link" "$link_path"; then
    rm -f -- "$temp_link"
    rmdir -- "$temp_dir" || true
    return 1
  fi
  rmdir -- "$temp_dir"
}
