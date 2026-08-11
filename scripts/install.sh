#!/usr/bin/env bash
# Interactive Ubuntu/Debian VPS installer. Download it first, then run it with sudo bash.
set -Eeuo pipefail
umask 077

REPO_URL="${REPO_URL:-https://github.com/yongwei9527-art/IDBS.git}"
BRANCH="${BRANCH:-main}"
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=''
if [ -n "$SCRIPT_SOURCE" ] && [ -f "$SCRIPT_SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
fi
COMMON_HELPER="${SCRIPT_DIR:+$SCRIPT_DIR/../deploy/vps-common.sh}"
TEMP_COMMON_HELPER=''
cleanup_install() {
  [ -z "$TEMP_COMMON_HELPER" ] || rm -f "$TEMP_COMMON_HELPER"
}
trap cleanup_install EXIT
if [ -z "$COMMON_HELPER" ] || [ ! -f "$COMMON_HELPER" ]; then
  TEMP_COMMON_HELPER="$(mktemp)"
  RAW_BASE_URL="${RAW_BASE_URL:-https://raw.githubusercontent.com/yongwei9527-art/IDBS/$BRANCH}"
  curl -fsSL "$RAW_BASE_URL/deploy/vps-common.sh" -o "$TEMP_COMMON_HELPER"
  COMMON_HELPER="$TEMP_COMMON_HELPER"
fi
# shellcheck disable=SC1090
source "$COMMON_HELPER"

DEFAULT_ADMIN_PHONE="${DEFAULT_ADMIN_PHONE:-13900000000}"
DEFAULT_ADMIN_NAME="${DEFAULT_ADMIN_NAME:-System Administrator}"
PENDING_ADMIN_FILE="$APP_BASE/shared/.initial-super-admin-pending"
CURRENT_STEP='startup'

report_install_failure() {
  local status=$?
  trap - ERR
  printf '\n[vps] Installation failed during step: %s\n' "$CURRENT_STEP" >&2
  printf '[vps] The installer is safe to run again; existing database and uploads are preserved.\n' >&2
  printf '[vps] Diagnostics:\n' >&2
  printf '  sudo systemctl status %s --no-pager\n' "$SERVICE_NAME" >&2
  printf '  sudo journalctl -u %s -n 100 --no-pager\n' "$SERVICE_NAME" >&2
  printf '  sudo nginx -t\n' >&2
  exit "$status"
}
trap report_install_failure ERR

read_pending_value() {
  local key="$1"
  [ -f "$PENDING_ADMIN_FILE" ] || return 0
  awk -v key="$key" 'index($0, key "=") == 1 { value = substr($0, length(key) + 2) } END { print value }' "$PENDING_ADMIN_FILE"
}

save_pending_credentials() {
  local phone="$1" name="$2" password="$3" temp
  mkdir -p "$(dirname "$PENDING_ADMIN_FILE")"
  chown root:root "$(dirname "$PENDING_ADMIN_FILE")"
  chmod 700 "$(dirname "$PENDING_ADMIN_FILE")"
  temp="$(mktemp)"
  chmod 600 "$temp"
  {
    printf 'SUPER_ADMIN_PHONE=%s\n' "$phone"
    printf 'SUPER_ADMIN_NAME=%s\n' "$name"
    printf 'SUPER_ADMIN_TEMP_PASSWORD=%s\n' "$password"
  } > "$temp"
  install -o root -g root -m 600 "$temp" "$PENDING_ADMIN_FILE"
  rm -f "$temp"
}

prompt_admin_credentials() {
  admin_phone="$(ask_value 'Highest administrator phone/login' "$DEFAULT_ADMIN_PHONE")"
  validate_phone "$admin_phone"
  admin_name="$(ask_value 'Highest administrator name' "$DEFAULT_ADMIN_NAME")"
  [ -n "$admin_name" ] && [ "${#admin_name}" -le 50 ] \
    && [[ "$admin_name" != *$'\n'* && "$admin_name" != *$'\r'* ]] \
    || die 'Administrator name is required, must be 50 characters or less, and cannot contain a newline.'
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
  [ "${#admin_password}" -ge 12 ] && [ "${#admin_password}" -le 128 ] \
    || die 'Administrator password must be 12-128 characters.'
}

highest_admin_exists() {
  local node_status=0
  [ -n "$(read_env_value DATABASE_URL || true)" ] || return 2
  [ -d "$APP_CURRENT/node_modules/pg" ] || return 2
  ENV_FILE="$ENV_FILE" APP_CURRENT="$APP_CURRENT" node <<'NODE' || node_status=$?
const path = require('node:path');
const current = process.env.APP_CURRENT;
require(path.join(current, 'node_modules/dotenv')).config({
  path: process.env.ENV_FILE,
  quiet: true,
  override: true
});
const { Pool } = require(path.join(current, 'node_modules/pg'));
const { postgresSslOptions } = require(path.join(current, 'src/lib/postgres-ssl'));
const sslMode = String(process.env.PGSSLMODE || '').trim().toLowerCase();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslMode && sslMode !== 'disable' ? postgresSslOptions() : undefined,
  max: 1,
  connectionTimeoutMillis: 10_000
});
(async () => {
  try {
    const result = await pool.query(
      `select 1
       from users u
       left join admin_roles ar on ar.user_id = u.id
       where u.deleted_at is null
         and (u.role = 'super_admin' or ar.role_key = 'super_admin' or ar.permissions ? '*')
       limit 1`
    );
    process.exitCode = result.rowCount > 0 ? 0 : 1;
  } catch {
    process.exitCode = 2;
  } finally {
    await pool.end().catch(() => {});
  }
})();
NODE
  return "$node_status"
}

provision_recovery_admin() {
  local provision_script="$APP_BASE/current/scripts/provision-super-admin.js"
  ENV_FILE="$ENV_FILE" \
    APP_BASE="$APP_BASE" \
    SUPER_ADMIN_PHONE="$admin_phone" \
    SUPER_ADMIN_NAME="$admin_name" \
    SUPER_ADMIN_PASSWORD="$admin_password" \
    node "$provision_script"
}

nginx_domain_uses_https() {
  local domain="$1" candidate configured_domain certificate certificate_key
  for candidate in "/etc/nginx/sites-available/${SERVICE_NAME}.conf" "/etc/nginx/sites-available/${LEGACY_SERVICE_NAME}.conf"; do
    [ -f "$candidate" ] || continue
    configured_domain="$(awk '$1 == "server_name" { gsub(/;/, "", $2); if ($2 != "_") { print $2; exit } }' "$candidate")"
    [ "$configured_domain" = "$domain" ] || continue
    grep -Eq '^[[:space:]]*listen[[:space:]]+443[[:space:]]+ssl;' "$candidate" || continue
    certificate="$(awk '$1 == "ssl_certificate" { gsub(/;/, "", $2); print $2; exit }' "$candidate")"
    certificate_key="$(awk '$1 == "ssl_certificate_key" { gsub(/;/, "", $2); print $2; exit }' "$candidate")"
    letsencrypt_paths_match_domain "$domain" "$certificate" "$certificate_key" || continue
    return 0
  done
  return 1
}

record_install_info() {
  local app_server_address="${origin%/}" web_access_url="${origin%/}/v5/"
  [ -x /usr/local/bin/db ] || die 'VPS db management command was not installed.'
  if [ "$is_new_install" = '1' ]; then
    printf '%s\n%s\n%s\n%s\n%s\n' \
      "$app_server_address" "$web_access_url" "$admin_phone" "$admin_name" "$admin_password" \
      | /usr/local/bin/db --record
    rm -f "$PENDING_ADMIN_FILE"
  else
    printf '%s\n%s\n' "$app_server_address" "$web_access_url" \
      | /usr/local/bin/db --record-addresses
  fi
}

configure_default_apk_download_url() {
  local previous_origin="${1:-}" current_url managed_mode apk_url=''
  current_url="$(read_env_value APK_DOWNLOAD_URL || true)"
  managed_mode="$(read_env_value APK_DOWNLOAD_URL_MANAGED || true)"

  if [ "$managed_mode" = 'self_hosted' ]; then
    apk_url="${origin%/}/download/app.apk"
    if [ ! -f "$APP_CURRENT/public/download/app.apk" ]; then
      echo "WARNING: self-hosted APK mode is enabled, but $APP_CURRENT/public/download/app.apk does not exist." >&2
    fi
  elif [ "$managed_mode" = 'github_release' ]; then
    apk_url="$(github_release_apk_url "$SRC_DIR" || true)"
  elif [ -n "$current_url" ]; then
    if [ -n "$previous_origin" ] \
      && [ "$current_url" = "${previous_origin%/}/download/app.apk" ]; then
      apk_url="${origin%/}/download/app.apk"
      managed_mode='self_hosted'
    else
      return 0
    fi
  elif [ -f "$APP_CURRENT/public/download/app.apk" ]; then
    apk_url="${origin%/}/download/app.apk"
    managed_mode='self_hosted'
  else
    apk_url="$(github_release_apk_url "$SRC_DIR" || true)"
    managed_mode='github_release'
  fi

  if [ -n "$apk_url" ]; then
    if [ "$apk_url" != "$current_url" ]; then
      set_env_value APK_DOWNLOAD_URL "$apk_url"
    fi
    set_env_value APK_DOWNLOAD_URL_MANAGED "$managed_mode"
    systemctl restart "$SERVICE_NAME"
    return 0
  fi

  echo 'No APK download URL was configured. Add a signed APK to public/download/app.apk or set APK_DOWNLOAD_URL manually.' >&2
}

fetch_source() {
  if [ -d "$SRC_DIR/.git" ]; then
    if [ -n "$(git -C "$SRC_DIR" status --porcelain)" ]; then
      die "Refusing to overwrite local source changes in $SRC_DIR."
    fi
    git -C "$SRC_DIR" fetch origin --tags
    if git -C "$SRC_DIR" show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
      if git -C "$SRC_DIR" show-ref --verify --quiet "refs/heads/$BRANCH"; then
        git -C "$SRC_DIR" checkout "$BRANCH"
      else
        git -C "$SRC_DIR" checkout -b "$BRANCH" "origin/$BRANCH"
      fi
      git -C "$SRC_DIR" merge --ff-only "origin/$BRANCH"
      [ "$(git -C "$SRC_DIR" rev-parse HEAD)" = "$(git -C "$SRC_DIR" rev-parse "origin/$BRANCH")" ] \
        || die "Local source branch contains unpublished commits: $SRC_DIR ($BRANCH)"
    elif git -C "$SRC_DIR" show-ref --verify --quiet "refs/tags/$BRANCH"; then
      git -C "$SRC_DIR" checkout --detach "refs/tags/$BRANCH"
    else
      die "Git branch or tag not found on origin: $BRANCH"
    fi
  else
    [ ! -e "$SRC_DIR" ] || [ -z "$(find "$SRC_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ] || die "$SRC_DIR is not an empty Git repository directory."
    git clone --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
  fi
}

main() {
  require_root
  require_debian
  validate_systemd_unit_name "$SERVICE_NAME" 'Canonical service name'
  validate_systemd_unit_name "$LEGACY_SERVICE_NAME" 'Legacy service name'
  [[ "$APP_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die 'Application user name is invalid.'
  validate_managed_root "$APP_BASE" 'Application base directory'
  validate_managed_root "$SRC_DIR" 'Source directory'
  validate_disjoint_directories \
    'Application base directory' "$APP_BASE" \
    'Source directory' "$SRC_DIR"
  command -v apt-get >/dev/null || die 'apt-get is required.'

  echo '=== Laboratory Management System VPS installer ==='
  echo 'Existing application data is preserved unless you explicitly remove it.'
  echo "Canonical service name: $SERVICE_NAME (legacy alias: $LEGACY_SERVICE_NAME)"
  CURRENT_STEP='installing base packages'
  apt-get update
  apt-get install -y git curl ca-certificates openssl
  if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi

  local existing_origin='' existing_host='' existing_ip=''
  existing_origin="$(read_env_value APP_PUBLIC_URL || true)"
  if [[ "$existing_origin" =~ ^https?://[^/]+/?$ ]]; then
    existing_host="$(normalize_host "$existing_origin")"
    if is_ipv4 "$existing_host"; then
      existing_ip="$existing_host"
    elif [[ "$existing_host" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
      die "Existing APP_PUBLIC_URL contains an invalid IPv4 address: $existing_host"
    fi
  fi

  local input input_host domain host enable_https=0 tls_email='' server_ip origin cors_origin ip_was_auto_detected=0
  input="$(ask_value 'Domain name or public IPv4 (leave blank to auto-detect the VPS IP)' "$existing_host")"
  input_host="$(normalize_host "$input")"
  if is_ipv4 "$input_host"; then
    existing_ip="$input_host"
    domain=''
  elif [[ "$input_host" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
    die "Invalid IPv4 address: $input_host"
  else
    domain="$input_host"
  fi
  validate_domain "$domain"
  if [ -z "$domain" ]; then
    if [ -n "$existing_ip" ]; then
      server_ip="$existing_ip"
    else
      server_ip="$(detect_public_ip || true)"
      ip_was_auto_detected=1
    fi
    is_ipv4 "$server_ip" \
      || die 'Could not detect a valid IPv4 address. Run the installer again and enter the VPS public IPv4 or a domain name.'
    if is_non_public_ipv4 "$server_ip"; then
      echo "WARNING: $server_ip is not a public IPv4 address. Internet clients cannot use this address." >&2
      if [ "$ip_was_auto_detected" = '1' ]; then
        ask_yes_no 'Only a private/LAN IPv4 was auto-detected. Continue with LAN-only access?' 'N' \
          || die 'A public IPv4 or domain is required for unattended installation. Rerun and enter one explicitly.'
      fi
    fi
  fi
  host="${domain:-$server_ip}"

  if [ "$existing_origin" = "https://$host" ] && [ -n "$domain" ]; then
    origin="$existing_origin"
    enable_https=1
    echo "Existing HTTPS public URL preserved; the Nginx certificate configuration will be verified: $origin"
  else
    if [ -n "$domain" ] && ask_yes_no "Automatically configure Let's Encrypt HTTPS after DNS is ready?" 'Y'; then
      enable_https=1
      tls_email="$(ask_value 'Certificate expiry notification email (optional)' '')"
    fi
    origin="http://$host"
  fi
  cors_origin="https://localhost,${origin}"

  local is_new_install=0 admin_phone='' admin_name='' admin_password='' generated_password='' password_input='' password_confirm=''
  if [ -f "$PENDING_ADMIN_FILE" ]; then
    is_new_install=1
    admin_phone="$(read_pending_value SUPER_ADMIN_PHONE)"
    admin_name="$(read_pending_value SUPER_ADMIN_NAME)"
    admin_password="$(read_pending_value SUPER_ADMIN_TEMP_PASSWORD)"
    validate_phone "$admin_phone"
    [ "${#admin_password}" -ge 12 ] && [ "${#admin_password}" -le 128 ] || die 'Administrator password must be 12-128 characters.'
    echo 'Incomplete installation detected: reusing the protected pending highest-administrator credentials.'
  elif [ ! -f "$APP_BASE/shared/.env" ]; then
    is_new_install=1
    prompt_admin_credentials
    save_pending_credentials "$admin_phone" "$admin_name" "$admin_password"
    echo "Pending administrator credentials saved in a root-only recovery file until installation succeeds."
  else
    echo 'Existing installation detected: the highest administrator account and password will be preserved.'
  fi
  local existing_export_dir existing_upload_dir existing_backup_dir existing_database_dir
  existing_export_dir="$(read_env_value EXPORT_DIR || true)"
  existing_upload_dir="$(read_env_value UPLOAD_DIR || true)"
  existing_backup_dir="$(read_env_value BACKUP_DIR || true)"
  existing_database_dir="$(read_env_value DATABASE_DIR || true)"
  local export_dir upload_dir backup_dir database_dir
  export_dir="$(ask_value 'Export file directory' "${existing_export_dir:-$APP_BASE/exports}")"
  upload_dir="$(ask_value 'Upload file directory' "${existing_upload_dir:-$APP_BASE/uploads}")"
  backup_dir="$(ask_value 'Backup directory' "${existing_backup_dir:-$APP_BASE/backups}")"
  database_dir="$(ask_value 'Database operations directory (not PostgreSQL PGDATA)' "${existing_database_dir:-$APP_BASE/database}")"
  export_dir="$(canonicalize_absolute_dir "$export_dir" 'Export directory')"
  upload_dir="$(canonicalize_absolute_dir "$upload_dir" 'Upload directory')"
  backup_dir="$(canonicalize_absolute_dir "$backup_dir" 'Backup directory')"
  database_dir="$(canonicalize_absolute_dir "$database_dir" 'Database operations directory')"
  validate_absolute_dir "$export_dir" 'Export directory'
  validate_absolute_dir "$upload_dir" 'Upload directory'
  validate_absolute_dir "$backup_dir" 'Backup directory'
  validate_absolute_dir "$database_dir" 'Database operations directory'
  validate_disjoint_directories \
    'Export directory' "$export_dir" \
    'Upload directory' "$upload_dir" \
    'Backup directory' "$backup_dir" \
    'Database operations directory' "$database_dir"

  local firebase_service_account_file='' firebase_service_account_base64=''
  if ask_yes_no 'Configure Firebase Android push notifications now?' 'N'; then
    firebase_service_account_file="$(ask_value 'Absolute path to the Firebase service-account JSON file' '')"
    [[ "$firebase_service_account_file" == /* ]] || die 'Firebase service-account path must be an absolute Linux path.'
    firebase_service_account_base64="$(encode_firebase_service_account "$firebase_service_account_file")"
    [ -n "$firebase_service_account_base64" ] || die 'Firebase service-account encoding failed.'
    echo 'Firebase service-account JSON validated. Its contents will not be printed.'
  fi

  CURRENT_STEP='fetching project source'
  fetch_source
  # deploy-ubuntu.sh owns service shutdown, directory preparation, and Nginx replacement.
  # Do not run prepare-vps.sh during a normal install/rerun because it removes the working
  # service and Nginx units before the replacement release has been validated.
  CURRENT_STEP='deploying application, database, systemd, and Nginx'
  local deploy_port
  deploy_port="$(read_env_value PORT || true)"
  deploy_port="${deploy_port:-3000}"
  [[ "$deploy_port" =~ ^[0-9]+$ ]] && [ "$deploy_port" -ge 1 ] && [ "$deploy_port" -le 65535 ] \
    || die 'PORT must be a whole number from 1 to 65535.'
  deploy_env=(
    APP_BASE="$APP_BASE"
    SERVICE_NAME="$SERVICE_NAME"
    LEGACY_SERVICE_NAME="$LEGACY_SERVICE_NAME"
    HOST="127.0.0.1"
    PORT="$deploy_port"
    DOMAIN_NAME="${domain:-_}"
    ENABLE_HTTPS="$enable_https"
    CORS_ORIGIN="$cors_origin"
    UPLOAD_DIR="$upload_dir"
    EXPORT_DIR="$export_dir"
    BACKUP_DIR="$backup_dir"
    DATABASE_DIR="$database_dir"
  )
  if [ "$is_new_install" = '1' ]; then
    deploy_env+=(INITIAL_SUPER_ADMIN_PHONE="$admin_phone" INITIAL_SUPER_ADMIN_NAME="$admin_name" INITIAL_SUPER_ADMIN_PASSWORD="$admin_password")
  fi
  env "${deploy_env[@]}" bash "$SRC_DIR/scripts/deploy-ubuntu.sh"

  CURRENT_STEP='finalizing persistent directories and environment'
  ENV_FILE="$APP_BASE/shared/.env"
  ensure_directory "$export_dir" "$APP_USER:$APP_USER" 750
  # Nginx serves non-export uploads directly; exports remain application-only.
  ensure_directory "$upload_dir" "$APP_USER:$APP_USER" 755
  ensure_directory "$backup_dir" root:root 750
  # PostgreSQL is provisioned by the existing deployment script. This directory is retained for DB operational artifacts.
  ensure_directory "$database_dir" postgres:postgres 700
  set_env_value UPLOAD_DIR "$upload_dir"
  set_env_value EXPORT_DIR "$export_dir"
  set_env_value BACKUP_DIR "$backup_dir"
  set_env_value DATABASE_DIR "$database_dir"
  if [ -z "$(read_env_value EXPORT_RETENTION_DAYS || true)" ]; then
    set_env_value EXPORT_RETENTION_DAYS "30"
  fi
  set_env_value APP_PUBLIC_URL "$origin"
  set_env_value CORS_ORIGIN "$cors_origin"
  if [ -z "$(read_env_value APP_PAIRING_SECRET || true)" ]; then
    set_env_value APP_PAIRING_SECRET "$(generate_secret)"
  fi
  if [ -z "$(read_env_value APP_PAIRING_TTL_MINUTES || true)" ]; then
    set_env_value APP_PAIRING_TTL_MINUTES "10"
  fi
  if [ -n "$firebase_service_account_base64" ]; then
    set_env_value FCM_SERVICE_ACCOUNT_JSON_BASE64 "$firebase_service_account_base64"
    set_env_value FCM_SERVICE_ACCOUNT_JSON ""
  fi
  systemctl restart "$SERVICE_NAME"

  local admin_probe_status=0
  if highest_admin_exists; then
    admin_probe_status=0
  else
    admin_probe_status=$?
  fi
  if [ "$admin_probe_status" = '1' ]; then
    echo 'No highest administrator exists in the database; recovering the incomplete installation.'
    if [ -z "$admin_phone" ] || [ -z "$admin_password" ]; then
      is_new_install=1
      prompt_admin_credentials
      save_pending_credentials "$admin_phone" "$admin_name" "$admin_password"
    fi
    CURRENT_STEP='provisioning recovery highest administrator'
    provision_recovery_admin
  elif [ "$admin_probe_status" != '0' ]; then
    die 'Could not verify the highest administrator account. Check DATABASE_URL, PostgreSQL connectivity, and users-table permissions before retrying.'
  fi

  if [ "$enable_https" = '1' ]; then
    apt-get install -y certbot python3-certbot-nginx
    certbot_args=(--nginx --non-interactive --agree-tos -d "$domain")
    if [ -n "$tls_email" ]; then certbot_args+=(--email "$tls_email"); else certbot_args+=(--register-unsafely-without-email); fi
    certbot_succeeded=0
    if certbot "${certbot_args[@]}"; then
      certbot_succeeded=1
    fi
    if nginx_domain_uses_https "$domain"; then
      origin="https://$domain"
      set_env_value APP_PUBLIC_URL "$origin"
      set_env_value CORS_ORIGIN "https://localhost,$origin"
      systemctl restart "$SERVICE_NAME"
      if [ "$certbot_succeeded" != '1' ]; then
        echo 'Certbot returned an error, but Nginx is currently using a readable matching certificate. Check certificate expiry and Certbot logs.' >&2
      fi
    else
      origin="http://$host"
      set_env_value APP_PUBLIC_URL "$origin"
      set_env_value CORS_ORIGIN "https://localhost,$origin"
      systemctl restart "$SERVICE_NAME"
      echo 'HTTPS is not active in the installed Nginx site. The service remains available over HTTP; verify DNS and Certbot logs, then retry certificate setup.' >&2
    fi
  fi

  CURRENT_STEP='configuring Android APK download'
  configure_default_apk_download_url "$existing_origin"

  CURRENT_STEP='final readiness verification'
  local ready_port
  ready_port="$(read_env_value PORT || true)"
  ready_port="${ready_port:-3000}"
  curl -fsS "http://127.0.0.1:${ready_port}/ready" >/dev/null
  CURRENT_STEP='recording root-only installation information'
  record_install_info
  echo
  echo '=== Installation complete ==='
  printf 'Service name: %s\n' "$SERVICE_NAME"
  printf 'System URL: %s/v5/\n' "${origin%/}"
  printf 'Admin URL:  %s/v5/admin\n' "${origin%/}"
  printf 'Download URL: %s/download\n' "${origin%/}"
  printf 'Android APK: %s\n' "$(read_env_value APK_DOWNLOAD_URL || true)"
  if [ "$is_new_install" = '1' ]; then
    printf 'Highest administrator login: %s\n' "$admin_phone"
    if { printf 'Highest administrator password: %s\n' "$admin_password" >/dev/tty; } 2>/dev/null; then
      echo 'The password is shown only on the interactive terminal. Change it immediately after first login.'
    else
      echo 'No interactive terminal is available, so the temporary password was not printed. Run "sudo db" and choose menu item 1 to view it.'
    fi
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
  CURRENT_STEP='complete'
}

main "$@"
