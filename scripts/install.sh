#!/usr/bin/env bash
# Interactive Ubuntu/Debian VPS installer. Run: curl .../scripts/install.sh | sudo bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/yongwei9527-art/IDBS.git}"
BRANCH="${BRANCH:-main}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_HELPER="$SCRIPT_DIR/../deploy/vps-common.sh"
TEMP_COMMON_HELPER=''
if [ ! -f "$COMMON_HELPER" ]; then
  TEMP_COMMON_HELPER="$(mktemp)"
  trap 'rm -f "$TEMP_COMMON_HELPER"' EXIT
  RAW_BASE_URL="${RAW_BASE_URL:-https://raw.githubusercontent.com/yongwei9527-art/IDBS/$BRANCH}"
  curl -fsSL "$RAW_BASE_URL/deploy/vps-common.sh" -o "$TEMP_COMMON_HELPER"
  COMMON_HELPER="$TEMP_COMMON_HELPER"
fi
# shellcheck disable=SC1090
source "$COMMON_HELPER"

DEFAULT_ADMIN_PHONE="${DEFAULT_ADMIN_PHONE:-13900000000}"
DEFAULT_ADMIN_NAME="${DEFAULT_ADMIN_NAME:-System Administrator}"

fetch_source() {
  if [ -d "$SRC_DIR/.git" ]; then
    if [ -n "$(git -C "$SRC_DIR" status --porcelain)" ]; then
      die "Refusing to overwrite local source changes in $SRC_DIR."
    fi
    git -C "$SRC_DIR" fetch origin "$BRANCH" --tags
    git -C "$SRC_DIR" checkout "$BRANCH"
    git -C "$SRC_DIR" pull --ff-only origin "$BRANCH"
  else
    [ ! -e "$SRC_DIR" ] || [ -z "$(find "$SRC_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ] || die "$SRC_DIR is not an empty Git repository directory."
    git clone --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
  fi
}

main() {
  require_root
  require_debian
  command -v apt-get >/dev/null || die 'apt-get is required.'

  echo '=== Laboratory Management System VPS installer ==='
  echo 'Existing application data is preserved unless you explicitly remove it.'
  apt-get update
  apt-get install -y git curl ca-certificates openssl
  if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi

  local input domain host enable_https=0 tls_email server_ip origin cors_origin
  input="$(ask_value 'Domain name (leave blank to use the VPS public IP)' '')"
  domain="$(normalize_host "$input")"
  validate_domain "$domain"
  server_ip="$(detect_public_ip)"
  host="${domain:-$server_ip}"
  [ -n "$host" ] || die 'Could not detect a public IP. Enter a domain name and run again.'

  if [ -n "$domain" ] && ask_yes_no 'Automatically configure Let\x27s Encrypt HTTPS after DNS is ready?' 'Y'; then
    enable_https=1
    tls_email="$(ask_value 'Certificate expiry notification email (optional)' '')"
  fi
  origin="http://$host"
  cors_origin="https://localhost,${origin}"

  local is_new_install=0 admin_phone='' admin_name='' admin_password='' generated_password password_input password_confirm
  if [ ! -f "$APP_BASE/shared/.env" ]; then
    is_new_install=1
    admin_phone="$(ask_value 'Highest administrator phone/login' "$DEFAULT_ADMIN_PHONE")"
    validate_phone "$admin_phone"
    admin_name="$(ask_value 'Highest administrator name' "$DEFAULT_ADMIN_NAME")"
    [ -n "$admin_name" ] && [ "${#admin_name}" -le 50 ] || die 'Administrator name is required and must be 50 characters or less.'
    generated_password="$(generate_password)"
    read -r -s -p 'Highest administrator password (leave blank to generate one): ' password_input </dev/tty || true
    echo
    if [ -n "$password_input" ]; then
      read -r -s -p 'Confirm highest administrator password: ' password_confirm </dev/tty || true
      echo
      [ "$password_input" = "$password_confirm" ] || die 'Passwords do not match.'
      admin_password="$password_input"
    else
      admin_password="$generated_password"
    fi
    [ "${#admin_password}" -ge 12 ] && [ "${#admin_password}" -le 128 ] || die 'Administrator password must be 12-128 characters.'
  else
    echo 'Existing installation detected: the highest administrator account and password will be preserved.'
  fi
  local export_dir upload_dir backup_dir database_dir
  export_dir="$(ask_value 'Export file directory' "$APP_BASE/exports")"
  upload_dir="$(ask_value 'Upload file directory' "$APP_BASE/uploads")"
  backup_dir="$(ask_value 'Backup directory' "$APP_BASE/backups")"
  database_dir="$(ask_value 'Database data/operations directory' "$APP_BASE/database")"
  validate_absolute_dir "$export_dir" 'Export directory'
  validate_absolute_dir "$upload_dir" 'Upload directory'
  validate_absolute_dir "$backup_dir" 'Backup directory'
  validate_absolute_dir "$database_dir" 'Database directory'

  local firebase_service_account_file='' firebase_service_account_base64=''
  if ask_yes_no 'Configure Firebase Android push notifications now?' 'N'; then
    firebase_service_account_file="$(ask_value 'Absolute path to the Firebase service-account JSON file' '')"
    [[ "$firebase_service_account_file" == /* ]] || die 'Firebase service-account path must be an absolute Linux path.'
    firebase_service_account_base64="$(encode_firebase_service_account "$firebase_service_account_file")"
    [ -n "$firebase_service_account_base64" ] || die 'Firebase service-account encoding failed.'
    echo 'Firebase service-account JSON validated. Its contents will not be printed.'
  fi

  fetch_source
  APP_BASE="$APP_BASE" SRC_DIR="$SRC_DIR" RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA=0 bash "$SRC_DIR/scripts/prepare-vps.sh"
  deploy_env=(APP_BASE="$APP_BASE" DOMAIN_NAME="${domain:-_}" CORS_ORIGIN="$cors_origin")
  if [ "$is_new_install" = '1' ]; then
    deploy_env+=(INITIAL_SUPER_ADMIN_PHONE="$admin_phone" INITIAL_SUPER_ADMIN_NAME="$admin_name" INITIAL_SUPER_ADMIN_PASSWORD="$admin_password")
  fi
  env "${deploy_env[@]}" bash "$SRC_DIR/scripts/deploy-ubuntu.sh"

  ENV_FILE="$APP_BASE/shared/.env"
  ensure_directory "$export_dir" "$APP_USER:$APP_USER" 750
  ensure_directory "$upload_dir" "$APP_USER:$APP_USER" 750
  ensure_directory "$backup_dir" root:root 750
  # PostgreSQL is provisioned by the existing deployment script. This directory is retained for DB operational artifacts.
  ensure_directory "$database_dir" postgres:postgres 700
  set_env_value UPLOAD_DIR "$upload_dir"
  set_env_value EXPORT_DIR "$export_dir"
  set_env_value BACKUP_DIR "$backup_dir"
  set_env_value DATABASE_DIR "$database_dir"
  set_env_value APP_PUBLIC_URL "$origin"
  set_env_value CORS_ORIGIN "$cors_origin"
  set_env_value APP_PAIRING_SECRET "$(generate_secret)"
  set_env_value APP_PAIRING_TTL_MINUTES "10"
  if [ -n "$firebase_service_account_base64" ]; then
    set_env_value FCM_SERVICE_ACCOUNT_JSON_BASE64 "$firebase_service_account_base64"
    set_env_value FCM_SERVICE_ACCOUNT_JSON ""
  fi
  systemctl restart "$APP_NAME"

  if [ "$enable_https" = '1' ]; then
    apt-get install -y certbot python3-certbot-nginx
    certbot_args=(--nginx --non-interactive --agree-tos -d "$domain")
    if [ -n "$tls_email" ]; then certbot_args+=(--email "$tls_email"); else certbot_args+=(--register-unsafely-without-email); fi
    if certbot "${certbot_args[@]}"; then
      origin="https://$domain"
      set_env_value APP_PUBLIC_URL "$origin"
      set_env_value CORS_ORIGIN "https://localhost,$origin"
      systemctl restart "$APP_NAME"
    else
      echo 'HTTPS configuration did not complete. The service remains available over HTTP; verify DNS then run certbot manually.' >&2
    fi
  fi

  curl -fsS "http://127.0.0.1:$(read_env_value PORT || true)/ready" >/dev/null || curl -fsS 'http://127.0.0.1:3000/ready' >/dev/null
  echo
  echo '=== Installation complete ==='
  printf 'System URL: %s/v5/\n' "${origin%/}"
  printf 'Admin URL:  %s/v5/admin\n' "${origin%/}"
  printf 'Download URL: %s/download\n' "${origin%/}"
  if [ "$is_new_install" = '1' ]; then
    printf 'Highest administrator login: %s\n' "$admin_phone"
    printf 'Highest administrator password: %s\n' "$admin_password" >/dev/tty
    echo 'The password is shown only on the interactive terminal. Change it immediately after first login.'
  else
    echo 'Highest administrator credentials were preserved.'
  fi
  if [ -n "$firebase_service_account_base64" ]; then
    echo 'Firebase Android push notifications: configured.'
    echo 'After making an encrypted offline backup, securely remove the uploaded source JSON file from the VPS.'
  else
    echo 'Firebase Android push notifications: unchanged. Configure later with /usr/local/sbin/laboratory-management-system-configure-firebase.'
  fi
  echo 'Deployment secrets are stored in the root-readable environment file and are not printed by this script; protect terminal session logs during installation.'
}

main "$@"
