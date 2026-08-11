#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR"
# shellcheck disable=SC1091
source "$ROOT_DIR/deploy/vps-common.sh"
SERVICE_NAME="${SERVICE_NAME:-laboratory-management-system}"
LEGACY_SERVICE_NAME="${LEGACY_SERVICE_NAME:-laboratory_management_system}"
APP_USER="${APP_USER:-laboratory_management_system}"
APP_GROUP="${APP_GROUP:-$APP_USER}"
APP_BASE="${APP_BASE:-/var/www/laboratory-management-system}"
APP_CURRENT="$APP_BASE/current"
APP_PREVIOUS="$APP_BASE/previous"
APP_RELEASES="$APP_BASE/releases"
APP_SHARED="$APP_BASE/shared"
APP_DOWNLOADS="$APP_BASE/downloads"
APP_UPLOADS=''
APP_EXPORTS=''
APP_BACKUPS=''
APP_DATABASE_OPS=''
ENV_FILE="$APP_SHARED/.env"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
BACKUP_SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}-backup.service"
BACKUP_TIMER_FILE="/etc/systemd/system/${SERVICE_NAME}-backup.timer"
NGINX_FILE="/etc/nginx/sites-available/${SERVICE_NAME}.conf"
NGINX_LINK="/etc/nginx/sites-enabled/${SERVICE_NAME}.conf"
ADMIN_RESET_COMMAND="/usr/local/bin/${SERVICE_NAME}-reset-admin-password"
LEGACY_ADMIN_RESET_COMMAND="/usr/local/bin/${LEGACY_SERVICE_NAME}-reset-admin-password"
UPDATE_COMMAND="/usr/local/bin/laboratory-management-system-update"
LEGACY_UPDATE_COMMAND="/usr/local/bin/${LEGACY_SERVICE_NAME}-update"
DB_COMMAND="/usr/local/bin/db"
FIREBASE_CONFIG_COMMAND="/usr/local/sbin/laboratory-management-system-configure-firebase"
INSTALL_INFO_FILE="$APP_SHARED/install-info"
INSTALL_OWNER_FILE="$APP_SHARED/installation-owner"
PENDING_ADMIN_FILE="$APP_SHARED/.initial-super-admin-pending"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3000}"
DOMAIN_NAME="${DOMAIN_NAME:-_}"
ENABLE_HTTPS="${ENABLE_HTTPS:-auto}"
RELEASE_RETENTION_COUNT_INPUT="${RELEASE_RETENTION_COUNT:-}"
RELEASE_RETENTION_COUNT=''
RELEASE_ID="${RELEASE_ID:-}"
PRE_MIGRATION_BACKUP_DIR="${PRE_MIGRATION_BACKUP_DIR:-}"
ENV_CREATED=0
ADMIN_PASSWORD_ROTATED=0
CANDIDATE_RELEASE=''
ROLLBACK_RELEASE=''
declare -a OLD_ACTIVE_SERVICE_UNITS=()
SERVICE_INTERRUPTED=0
MIGRATION_ATTEMPTED=0
RELEASE_SWITCHED=0
DEPLOYMENT_COMPLETE=0

log() { printf '\n[%s] %s\n' "${SERVICE_NAME}" "$*"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "Missing command: $1"
    exit 1
  }
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    log "Run this script as root (or with sudo)."
    exit 1
  fi
}

install_packages() {
  local postgres_major=''
  export DEBIAN_FRONTEND=noninteractive
  safe_apt_update -y
  apt-get install -y curl ca-certificates gnupg nginx openssl postgresql postgresql-client rsync sudo util-linux
  if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]; then
    curl -4fL --show-error --connect-timeout 15 --max-time 180 --retry 3 \
      https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
  postgres_major="$(psql --version 2>/dev/null | grep -oE '[0-9]+' | head -n 1 || true)"
  if [ -n "$postgres_major" ] && [ "$postgres_major" -lt 15 ]; then
    log "警告：当前 PostgreSQL ${postgres_major} 已不适合作为新的长期生产环境。此次安装会继续以便恢复服务，但请尽快升级到受支持的 PostgreSQL 15+ 和受支持的操作系统。"
  fi
}

resolve_persistent_directories() {
  local existing_uploads='' existing_exports='' existing_backups='' existing_database_ops=''
  validate_systemd_unit_name "$SERVICE_NAME" 'Canonical service name'
  validate_systemd_unit_name "$LEGACY_SERVICE_NAME" 'Legacy service name'
  [ "$DOMAIN_NAME" = '_' ] || validate_domain "$DOMAIN_NAME"
  [ "$HOST" = '127.0.0.1' ] || die 'HOST must be 127.0.0.1 for the Nginx-backed VPS deployment.'
  [[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] \
    || die 'PORT must be a whole number from 1 to 65535.'
  case "$ENABLE_HTTPS" in 0|1|auto) ;; *) die 'ENABLE_HTTPS must be 0, 1, or auto.' ;; esac
  [[ "$APP_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die 'Application user name is invalid.'
  [[ "$APP_GROUP" =~ ^[a-z_][a-z0-9_-]*$ ]] || die 'Application group name is invalid.'
  validate_managed_root "$APP_BASE" 'Application base directory'
  validate_managed_root "$ROOT_DIR" 'Deployment source directory'
  validate_disjoint_directories \
    'Application base directory' "$APP_BASE" \
    'Deployment source directory' "$ROOT_DIR"

  if [ -f "$ENV_FILE" ]; then
    existing_uploads="$(read_env_value UPLOAD_DIR || true)"
    existing_exports="$(read_env_value EXPORT_DIR || true)"
    existing_backups="$(read_env_value BACKUP_DIR || true)"
    existing_database_ops="$(read_env_value DATABASE_DIR || true)"
  fi
  APP_UPLOADS="$(canonicalize_absolute_dir "${UPLOAD_DIR:-${existing_uploads:-$APP_BASE/uploads}}" 'Upload directory')"
  APP_EXPORTS="$(canonicalize_absolute_dir "${EXPORT_DIR:-${existing_exports:-$APP_BASE/exports}}" 'Export directory')"
  APP_BACKUPS="$(canonicalize_absolute_dir "${BACKUP_DIR:-${existing_backups:-$APP_BASE/backups}}" 'Backup directory')"
  APP_DATABASE_OPS="$(canonicalize_absolute_dir "${DATABASE_DIR:-${existing_database_ops:-$APP_BASE/database}}" 'Database operations directory')"
  validate_absolute_dir "$APP_UPLOADS" 'Upload directory'
  validate_absolute_dir "$APP_EXPORTS" 'Export directory'
  validate_absolute_dir "$APP_BACKUPS" 'Backup directory'
  validate_absolute_dir "$APP_DATABASE_OPS" 'Database operations directory'
  validate_disjoint_directories \
    'Upload directory' "$APP_UPLOADS" \
    'Export directory' "$APP_EXPORTS" \
    'Backup directory' "$APP_BACKUPS" \
    'Database operations directory' "$APP_DATABASE_OPS"
}

ensure_user() {
  if ! getent group "$APP_GROUP" >/dev/null 2>&1; then
    groupadd --system "$APP_GROUP"
  fi
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --create-home --shell /usr/sbin/nologin --gid "$APP_GROUP" "$APP_USER"
  fi
  mkdir -p -- "$APP_BASE" "$APP_RELEASES" "$APP_SHARED" "$APP_DOWNLOADS" "$APP_UPLOADS" "$APP_EXPORTS" "$APP_BACKUPS" "$APP_DATABASE_OPS"
  chown root:root "$APP_BASE" "$APP_SHARED"
  chmod 755 "$APP_BASE"
  chown root:root "$APP_RELEASES"
  chmod 755 "$APP_RELEASES"
  chown root:"$APP_GROUP" "$APP_DOWNLOADS"
  chmod 755 "$APP_DOWNLOADS"
  if [ ! -e "$APP_DOWNLOADS/app.apk" ] \
    && [ -f "$APP_CURRENT/public/download/app.apk" ] \
    && [ ! -L "$APP_CURRENT/public/download/app.apk" ]; then
    log 'Migrating the existing self-hosted APK into the persistent downloads directory.'
    install -o root -g "$APP_GROUP" -m 0644 \
      "$APP_CURRENT/public/download/app.apk" "$APP_DOWNLOADS/app.apk"
  fi
  chmod 700 "$APP_SHARED"
  chown -R -- "$APP_USER:$APP_GROUP" "$APP_UPLOADS" "$APP_EXPORTS"
  # Nginx serves non-export uploads directly; exports remain application-only.
  chmod 755 "$APP_UPLOADS"
  chmod 750 "$APP_EXPORTS"
  chown -R -- root:root "$APP_BACKUPS"
  chmod 750 "$APP_BACKUPS"
  chown -R -- postgres:postgres "$APP_DATABASE_OPS"
  chmod 700 "$APP_DATABASE_OPS"
  for root_only_file in "$INSTALL_INFO_FILE" "$PENDING_ADMIN_FILE"; do
    if [ -f "$root_only_file" ]; then
      chown root:root "$root_only_file"
      chmod 600 "$root_only_file"
    fi
  done
}

write_installation_owner_marker() {
  local marker_temp resolved_app_base resolved_source_dir
  resolved_app_base="$(readlink -m -- "$APP_BASE")"
  resolved_source_dir="$(readlink -m -- "$ROOT_DIR")"
  marker_temp="$(mktemp)"
  chmod 600 "$marker_temp"
  {
    printf 'MARKER_VERSION=1\n'
    printf 'APP_BASE=%s\n' "$resolved_app_base"
    printf 'SRC_DIR=%s\n' "$resolved_source_dir"
    printf 'SERVICE_NAME=%s\n' "$SERVICE_NAME"
  } > "$marker_temp"
  install -o root -g root -m 600 "$marker_temp" "$INSTALL_OWNER_FILE"
  rm -f -- "$marker_temp"
}

prepare_candidate_release() {
  local git_revision timestamp
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  git_revision="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD 2>/dev/null || printf 'source')"
  if [ -z "$RELEASE_ID" ]; then
    RELEASE_ID="${timestamp}-${git_revision}"
  fi
  validate_release_id "$RELEASE_ID"
  CANDIDATE_RELEASE="$APP_RELEASES/$RELEASE_ID"
  release_path_is_managed "$CANDIDATE_RELEASE" "$APP_RELEASES" \
    || die 'Candidate release escaped the managed releases directory.'
  [ ! -e "$CANDIDATE_RELEASE" ] && [ ! -L "$CANDIDATE_RELEASE" ] \
    || die "Candidate release already exists: $CANDIDATE_RELEASE"
  mkdir -p -- "$CANDIDATE_RELEASE"
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'uploads' \
    --exclude '.env' \
    --exclude 'public/download/' \
    "$ROOT_DIR/" "$CANDIDATE_RELEASE/"
  mkdir -p -- "$CANDIDATE_RELEASE/public"
  rm -rf -- "$CANDIDATE_RELEASE/public/download"
  ln -s -- "$APP_DOWNLOADS" "$CANDIDATE_RELEASE/public/download"
  printf '%s\n' "$RELEASE_ID" > "$CANDIDATE_RELEASE/.release-id"
  # Release code is immutable to the runtime account. Root-run management commands
  # must never execute shell scripts writable by the application process.
  chown -R root:root "$CANDIDATE_RELEASE"
  chmod -R go-w "$CANDIDATE_RELEASE"
}

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    DB_PASSWORD="$(openssl rand -hex 16)"
    ADMIN_PASSWORD="$(printf 'LABORATORY_MANAGEMENT_SYSTEM_%s' "$(openssl rand -hex 6)")"
    DEFAULT_ORIGIN="${CORS_ORIGIN:-$(detect_default_origin)}"
    cat > "$ENV_FILE" <<EOF
NODE_ENV=production
HOST=$HOST
PORT=$PORT
ADMIN_PASSWORD=${ADMIN_PASSWORD}
TOKEN_SECRET=$(openssl rand -hex 32)
WECHAT_TOKEN=
WECHAT_APP_ID=
WECHAT_APP_SECRET=
WECHAT_ADMIN_OPENIDS=
UPLOAD_DIR=$APP_UPLOADS
EXPORT_DIR=$APP_EXPORTS
EXPORT_RETENTION_DAYS=30
BACKUP_DIR=$APP_BACKUPS
BACKUP_RETENTION_DAYS=14
RELEASE_RETENTION_COUNT=5
DATABASE_DIR=$APP_DATABASE_OPS
DATABASE_URL=postgresql://laboratory_management_system_user:${DB_PASSWORD}@127.0.0.1:5432/laboratory_management_system
PGSSL=false
PGSSL_REJECT_UNAUTHORIZED=true
PGSSL_CA=
CORS_ORIGIN=${DEFAULT_ORIGIN}
TRUST_PROXY=true
AUTH_RATE_LIMIT_MAX=10
AUTH_RATE_LIMIT_WINDOW_MS=600000
API_RATE_LIMIT_MAX=120
API_RATE_LIMIT_WINDOW_MS=60000
EOF
    ENV_CREATED=1
  fi
  repair_env_placeholders
  if [ -n "${CORS_ORIGIN:-}" ]; then
    set_env_value CORS_ORIGIN "$CORS_ORIGIN"
  fi
  set_env_value HOST "$HOST"
  set_env_value PORT "$PORT"
  set_env_value UPLOAD_DIR "$APP_UPLOADS"
  set_env_value EXPORT_DIR "$APP_EXPORTS"
  set_env_value BACKUP_DIR "$APP_BACKUPS"
  set_env_value DATABASE_DIR "$APP_DATABASE_OPS"
  chown root:root "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

repair_env_placeholders() {
  local current_admin current_secret current_cors current_db current_node_env current_trust_proxy
  local current_export_retention current_backup_retention
  current_admin="$(get_env_value ADMIN_PASSWORD || true)"
  current_secret="$(get_env_value TOKEN_SECRET || true)"
  current_cors="$(get_env_value CORS_ORIGIN || true)"
  current_db="$(get_env_value DATABASE_URL || true)"
  current_node_env="$(get_env_value NODE_ENV || true)"
  current_trust_proxy="$(get_env_value TRUST_PROXY || true)"
  current_export_retention="$(get_env_value EXPORT_RETENTION_DAYS || true)"
  current_backup_retention="$(get_env_value BACKUP_RETENTION_DAYS || true)"

  if [ -z "$current_admin" ] || [ "$current_admin" = "change-me" ] || [ "$current_admin" = "your-admin-password" ]; then
    set_env_value ADMIN_PASSWORD "LABORATORY_MANAGEMENT_SYSTEM_$(openssl rand -hex 6)"
    ADMIN_PASSWORD_ROTATED=1
  fi

  if [ -z "$current_secret" ] || [ "$current_secret" = "change-me-please" ] || [ "$current_secret" = "your-long-random-secret" ]; then
    set_env_value TOKEN_SECRET "$(openssl rand -hex 32)"
  fi

  if [ -z "$current_cors" ] || [ "$current_cors" = "https://your-domain.com" ]; then
    set_env_value CORS_ORIGIN "${CORS_ORIGIN:-$(detect_default_origin)}"
  fi

  if [ -z "$current_db" ] || printf '%s' "$current_db" | grep -q 'your-password'; then
    set_env_value DATABASE_URL "postgresql://laboratory_management_system_user:$(openssl rand -hex 16)@127.0.0.1:5432/laboratory_management_system"
  fi

  if [ -z "$current_node_env" ]; then
    set_env_value NODE_ENV production
  fi

  if [ -z "$current_trust_proxy" ]; then
    set_env_value TRUST_PROXY true
  fi

  if ! grep -qE '^API_RATE_LIMIT_MAX=' "$ENV_FILE"; then
    set_env_value API_RATE_LIMIT_MAX 120
  fi

  if ! grep -qE '^API_RATE_LIMIT_WINDOW_MS=' "$ENV_FILE"; then
    set_env_value API_RATE_LIMIT_WINDOW_MS 60000
  fi

  if [ -z "$current_export_retention" ]; then
    set_env_value EXPORT_RETENTION_DAYS 30
  elif ! [[ "$current_export_retention" =~ ^[0-9]+$ ]] \
    || [ "$current_export_retention" -lt 1 ] \
    || [ "$current_export_retention" -gt 3650 ]; then
    die 'EXPORT_RETENTION_DAYS must be a whole number from 1 to 3650.'
  fi

  if [ -z "$current_backup_retention" ]; then
    set_env_value BACKUP_RETENTION_DAYS 14
  elif ! [[ "$current_backup_retention" =~ ^[0-9]+$ ]] \
    || [ "$current_backup_retention" -lt 1 ] \
    || [ "$current_backup_retention" -gt 3650 ]; then
    die 'BACKUP_RETENTION_DAYS must be a whole number from 1 to 3650.'
  fi
}

configure_release_retention() {
  local configured
  configured="$(read_env_value RELEASE_RETENTION_COUNT || true)"
  RELEASE_RETENTION_COUNT="${RELEASE_RETENTION_COUNT_INPUT:-${configured:-5}}"
  [[ "$RELEASE_RETENTION_COUNT" =~ ^[0-9]+$ ]] \
    && [ "$RELEASE_RETENTION_COUNT" -ge 2 ] \
    && [ "$RELEASE_RETENTION_COUNT" -le 20 ] \
    || die 'RELEASE_RETENTION_COUNT must be a whole number from 2 to 20.'
  set_env_value RELEASE_RETENTION_COUNT "$RELEASE_RETENTION_COUNT"
}

detect_default_origin() {
  local public_ip
  public_ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  if [ -z "$public_ip" ]; then
    public_ip="$(curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)"
  fi
  if [ -z "$public_ip" ]; then
    public_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  if [ -n "$public_ip" ]; then
    printf 'http://%s' "$public_ip"
  else
    printf 'http://127.0.0.1:%s' "$PORT"
  fi
}

get_env_value() {
  read_env_value "$1"
}

parse_local_database_password() {
  local database_url="$1"
  DATABASE_URL_TO_PARSE="$database_url" node <<'NODE'
const raw = process.env.DATABASE_URL_TO_PARSE || '';
let parsed;
try {
  parsed = new URL(raw);
} catch (_) {
  process.stderr.write('Configured DATABASE_URL is not a valid URL.\n');
  process.exit(2);
}

let username;
let password;
let databaseName;
try {
  username = decodeURIComponent(parsed.username);
  password = decodeURIComponent(parsed.password);
  databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
} catch (_) {
  process.stderr.write('Configured DATABASE_URL contains invalid percent encoding.\n');
  process.exit(2);
}

const isLocalManagedDatabase = (
  (parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:')
  && username === 'laboratory_management_system_user'
  && parsed.hostname === '127.0.0.1'
  && parsed.port === '5432'
  && databaseName === 'laboratory_management_system'
  && !parsed.search
  && !parsed.hash
);
if (!isLocalManagedDatabase) process.exit(3);
if (!password || password.includes('\0') || /[\r\n]/.test(password)) {
  process.stderr.write('The managed local database password is empty or invalid.\n');
  process.exit(2);
}
process.stdout.write(password);
NODE
}

set_local_database_role_password() {
  local operation="$1" password="$2"
  case "$operation" in CREATE|ALTER) ;; *) die 'Invalid local database role operation.' ;; esac
  # Keep the password out of argv and SQL text assembled by the shell. The helper
  # reads it from stdin, quotes it through a PostgreSQL parameter, then executes
  # only the resulting fixed-role CREATE/ALTER statement.
  printf '%s' "$password" \
    | sudo -u postgres node "$CANDIDATE_RELEASE/scripts/set-local-db-role-password.js" "$operation"
}

ensure_local_database() {
  local database_url db_password parse_status
  database_url="$(get_env_value DATABASE_URL)"

  if db_password="$(parse_local_database_password "$database_url")"; then
    :
  else
    parse_status=$?
    if [ "$parse_status" -eq 3 ]; then
      log "Skipping local PostgreSQL setup because DATABASE_URL is not the default local laboratory_management_system database."
      return 0
    fi
    die 'The configured local DATABASE_URL could not be parsed safely.'
  fi

  systemctl enable postgresql
  systemctl start postgresql

  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='laboratory_management_system_user'" | grep -q 1; then
    set_local_database_role_password CREATE "$db_password"
  else
    set_local_database_role_password ALTER "$db_password"
  fi
  db_password=''

  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='laboratory_management_system'" | grep -q 1; then
    sudo -u postgres createdb -O laboratory_management_system_user laboratory_management_system
  fi

  sudo -u postgres psql -d laboratory_management_system -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE laboratory_management_system TO laboratory_management_system_user;"
}

apply_database_schema() {
  local database_url migration_database_url pgssl pgssl_reject pgssl_ca grant_runtime parse_status
  database_url="$(get_env_value DATABASE_URL)"
  migration_database_url="$(get_env_value MIGRATION_DATABASE_URL || true)"
  pgssl="$(get_env_value PGSSL || true)"
  pgssl_reject="$(get_env_value PGSSL_REJECT_UNAUTHORIZED || true)"
  pgssl_ca="$(get_env_value PGSSL_CA || true)"
  grant_runtime=false
  if [ -n "$migration_database_url" ]; then
    grant_runtime=true
  fi

  if parse_local_database_password "$database_url" >/dev/null; then
    if [ -n "$migration_database_url" ]; then
      log 'Applying database baseline/forward migrations with the configured MIGRATION_DATABASE_URL.'
      (
        export DATABASE_URL="$database_url"
        export MIGRATION_DATABASE_URL="$migration_database_url"
        export PGSSL="${pgssl:-false}"
        export PGSSL_REJECT_UNAUTHORIZED="${pgssl_reject:-true}"
        export PGSSL_CA="$pgssl_ca"
        export GRANT_RUNTIME_DATABASE_PRIVILEGES="$grant_runtime"
        node "$CANDIDATE_RELEASE/scripts/migrate-db.js"
      )
    else
      log 'Applying database baseline/forward migrations through the local PostgreSQL owner.'
      sudo -u postgres env \
        DATABASE_URL='postgresql:///laboratory_management_system?host=/var/run/postgresql' \
        PGSSL=false \
        PGSSL_REJECT_UNAUTHORIZED=true \
        PGSSL_CA= \
        GRANT_RUNTIME_DATABASE_PRIVILEGES=false \
        node "$CANDIDATE_RELEASE/scripts/migrate-db.js"
    fi
    return 0
  else
    parse_status=$?
    if [ "$parse_status" -ne 3 ]; then
      die 'The configured local DATABASE_URL could not be parsed safely.'
    fi
  fi

  log 'Applying database baseline/forward migrations to the external PostgreSQL database.'
  (
    export DATABASE_URL="$database_url"
    export MIGRATION_DATABASE_URL="$migration_database_url"
    export PGSSL="${pgssl:-false}"
    export PGSSL_REJECT_UNAUTHORIZED="${pgssl_reject:-true}"
    export PGSSL_CA="$pgssl_ca"
    export GRANT_RUNTIME_DATABASE_PRIVILEGES="$grant_runtime"
    node "$CANDIDATE_RELEASE/scripts/migrate-db.js"
  )
}

finalize_local_database_permissions() {
  local database_url parse_status
  database_url="$(get_env_value DATABASE_URL)"
  if parse_local_database_password "$database_url" >/dev/null; then
    :
  else
    parse_status=$?
    if [ "$parse_status" -eq 3 ]; then
      return 0
    fi
    die 'The configured local DATABASE_URL could not be parsed safely.'
  fi

  sudo -u postgres psql -d laboratory_management_system -v ON_ERROR_STOP=1 -c "ALTER SCHEMA public OWNER TO laboratory_management_system_user;"
  sudo -u postgres psql -d laboratory_management_system -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO laboratory_management_system_user', r.schemaname, r.tablename);
  END LOOP;
  FOR r IN SELECT schemaname, viewname FROM pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER VIEW %I.%I OWNER TO laboratory_management_system_user', r.schemaname, r.viewname);
  END LOOP;
  FOR r IN SELECT sequence_schema, sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO laboratory_management_system_user', r.sequence_schema, r.sequence_name);
  END LOOP;
END $$;
SQL
  sudo -u postgres psql -d laboratory_management_system -v ON_ERROR_STOP=1 -c "GRANT ALL ON SCHEMA public TO laboratory_management_system_user;"
  sudo -u postgres psql -d laboratory_management_system -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO laboratory_management_system_user;"
  sudo -u postgres psql -d laboratory_management_system -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO laboratory_management_system_user;"
  sudo -u postgres psql -d laboratory_management_system -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES FOR ROLE laboratory_management_system_user IN SCHEMA public GRANT ALL ON TABLES TO laboratory_management_system_user;"
  sudo -u postgres psql -d laboratory_management_system -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES FOR ROLE laboratory_management_system_user IN SCHEMA public GRANT ALL ON SEQUENCES TO laboratory_management_system_user;"
}

stop_application_for_migration() {
  local unit
  for unit in "$SERVICE_NAME" "$LEGACY_SERVICE_NAME"; do
    [ -n "$unit" ] || continue
    if systemctl is-active --quiet "${unit}.service"; then
      OLD_ACTIVE_SERVICE_UNITS+=("$unit")
    fi
    if systemctl cat "${unit}.service" >/dev/null 2>&1; then
      log "Stopping ${unit}.service before database migration."
      systemctl stop "${unit}.service"
      SERVICE_INTERRUPTED=1
    fi
  done
}

restart_previously_active_services() {
  local unit
  for unit in "${OLD_ACTIVE_SERVICE_UNITS[@]}"; do
    [ -n "$unit" ] || continue
    systemctl restart "${unit}.service" || true
  done
}

ensure_verified_pre_migration_backup() {
  local backup_dir retention
  # A brand-new installation has no application environment or schema to preserve.
  [ "${EXISTING_INSTALL:-0}" = '1' ] || return 0
  retention="$(read_env_value BACKUP_RETENTION_DAYS || true)"
  retention="${retention:-14}"
  [[ "$retention" =~ ^[0-9]+$ ]] && [ "$retention" -ge 1 ] && [ "$retention" -le 3650 ] \
    || die 'BACKUP_RETENTION_DAYS must be a whole number from 1 to 3650.'

  if [ -n "$PRE_MIGRATION_BACKUP_DIR" ]; then
    backup_dir="$(canonicalize_absolute_dir "$PRE_MIGRATION_BACKUP_DIR" 'Pre-migration backup directory')"
    path_is_same_or_within "$backup_dir" "$APP_BACKUPS" \
      || die 'PRE_MIGRATION_BACKUP_DIR must be inside the configured backup directory.'
    log "Reusing and re-verifying the pre-update database backup in $backup_dir"
  else
    backup_dir="$APP_BACKUPS/pre-deploy-db"
    log 'Creating a verified database backup before migration.'
    ENV_FILE="$ENV_FILE" BACKUP_DIR="$backup_dir" \
      node "$CANDIDATE_RELEASE/scripts/backup-database.js" --dir "$backup_dir" --keep-days "$retention"
  fi
  ENV_FILE="$ENV_FILE" BACKUP_DIR="$backup_dir" \
    node "$CANDIDATE_RELEASE/scripts/backup-database.js" --verify-latest --dir "$backup_dir"
  PRE_MIGRATION_BACKUP_DIR="$backup_dir"
}

activate_candidate_release() {
  local legacy_id legacy_release resolved
  if [ -L "$APP_CURRENT" ]; then
    resolved="$(readlink -f -- "$APP_CURRENT" || true)"
    if [ -n "$resolved" ]; then
      release_path_is_managed "$resolved" "$APP_RELEASES" \
        || die "Current release link points outside $APP_RELEASES: $resolved"
      ROLLBACK_RELEASE="$resolved"
    fi
  elif [ -d "$APP_CURRENT" ]; then
    legacy_id="legacy-$(date -u +%Y%m%dT%H%M%SZ)"
    legacy_release="$APP_RELEASES/$legacy_id"
    [ ! -e "$legacy_release" ] || legacy_release="$APP_RELEASES/${legacy_id}-$$"
    mv -- "$APP_CURRENT" "$legacy_release"
    printf '%s\n' "$(basename "$legacy_release")" > "$legacy_release/.release-id"
    chown -R root:root "$legacy_release"
    chmod -R go-w "$legacy_release"
    ROLLBACK_RELEASE="$legacy_release"
  elif [ -e "$APP_CURRENT" ]; then
    die "$APP_CURRENT must be a directory or symbolic link."
  fi

  if [ -n "$ROLLBACK_RELEASE" ] && [ "$ROLLBACK_RELEASE" != "$CANDIDATE_RELEASE" ]; then
    atomic_symlink_replace "$ROLLBACK_RELEASE" "$APP_PREVIOUS"
  fi
  atomic_symlink_replace "$CANDIDATE_RELEASE" "$APP_CURRENT"
  RELEASE_SWITCHED=1
}

rollback_application_release() {
  [ "$RELEASE_SWITCHED" = '1' ] || return 0
  if [ -z "$ROLLBACK_RELEASE" ]; then
    log 'No previous application release exists; the failed first release remains available for diagnosis.'
    return 0
  fi
  log "Health check failed; switching current back to $ROLLBACK_RELEASE"
  printf '%s\n' "failed $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$CANDIDATE_RELEASE/.failed" || true
  atomic_symlink_replace "$ROLLBACK_RELEASE" "$APP_CURRENT"
  systemctl restart "$SERVICE_NAME" || true
  verify_service_health || true
  log 'Application code was rolled back. Database changes were NOT rolled back automatically.'
  log "Use the verified backup in $PRE_MIGRATION_BACKUP_DIR only through an explicit, reviewed database restore procedure."
}

prune_old_releases() {
  local current_target previous_target candidate protected_count=0 kept_unprotected=0 unprotected_limit
  local -a releases=()
  current_target="$(readlink -f -- "$APP_CURRENT" || true)"
  previous_target="$(readlink -f -- "$APP_PREVIOUS" || true)"
  [ -n "$current_target" ] && protected_count=$((protected_count + 1))
  if [ -n "$previous_target" ] && [ "$previous_target" != "$current_target" ]; then
    protected_count=$((protected_count + 1))
  fi
  unprotected_limit=$((RELEASE_RETENTION_COUNT - protected_count))
  [ "$unprotected_limit" -ge 0 ] || unprotected_limit=0
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    [ -f "$candidate/.release-id" ] || continue
    releases+=("$candidate")
  done < <(find "$APP_RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
  for candidate in "${releases[@]}"; do
    if [ "$candidate" = "$current_target" ] || [ "$candidate" = "$previous_target" ]; then
      continue
    fi
    kept_unprotected=$((kept_unprotected + 1))
    if [ "$kept_unprotected" -gt "$unprotected_limit" ]; then
      release_path_is_managed "$candidate" "$APP_RELEASES" || continue
      rm -rf --one-file-system -- "$candidate"
    fi
  done
}

deployment_exit() {
  local status="$1"
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$DEPLOYMENT_COMPLETE" != '1' ]; then
    if [ "$RELEASE_SWITCHED" = '1' ]; then
      rollback_application_release
    elif [ "$SERVICE_INTERRUPTED" = '1' ] && [ "${#OLD_ACTIVE_SERVICE_UNITS[@]}" -gt 0 ]; then
      restart_previously_active_services
    fi
    if [ "$MIGRATION_ATTEMPTED" = '1' ]; then
      log 'Deployment failed after migration started. Database changes were NOT rolled back automatically.'
      log "Verified pre-migration backup: ${PRE_MIGRATION_BACKUP_DIR:-not available}"
    fi
  fi
  exit "$status"
}

run_doctor_check() {
  log "Running deployment doctor check..."
  ENV_FILE="$ENV_FILE" NODE_ENV=production npm --prefix "$CANDIDATE_RELEASE" run doctor
}

install_service() {
  if [ "$LEGACY_SERVICE_NAME" != "$SERVICE_NAME" ]; then
    systemctl disable --now "$LEGACY_SERVICE_NAME" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/${LEGACY_SERVICE_NAME}.service"
  fi
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Laboratory Management System VPS service
Wants=network-online.target
After=network-online.target postgresql.service
RequiresMountsFor=$APP_CURRENT $APP_SHARED

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_CURRENT
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node $APP_CURRENT/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
UMask=0022
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  if [ "$LEGACY_SERVICE_NAME" != "$SERVICE_NAME" ]; then
    ln -sfn "${SERVICE_NAME}.service" "/etc/systemd/system/${LEGACY_SERVICE_NAME}.service"
  fi
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
}

install_backup_timer() {
  if [ "$LEGACY_SERVICE_NAME" != "$SERVICE_NAME" ]; then
    systemctl disable --now "${LEGACY_SERVICE_NAME}-backup.timer" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/${LEGACY_SERVICE_NAME}-backup.service" \
      "/etc/systemd/system/${LEGACY_SERVICE_NAME}-backup.timer"
  fi
  cat > "$BACKUP_SERVICE_FILE" <<EOF
[Unit]
Description=实验室管理系统 daily database and file backup
After=network.target postgresql.service

[Service]
Type=oneshot
User=root
Group=root
UMask=0077
EnvironmentFile=$ENV_FILE
Environment=APP_BASE=$APP_BASE
Environment=APP_CURRENT=$APP_CURRENT
Environment=ENV_FILE=$ENV_FILE
ExecStart=/bin/bash $APP_CURRENT/scripts/backup.sh
EOF

  cat > "$BACKUP_TIMER_FILE" <<EOF
[Unit]
Description=Run 实验室管理系统 database and file backup once per day

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
Unit=${SERVICE_NAME}-backup.service

[Install]
WantedBy=timers.target
EOF

  if [ "$LEGACY_SERVICE_NAME" != "$SERVICE_NAME" ]; then
    ln -sfn "${SERVICE_NAME}-backup.service" "/etc/systemd/system/${LEGACY_SERVICE_NAME}-backup.service"
    ln -sfn "${SERVICE_NAME}-backup.timer" "/etc/systemd/system/${LEGACY_SERVICE_NAME}-backup.timer"
  fi
  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}-backup.timer"
}

install_admin_reset_command() {
  cat > "$ADMIN_RESET_COMMAND" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

APP_CURRENT="${APP_CURRENT:-/var/www/laboratory-management-system/current}"
ENV_FILE="${ENV_FILE:-/var/www/laboratory-management-system/shared/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "实验室管理系统 environment file not found: $ENV_FILE" >&2
  exit 1
fi

if [ ! -f "$APP_CURRENT/scripts/reset-admin-password.js" ]; then
  echo "实验室管理系统 reset script not found: $APP_CURRENT/scripts/reset-admin-password.js" >&2
  exit 1
fi

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<HELP
Reset 实验室管理系统 admin console password.

Usage:
  sudo laboratory-management-system-reset-admin-password

The password is accepted only through the hidden interactive prompt so it does
not appear in the process list or shell command history.
HELP
  exit 0
fi

if [ "$#" -ne 0 ]; then
  echo "Do not pass a password as a command-line argument. Run the command without arguments." >&2
  exit 2
fi

NEW_PASSWORD=''
while true; do
  read -r -s -p "New admin password (at least 12 chars): " NEW_PASSWORD </dev/tty
  echo
  if [ "${#NEW_PASSWORD}" -lt 12 ]; then
    echo "Password must be at least 12 characters. Please try again." >&2
    continue
  fi
  read -r -s -p "Confirm new admin password: " CONFIRM_PASSWORD </dev/tty
  echo
  if [ "$NEW_PASSWORD" != "$CONFIRM_PASSWORD" ]; then
    echo "Passwords do not match. Please try again." >&2
    continue
  fi
  break
done

cd "$APP_CURRENT"
ENV_FILE="$ENV_FILE" ADMIN_NEW_PASSWORD="$NEW_PASSWORD" node scripts/reset-admin-password.js
echo "Done. Please log in to the admin console with the new password."
EOF
  chmod 755 "$ADMIN_RESET_COMMAND"
  ln -sf "$ADMIN_RESET_COMMAND" "$LEGACY_ADMIN_RESET_COMMAND"
}

install_update_command() {
  local quoted_app_base quoted_src_dir quoted_update_script quoted_service_name quoted_legacy_service_name quoted_app_user quoted_app_group
  printf -v quoted_app_base '%q' "$APP_BASE"
  printf -v quoted_src_dir '%q' "$ROOT_DIR"
  printf -v quoted_update_script '%q' "$APP_CURRENT/scripts/update-vps.sh"
  printf -v quoted_service_name '%q' "$SERVICE_NAME"
  printf -v quoted_legacy_service_name '%q' "$LEGACY_SERVICE_NAME"
  printf -v quoted_app_user '%q' "$APP_USER"
  printf -v quoted_app_group '%q' "$APP_GROUP"
  cat > "$UPDATE_COMMAND" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec env APP_BASE=$quoted_app_base SRC_DIR=$quoted_src_dir SERVICE_NAME=$quoted_service_name LEGACY_SERVICE_NAME=$quoted_legacy_service_name APP_USER=$quoted_app_user APP_GROUP=$quoted_app_group bash $quoted_update_script "\$@"
EOF
  chmod 755 "$UPDATE_COMMAND"
  ln -sf "$UPDATE_COMMAND" "$LEGACY_UPDATE_COMMAND"
}

install_firebase_config_command() {
  install -o root -g root -m 0755 "$ROOT_DIR/scripts/configure-firebase.sh" "$FIREBASE_CONFIG_COMMAND"
}

install_db_panel() {
  local quoted_app_base quoted_app_current quoted_panel_script
  printf -v quoted_app_base '%q' "$APP_BASE"
  printf -v quoted_app_current '%q' "$APP_CURRENT"
  printf -v quoted_panel_script '%q' "$APP_CURRENT/scripts/vps-db-panel.sh"
  cat > "$DB_COMMAND" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec env APP_BASE=$quoted_app_base APP_CURRENT=$quoted_app_current bash $quoted_panel_script "\$@"
EOF
  chmod 755 "$DB_COMMAND"
}

install_nginx() {
  local tls_enabled=0 certificate_dir='' nginx_temp nginx_backup_dir path candidate existing_certificate existing_certificate_key
  local tls_certificate='' tls_certificate_key=''
  local -a affected_paths=(
    "$NGINX_FILE"
    "$NGINX_LINK"
    /etc/nginx/sites-enabled/default
    /etc/nginx/conf.d/default.conf
    "/etc/nginx/sites-enabled/${LEGACY_SERVICE_NAME}.conf"
    "/etc/nginx/sites-available/${LEGACY_SERVICE_NAME}.conf"
    "/etc/nginx/conf.d/${LEGACY_SERVICE_NAME}.conf"
  )

  if [ "$ENABLE_HTTPS" != '0' ] && [ "$DOMAIN_NAME" != '_' ]; then
    for candidate in "$NGINX_FILE" "/etc/nginx/sites-available/${LEGACY_SERVICE_NAME}.conf"; do
      [ -f "$candidate" ] || continue
      existing_certificate="$(awk '$1 == "ssl_certificate" { gsub(/;/, "", $2); print $2; exit }' "$candidate")"
      existing_certificate_key="$(awk '$1 == "ssl_certificate_key" { gsub(/;/, "", $2); print $2; exit }' "$candidate")"
      if letsencrypt_paths_match_domain "$DOMAIN_NAME" "$existing_certificate" "$existing_certificate_key"; then
        tls_certificate="$existing_certificate"
        tls_certificate_key="$existing_certificate_key"
        tls_enabled=1
        break
      fi
    done
    if [ "$tls_enabled" != '1' ]; then
      certificate_dir="$(find_letsencrypt_live_dir "$DOMAIN_NAME" || true)"
      if [ -n "$certificate_dir" ]; then
        tls_certificate="$certificate_dir/fullchain.pem"
        tls_certificate_key="$certificate_dir/privkey.pem"
        tls_enabled=1
      fi
    fi
  fi

  nginx_temp="$(mktemp)"
  nginx_backup_dir="$(mktemp -d)"
  for path in "${affected_paths[@]}"; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      cp -a --parents -- "$path" "$nginx_backup_dir"
    fi
  done

  rm -f -- "${affected_paths[@]}"

  if [ "$tls_enabled" = '1' ]; then
    cat > "$nginx_temp" <<EOF
server {
  listen 80 default_server;
  server_name $DOMAIN_NAME;
  return 301 https://\$host\$request_uri;
}

server {
  listen 443 ssl;
  server_name $DOMAIN_NAME;

  ssl_certificate $tls_certificate;
  ssl_certificate_key $tls_certificate_key;
EOF
  else
    cat > "$nginx_temp" <<EOF
server {
  listen 80 default_server;
  server_name $DOMAIN_NAME;
EOF
  fi

  cat >> "$nginx_temp" <<EOF

  client_max_body_size 20m;

  # Export jobs are downloaded only through authenticated API routes.
  location ^~ /uploads/exports/ {
    return 404;
  }

  location /uploads/ {
    alias $APP_UPLOADS/;
    expires 7d;
    add_header Cache-Control "public, immutable";
  }

  location = /api/v5/ws {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 75s;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF

  chown root:root "$nginx_temp"
  chmod 644 "$nginx_temp"
  mv -f -- "$nginx_temp" "$NGINX_FILE"
  ln -sfn "$NGINX_FILE" "$NGINX_LINK"

  if ! nginx -t; then
    rm -f -- "${affected_paths[@]}"
    if [ -d "$nginx_backup_dir/etc/nginx" ]; then
      cp -a -- "$nginx_backup_dir/etc/nginx/." /etc/nginx/
    fi
    nginx -t || true
    rm -rf -- "$nginx_backup_dir"
    return 1
  fi

  if ! systemctl enable nginx || ! systemctl start nginx || ! systemctl reload nginx; then
    rm -f -- "${affected_paths[@]}"
    if [ -d "$nginx_backup_dir/etc/nginx" ]; then
      cp -a -- "$nginx_backup_dir/etc/nginx/." /etc/nginx/
    fi
    nginx -t || true
    systemctl reload nginx || true
    rm -rf -- "$nginx_backup_dir"
    return 1
  fi
  rm -rf -- "$nginx_backup_dir"
}

build_v3_frontend() {
  if [ ! -f "$CANDIDATE_RELEASE/web/package.json" ]; then
    log "实验室管理系统 5.0 React frontend package not found; skip compatible /v5 build."
    return
  fi

  log "Building 实验室管理系统 5.0 React frontend into public/v5..."
  npm --prefix "$CANDIDATE_RELEASE/web" ci
  npm --prefix "$CANDIDATE_RELEASE/web" run build
  npm --prefix "$CANDIDATE_RELEASE/web" prune --omit=dev
}

provision_initial_super_admin() {
  if [ -z "${INITIAL_SUPER_ADMIN_PHONE:-}" ] || [ -z "${INITIAL_SUPER_ADMIN_PASSWORD:-}" ]; then
    return 0
  fi

  log "Provisioning the highest administrator login account..."
  ENV_FILE="$ENV_FILE" \
    SUPER_ADMIN_PHONE="$INITIAL_SUPER_ADMIN_PHONE" \
    SUPER_ADMIN_NAME="${INITIAL_SUPER_ADMIN_NAME:-系统管理员}" \
    SUPER_ADMIN_PASSWORD="$INITIAL_SUPER_ADMIN_PASSWORD" \
    node "$CANDIDATE_RELEASE/scripts/provision-super-admin.js"
  unset INITIAL_SUPER_ADMIN_PASSWORD SUPER_ADMIN_PASSWORD
}

verify_service_health() {
  local _attempt
  for _attempt in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$PORT/ready" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  journalctl -u "$SERVICE_NAME" -n 80 --no-pager || true
  log "Service readiness check failed."
  return 1
}

main() {
  require_root
  trap 'deployment_exit $?' EXIT
  EXISTING_INSTALL=0
  if [ -f "$ENV_FILE" ]; then
    EXISTING_INSTALL=1
  fi
  install_packages
  need_cmd rsync
  resolve_persistent_directories
  ensure_user
  write_installation_owner_marker
  # Copy and build into an isolated candidate while the current service remains online.
  prepare_candidate_release
  ensure_env
  configure_release_retention
  npm --prefix "$CANDIDATE_RELEASE" ci --omit=dev
  build_v3_frontend
  chown -R root:root "$CANDIDATE_RELEASE"
  chmod -R go-w "$CANDIDATE_RELEASE"
  ensure_local_database
  ensure_verified_pre_migration_backup
  stop_application_for_migration
  MIGRATION_ATTEMPTED=1
  apply_database_schema
  finalize_local_database_permissions
  provision_initial_super_admin
  run_doctor_check
  install_service
  install_backup_timer
  install_admin_reset_command
  install_update_command
  install_firebase_config_command
  install_db_panel
  activate_candidate_release
  systemctl restart "$SERVICE_NAME"
  verify_service_health
  # Replace the public proxy only after the candidate is healthy. If Nginx
  # validation fails, install_nginx restores the previous site and the EXIT
  # trap switches the application code back to the previous release.
  install_nginx
  prune_old_releases
  DEPLOYMENT_COMPLETE=1
  if [ "$ENV_CREATED" = "1" ] || [ "$ADMIN_PASSWORD_ROTATED" = "1" ]; then
    log "A separate legacy administrator API password was generated and stored in $ENV_FILE."
    log "The interactive installer prints the highest administrator login account separately."
  else
    log "Existing environment file kept: $ENV_FILE"
  fi
  log "Systemd service: $SERVICE_NAME (legacy alias: $LEGACY_SERVICE_NAME)"
  log "Reset admin password command: sudo ${SERVICE_NAME}-reset-admin-password"
  log "Update command: sudo laboratory-management-system-update"
  log "Firebase command: sudo $FIREBASE_CONFIG_COMMAND /root/firebase-admin-service-account.json"
  log "VPS management panel: sudo db"
  log "Current release: $CANDIDATE_RELEASE"
  if [ -n "$ROLLBACK_RELEASE" ]; then
    log "Previous release: $ROLLBACK_RELEASE"
  fi
  log 'Database rollback is always manual; application rollback never restores a database automatically.'
  log "Deployment finished. Open http://SERVER_IP/v5/ or https://YOUR_DOMAIN/v5/."
}

main "$@"
