#!/usr/bin/env bash
# Root-owned VPS command for adding or rotating the Firebase Admin credential.
set -euo pipefail
umask 077

SERVICE_NAME="${SERVICE_NAME:-laboratory-management-system}"
LEGACY_SERVICE_NAME="${LEGACY_SERVICE_NAME:-laboratory_management_system}"
APP_BASE="${APP_BASE:-/var/www/laboratory-management-system}"
ENV_FILE="${ENV_FILE:-$APP_BASE/shared/.env}"
TRUSTED_COMMAND="${TRUSTED_COMMAND:-/usr/local/sbin/laboratory-management-system-configure-firebase}"

die() { printf '[firebase-config] ERROR: %s\n' "$*" >&2; exit 1; }

require_root() {
  [ "$(id -u)" -eq 0 ] || die 'Run this command as root (or with sudo).'
}

require_debian() {
  [ -r /etc/os-release ] || die 'Only Ubuntu/Debian VPS hosts are supported.'
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in ubuntu|debian) ;; *) die "Unsupported operating system: ${ID:-unknown}." ;; esac
}

validate_service_names() {
  [[ "$SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+$ ]] || die 'Canonical service name is invalid.'
  [[ "$LEGACY_SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+$ ]] || die 'Legacy service name is invalid.'
}

restart_application_service() {
  local service
  for service in "$SERVICE_NAME" "$LEGACY_SERVICE_NAME"; do
    if systemctl cat "${service}.service" >/dev/null 2>&1; then
      systemctl restart "$service" && return 0
    fi
  done
  return 1
}

require_trusted_install() {
  local current expected target owner mode permissions
  current="$(readlink -f "${BASH_SOURCE[0]}")"
  expected="$(readlink -f "$TRUSTED_COMMAND" 2>/dev/null || true)"
  [ -n "$expected" ] && [ "$current" = "$expected" ] || die "Use the root-owned command installed at $TRUSTED_COMMAND."
  for target in "$current" "$(dirname "$current")"; do
    owner="$(stat -c '%u' "$target")"
    mode="$(stat -c '%a' "$target")"
    permissions=$((8#$mode))
    [ "$owner" -eq 0 ] && [ $((permissions & 0022)) -eq 0 ] \
      || die "Trusted command path is writable by a non-root user: $target"
  done
}

ask_value() {
  local prompt="$1" value
  read -r -p "$prompt: " value </dev/tty
  printf '%s' "$value"
}

encode_firebase_service_account() {
  local source_file="${1:-}" input_mode
  if [ -n "$source_file" ]; then
    [ -f "$source_file" ] || die "Firebase service-account file not found: $source_file"
    input_mode=file
  elif [ -n "${FCM_SERVICE_ACCOUNT_JSON_BASE64:-}" ]; then
    input_mode=base64
  elif [ -n "${FCM_SERVICE_ACCOUNT_JSON:-}" ]; then
    input_mode=json
  else
    die 'No Firebase service-account credential was supplied.'
  fi
  FIREBASE_INPUT_MODE="$input_mode" FIREBASE_INPUT_FILE="$source_file" node <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const mode = process.env.FIREBASE_INPUT_MODE;
let raw;
if (mode === 'file') {
  raw = fs.readFileSync(process.env.FIREBASE_INPUT_FILE, 'utf8');
} else if (mode === 'base64') {
  const encoded = String(process.env.FCM_SERVICE_ACCOUNT_JSON_BASE64 || '').trim();
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    process.stderr.write('Firebase service-account Base64 is malformed.\n');
    process.exit(1);
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) {
    process.stderr.write('Firebase service-account Base64 is not canonical.\n');
    process.exit(1);
  }
  raw = bytes.toString('utf8');
} else if (mode === 'json') {
  raw = String(process.env.FCM_SERVICE_ACCOUNT_JSON || '');
} else {
  process.stderr.write('Firebase service-account input mode is invalid.\n');
  process.exit(1);
}
let account;
try {
  account = JSON.parse(raw);
} catch (_) {
  process.stderr.write('Firebase service-account credential is not valid JSON.\n');
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

set_env_value() {
  local key="$1" value="$2" temp value_file
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || return 1
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || return 1
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
    return 1
  fi
  install -o root -g root -m 600 "$temp" "$ENV_FILE"
  rm -f "$temp" "$value_file"
}

read_env_value() {
  local key="$1"
  awk -v key="$key" 'index($0, key "=") == 1 { value = substr($0, length(key) + 2) } END { print value }' "$ENV_FILE"
}

wait_for_ready() {
  local port="$1" _attempt
  for _attempt in $(seq 1 30); do
    if curl -fsS --max-time 3 "http://127.0.0.1:$port/ready" >/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

main() {
  require_root
  require_debian
  validate_service_names
  require_trusted_install
  [ -f "$ENV_FILE" ] || die "No installed environment found at $ENV_FILE. Run scripts/install.sh first."

  [ "$#" -le 1 ] || die 'Usage: configure-firebase.sh [absolute-service-account-json-path]'
  local source_file="${1:-}" supplied_secret_count=0
  [ -n "${FCM_SERVICE_ACCOUNT_JSON_BASE64:-}" ] && supplied_secret_count=$((supplied_secret_count + 1))
  [ -n "${FCM_SERVICE_ACCOUNT_JSON:-}" ] && supplied_secret_count=$((supplied_secret_count + 1))
  [ "$supplied_secret_count" -le 1 ] \
    || die 'Configure only one of FCM_SERVICE_ACCOUNT_JSON_BASE64 or FCM_SERVICE_ACCOUNT_JSON.'
  if [ -n "$source_file" ] && [ "$supplied_secret_count" -ne 0 ]; then
    die 'Provide either a service-account file path or an environment secret, not both.'
  fi
  if [ -z "$source_file" ] && [ "$supplied_secret_count" -eq 0 ]; then
    source_file="$(ask_value 'Absolute path to the Firebase service-account JSON file')"
  fi
  if [ -n "$source_file" ]; then
    [[ "$source_file" == /* ]] || die 'Firebase service-account path must be an absolute Linux path.'
  fi

  local encoded backup rollback_needed=0 port
  encoded="$(encode_firebase_service_account "$source_file")"
  [ -n "$encoded" ] || die 'Firebase service-account encoding failed.'
  backup="$(mktemp "${ENV_FILE}.firebase-backup.XXXXXX")"
  install -o root -g root -m 600 "$ENV_FILE" "$backup"

  on_exit() {
    local status=$?
    trap - EXIT
    if [ "$rollback_needed" -eq 1 ]; then
      install -o root -g root -m 600 "$backup" "$ENV_FILE" || true
      restart_application_service || true
    fi
    rm -f "$backup"
    exit "$status"
  }
  trap on_exit EXIT
  rollback_needed=1

  set_env_value FCM_SERVICE_ACCOUNT_JSON_BASE64 "$encoded" || die 'Could not update the Firebase deployment secret.'
  set_env_value FCM_SERVICE_ACCOUNT_JSON '' || die 'Could not clear the legacy Firebase deployment secret.'
  unset encoded FCM_SERVICE_ACCOUNT_JSON_BASE64 FCM_SERVICE_ACCOUNT_JSON
  restart_application_service \
    || die 'Service restart failed; the previous Firebase configuration was restored.'

  port="$(read_env_value PORT || true)"
  port="${port:-3000}"
  [[ "$port" =~ ^[0-9]+$ ]] || die 'Installed PORT value is invalid; the previous Firebase configuration was restored.'
  wait_for_ready "$port" || die 'Service readiness check failed; the previous Firebase configuration was restored.'

  rollback_needed=0
  echo 'Firebase Admin credential is locally validated, stored, and the application is ready.'
  echo 'Send a test notification from an administrator session to confirm Firebase IAM and outbound network access.'
  echo 'After making an encrypted offline backup, securely remove the source JSON file from the VPS.'
}

main "$@"
