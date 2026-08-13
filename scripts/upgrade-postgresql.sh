#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SERVICE_NAME="${SERVICE_NAME:-laboratory-management-system}"
APP_BASE="${APP_BASE:-/var/www/laboratory-management-system}"
ENV_FILE="${ENV_FILE:-$APP_BASE/shared/.env}"
TARGET_POSTGRES_MAJOR="${TARGET_POSTGRES_MAJOR:-16}"
DATABASE_NAME="${DATABASE_NAME:-laboratory_management_system}"
UPGRADE_METHOD="${UPGRADE_METHOD:-dump}"
BACKUP_ROOT="${BACKUP_ROOT:-}"

OLD_MAJOR=''
CLUSTER_NAME=''
OLD_PORT=''
APP_WAS_ACTIVE=0
MIGRATION_STARTED=0
UPGRADE_VERIFIED=0
BACKUP_DIR=''
LOCK_FILE="${LOCK_FILE:-/run/lock/laboratory-management-system-postgresql-upgrade.lock}"

log() {
  printf '\n[postgresql-upgrade] %s\n' "$*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

read_env_value() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  awk -v key="$key" 'index($0, key "=") == 1 { value = substr($0, length(key) + 2) } END { print value }' "$ENV_FILE"
}

cluster_field() {
  local version="$1" name="$2" field="$3"
  pg_lsclusters --no-header 2>/dev/null | awk -v version="$version" -v name="$name" -v field="$field" '
    $1 == version && $2 == name { print $field; exit }
  '
}

cluster_exists() {
  local version="$1" name="$2"
  pg_lsclusters --no-header 2>/dev/null | awk -v version="$version" -v name="$name" '
    $1 == version && $2 == name { found = 1 }
    END { exit(found ? 0 : 1) }
  '
}

run_cluster_psql() {
  local version="$1" port="$2" database="$3"
  shift 3
  runuser -u postgres -- "/usr/lib/postgresql/$version/bin/psql" \
    --no-psqlrc --host /var/run/postgresql --port "$port" --dbname "$database" "$@"
}

wait_for_cluster() {
  local version="$1" port="$2" attempt
  for attempt in $(seq 1 30); do
    if run_cluster_psql "$version" "$port" postgres --tuples-only --no-align \
      --command 'SELECT 1' 2>/dev/null | grep -qx '1'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

restore_old_cluster() {
  local old_current_port target_current_port
  [ -n "$OLD_MAJOR" ] && [ -n "$CLUSTER_NAME" ] && [ -n "$OLD_PORT" ] || return 0

  log "Attempting to restore PostgreSQL $OLD_MAJOR/$CLUSTER_NAME on port $OLD_PORT..."
  if cluster_exists "$TARGET_POSTGRES_MAJOR" "$CLUSTER_NAME"; then
    target_current_port="$(cluster_field "$TARGET_POSTGRES_MAJOR" "$CLUSTER_NAME" 3)"
    pg_ctlcluster "$TARGET_POSTGRES_MAJOR" "$CLUSTER_NAME" stop --force >/dev/null 2>&1 || true
  else
    target_current_port=''
  fi

  old_current_port="$(cluster_field "$OLD_MAJOR" "$CLUSTER_NAME" 3)"
  pg_ctlcluster "$OLD_MAJOR" "$CLUSTER_NAME" stop --force >/dev/null 2>&1 || true

  # pg_upgradecluster normally moves the old cluster to an unused port. Keep
  # the new cluster on that unused port so that the unchanged old cluster can
  # safely reclaim its original application port.
  if [ -n "$target_current_port" ] && [ "$target_current_port" = "$OLD_PORT" ] \
    && [ -n "$old_current_port" ] && [ "$old_current_port" != "$OLD_PORT" ]; then
    pg_conftool "$TARGET_POSTGRES_MAJOR" "$CLUSTER_NAME" set port "$old_current_port" || true
  fi
  pg_conftool "$OLD_MAJOR" "$CLUSTER_NAME" set port "$OLD_PORT" || true
  pg_ctlcluster "$OLD_MAJOR" "$CLUSTER_NAME" start || true

  if [ "$APP_WAS_ACTIVE" = '1' ]; then
    systemctl restart "$SERVICE_NAME" || true
  fi
}

on_exit() {
  local status=$?
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ] && [ "$MIGRATION_STARTED" = '1' ] && [ "$UPGRADE_VERIFIED" != '1' ]; then
    restore_old_cluster
    log "Upgrade failed. The script attempted to restore PostgreSQL $OLD_MAJOR."
    [ -z "$BACKUP_DIR" ] || log "Verified safety backup: $BACKUP_DIR"
  fi
  exit "$status"
}

validate_inputs() {
  local configured_backup_root
  [ "$(id -u)" -eq 0 ] || die 'Run this command as root (use sudo).'
  configured_backup_root="$(read_env_value BACKUP_DIR)"
  BACKUP_ROOT="${BACKUP_ROOT:-${configured_backup_root:-$APP_BASE/backups}}"
  [[ "$TARGET_POSTGRES_MAJOR" =~ ^[0-9]+$ ]] || die 'TARGET_POSTGRES_MAJOR must be a whole number.'
  [ "$TARGET_POSTGRES_MAJOR" -ge 15 ] && [ "$TARGET_POSTGRES_MAJOR" -le 18 ] \
    || die 'TARGET_POSTGRES_MAJOR must be from 15 through 18.'
  case "$UPGRADE_METHOD" in
    dump|upgrade) ;;
    *) die 'UPGRADE_METHOD must be dump or upgrade.' ;;
  esac
  [[ "$DATABASE_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die 'DATABASE_NAME is invalid.'
  [[ "$BACKUP_ROOT" = /* ]] || die 'BACKUP_ROOT must be an absolute path.'
  case "$BACKUP_ROOT" in
    /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/proc|/root|/run|/sbin|/sys|/usr|/var|/var/lib|/var/lib/postgresql)
      die "Unsafe BACKUP_ROOT: $BACKUP_ROOT"
      ;;
  esac
}

acquire_lock() {
  mkdir -p -- "$(dirname "$LOCK_FILE")"
  exec 9>"$LOCK_FILE"
  flock -n 9 || die 'Another PostgreSQL upgrade is already running.'
}

validate_database_url() {
  local database_url
  database_url="$(read_env_value DATABASE_URL)"
  [ -n "$database_url" ] || die "DATABASE_URL is missing from $ENV_FILE"
  if ! DATABASE_URL_TO_CHECK="$database_url" EXPECTED_DATABASE_NAME="$DATABASE_NAME" node <<'NODE'
const value = String(process.env.DATABASE_URL_TO_CHECK || '');
const expectedDatabase = String(process.env.EXPECTED_DATABASE_NAME || '');
let parsed;
try {
  parsed = new URL(value);
} catch {
  process.exit(1);
}
const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
const localHost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
const localPort = (parsed.port || '5432') === '5432';
const validProtocol = parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:';
process.exit(validProtocol && localHost && localPort && database === expectedDatabase ? 0 : 1);
NODE
  then
    unset database_url
    die "This command only upgrades this project's local $DATABASE_NAME database on 127.0.0.1:5432."
  fi
  unset database_url
}

detect_old_cluster() {
  local row_count other_databases
  mapfile -t primary_clusters < <(pg_lsclusters --no-header | awk '$3 == 5432 && $4 == "online" { print $1 " " $2 " " $3 }')
  row_count="${#primary_clusters[@]}"
  [ "$row_count" -eq 1 ] \
    || die "Expected exactly one online PostgreSQL cluster on port 5432; found $row_count. Run: sudo pg_lsclusters"

  read -r OLD_MAJOR CLUSTER_NAME OLD_PORT <<< "${primary_clusters[0]}"
  [ "$OLD_MAJOR" -lt "$TARGET_POSTGRES_MAJOR" ] \
    || die "Current primary cluster is PostgreSQL $OLD_MAJOR; target $TARGET_POSTGRES_MAJOR is not newer."
  [ -x "/usr/lib/postgresql/$OLD_MAJOR/bin/pg_dump" ] \
    || die "PostgreSQL $OLD_MAJOR client tools are missing."

  if ! run_cluster_psql "$OLD_MAJOR" "$OLD_PORT" postgres --tuples-only --no-align \
    --command "SELECT 1 FROM pg_database WHERE datname = '$DATABASE_NAME'" | grep -qx '1'; then
    die "Database $DATABASE_NAME was not found in PostgreSQL $OLD_MAJOR/$CLUSTER_NAME."
  fi
  other_databases="$(run_cluster_psql "$OLD_MAJOR" "$OLD_PORT" postgres --tuples-only --no-align \
    --command "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname NOT IN ('postgres', '$DATABASE_NAME') ORDER BY datname")"
  [ -z "$other_databases" ] \
    || die "This cluster also contains databases not managed by this project; upgrade them separately after review: $other_databases"

  log "Detected primary cluster: PostgreSQL $OLD_MAJOR/$CLUSTER_NAME on port $OLD_PORT"
  log "Upgrade target: PostgreSQL $TARGET_POSTGRES_MAJOR (method: $UPGRADE_METHOD)"
}

confirm_upgrade() {
  if [ "${CONFIRM_POSTGRES_UPGRADE:-}" = 'UPGRADE-POSTGRESQL' ]; then
    return 0
  fi
  [ -t 0 ] || die 'Non-interactive upgrade requires CONFIRM_POSTGRES_UPGRADE=UPGRADE-POSTGRESQL.'
  printf '\nThis operation stops the application and performs a PostgreSQL %s -> %s major upgrade.\n' \
    "$OLD_MAJOR" "$TARGET_POSTGRES_MAJOR"
  printf 'The old cluster is retained for rollback. Type UPGRADE-POSTGRESQL to continue: '
  read -r answer
  [ "$answer" = 'UPGRADE-POSTGRESQL' ] || die 'Upgrade cancelled.'
}

check_free_space() {
  local data_dir data_kb available_kb required_kb
  data_dir="$(cluster_field "$OLD_MAJOR" "$CLUSTER_NAME" 6)"
  [ -d "$data_dir" ] || die "Old PostgreSQL data directory does not exist: $data_dir"
  data_kb="$(du -sk -- "$data_dir" | awk '{print $1}')"
  available_kb="$(df -Pk -- /var/lib/postgresql | awk 'NR == 2 {print $4}')"
  if [ "$UPGRADE_METHOD" = 'dump' ]; then
    # The dump method can temporarily need room for both a logical dump and a
    # complete new data directory while the unchanged old cluster is retained.
    required_kb=$((data_kb * 2 + 1048576))
  else
    required_kb=$((data_kb + 1048576))
  fi
  [ "$available_kb" -ge "$required_kb" ] \
    || die "Insufficient free space under /var/lib/postgresql. Need at least $required_kb KiB; available $available_kb KiB."
}

create_verified_backup() {
  local stamp database_tmp globals_tmp dump_tool restore_tool dumpall_tool
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  BACKUP_DIR="$BACKUP_ROOT/postgresql-major-upgrade-$stamp"
  mkdir -p -- "$BACKUP_DIR"
  chown root:root "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"

  database_tmp="$BACKUP_DIR/${DATABASE_NAME}.dump.tmp"
  globals_tmp="$BACKUP_DIR/globals.sql.tmp"
  dump_tool="/usr/lib/postgresql/$OLD_MAJOR/bin/pg_dump"
  restore_tool="/usr/lib/postgresql/$OLD_MAJOR/bin/pg_restore"
  dumpall_tool="/usr/lib/postgresql/$OLD_MAJOR/bin/pg_dumpall"

  log "Creating a PostgreSQL backup before installing or stopping anything..."
  runuser -u postgres -- "$dump_tool" --host /var/run/postgresql --port "$OLD_PORT" \
    --format custom --no-owner --no-acl --dbname "$DATABASE_NAME" > "$database_tmp"
  runuser -u postgres -- "$dumpall_tool" --host /var/run/postgresql --port "$OLD_PORT" \
    --globals-only > "$globals_tmp"
  "$restore_tool" --list "$database_tmp" >/dev/null
  grep -q -- '-- PostgreSQL database cluster dump' "$globals_tmp" \
    || die 'Global-object backup verification failed.'
  mv -- "$database_tmp" "$BACKUP_DIR/${DATABASE_NAME}.dump"
  mv -- "$globals_tmp" "$BACKUP_DIR/globals.sql"
  sha256sum "$BACKUP_DIR/${DATABASE_NAME}.dump" "$BACKUP_DIR/globals.sql" \
    > "$BACKUP_DIR/SHA256SUMS"
  chmod 600 "$BACKUP_DIR"/*
  log "Verified backup: $BACKUP_DIR"
}

configure_pgdg_if_needed() {
  local codename key_dir key_file key_tmp repo_file
  if apt-cache show "postgresql-$TARGET_POSTGRES_MAJOR" >/dev/null 2>&1; then
    return 0
  fi

  [ -r /etc/os-release ] || die '/etc/os-release is missing.'
  # shellcheck disable=SC1091
  source /etc/os-release
  codename="${VERSION_CODENAME:-}"
  [ -n "$codename" ] || die 'The operating-system codename could not be detected.'
  curl -4fsSI --connect-timeout 15 --max-time 60 \
    "https://apt.postgresql.org/pub/repos/apt/dists/${codename}-pgdg/Release" >/dev/null \
    || die "The official PostgreSQL APT repository does not support this OS codename: $codename"

  key_dir='/usr/share/postgresql-common/pgdg'
  key_file="$key_dir/apt.postgresql.org.asc"
  repo_file='/etc/apt/sources.list.d/laboratory-management-system-pgdg.list'
  mkdir -p -- "$key_dir"
  key_tmp="$(mktemp "$key_dir/.apt.postgresql.org.asc.XXXXXX")"
  curl -4fL --show-error --connect-timeout 15 --max-time 120 --retry 3 \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc -o "$key_tmp"
  [ "$(gpg --show-keys --with-colons "$key_tmp" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }')" \
      = 'B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8' ] \
    || die 'The downloaded PostgreSQL repository signing-key fingerprint is invalid.'
  install -o root -g root -m 0644 "$key_tmp" "$key_file"
  rm -f -- "$key_tmp"
  printf 'deb [signed-by=%s] https://apt.postgresql.org/pub/repos/apt %s-pgdg main\n' \
    "$key_file" "$codename" > "$repo_file"
  chmod 644 "$repo_file"
  apt-get update
  apt-cache show "postgresql-$TARGET_POSTGRES_MAJOR" >/dev/null 2>&1 \
    || die "postgresql-$TARGET_POSTGRES_MAJOR is unavailable after configuring PGDG."
}

target_cluster_is_empty() {
  local target_port user_databases custom_roles
  target_port="$(cluster_field "$TARGET_POSTGRES_MAJOR" "$CLUSTER_NAME" 3)"
  [ -n "$target_port" ] || return 1
  if [ "$(cluster_field "$TARGET_POSTGRES_MAJOR" "$CLUSTER_NAME" 4)" != 'online' ]; then
    pg_ctlcluster "$TARGET_POSTGRES_MAJOR" "$CLUSTER_NAME" start
  fi
  user_databases="$(run_cluster_psql "$TARGET_POSTGRES_MAJOR" "$target_port" postgres --tuples-only --no-align \
    --command "SELECT count(*) FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres'")"
  custom_roles="$(run_cluster_psql "$TARGET_POSTGRES_MAJOR" "$target_port" postgres --tuples-only --no-align \
    --command "SELECT count(*) FROM pg_roles WHERE rolname <> 'postgres' AND rolname !~ '^pg_'")"
  [ "$user_databases" = '0' ] && [ "$custom_roles" = '0' ]
}

install_target_version() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl gnupg postgresql-common
  configure_pgdg_if_needed
  apt-get install -y "postgresql-$TARGET_POSTGRES_MAJOR" "postgresql-client-$TARGET_POSTGRES_MAJOR"
  [ -x "/usr/lib/postgresql/$TARGET_POSTGRES_MAJOR/bin/postgres" ] \
    || die "PostgreSQL $TARGET_POSTGRES_MAJOR server binary was not installed."

  if cluster_exists "$TARGET_POSTGRES_MAJOR" "$CLUSTER_NAME"; then
    if target_cluster_is_empty; then
      log "Removing the empty package-created PostgreSQL $TARGET_POSTGRES_MAJOR/$CLUSTER_NAME cluster."
      pg_dropcluster --stop "$TARGET_POSTGRES_MAJOR" "$CLUSTER_NAME"
    else
      die "A non-empty PostgreSQL $TARGET_POSTGRES_MAJOR/$CLUSTER_NAME cluster already exists; refusing to overwrite it."
    fi
  fi
}

check_extensions() {
  local extensions
  extensions="$(run_cluster_psql "$OLD_MAJOR" "$OLD_PORT" "$DATABASE_NAME" --tuples-only --no-align \
    --command "SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname")"
  [ -z "$extensions" ] \
    || die "Non-core PostgreSQL extensions require manual compatibility review before upgrade: $extensions"
}

stop_application() {
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    APP_WAS_ACTIVE=1
    systemctl stop "$SERVICE_NAME"
  fi
}

verify_application() {
  local port attempt
  [ "$APP_WAS_ACTIVE" = '1' ] || return 0
  port="$(read_env_value PORT)"
  port="${port:-3000}"
  [[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ] \
    || die "Invalid application PORT in $ENV_FILE"
  systemctl restart "$SERVICE_NAME"
  for attempt in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$port/ready" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  journalctl -u "$SERVICE_NAME" -n 80 --no-pager || true
  return 1
}

perform_upgrade() {
  local server_major new_port
  stop_application
  MIGRATION_STARTED=1
  log "Upgrading PostgreSQL $OLD_MAJOR/$CLUSTER_NAME to $TARGET_POSTGRES_MAJOR..."
  pg_upgradecluster --method="$UPGRADE_METHOD" -v "$TARGET_POSTGRES_MAJOR" "$OLD_MAJOR" "$CLUSTER_NAME"

  new_port="$(cluster_field "$TARGET_POSTGRES_MAJOR" "$CLUSTER_NAME" 3)"
  [ "$new_port" = "$OLD_PORT" ] \
    || die "The upgraded cluster is on unexpected port $new_port instead of $OLD_PORT."
  wait_for_cluster "$TARGET_POSTGRES_MAJOR" "$new_port" \
    || die 'The upgraded PostgreSQL cluster did not become ready.'
  server_major="$(run_cluster_psql "$TARGET_POSTGRES_MAJOR" "$new_port" postgres --tuples-only --no-align \
    --command "SELECT current_setting('server_version_num')::integer / 10000")"
  [ "$server_major" = "$TARGET_POSTGRES_MAJOR" ] \
    || die "The running database reports PostgreSQL $server_major instead of $TARGET_POSTGRES_MAJOR."
  run_cluster_psql "$TARGET_POSTGRES_MAJOR" "$new_port" "$DATABASE_NAME" \
    --set ON_ERROR_STOP=1 --command 'SELECT 1' >/dev/null

  verify_application || die 'The application failed its readiness check on the upgraded database.'
  UPGRADE_VERIFIED=1
}

main() {
  trap on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  validate_inputs
  for command in apt-get awk curl df du flock gpg grep node pg_conftool pg_ctlcluster pg_dropcluster pg_lsclusters pg_upgradecluster runuser sha256sum systemctl; do
    need_cmd "$command"
  done
  acquire_lock
  validate_database_url
  detect_old_cluster
  confirm_upgrade
  check_free_space
  create_verified_backup
  # Recheck because the safety backup may share the same filesystem as PGDATA.
  check_free_space
  check_extensions
  install_target_version
  perform_upgrade

  local old_retained_port
  old_retained_port="$(cluster_field "$OLD_MAJOR" "$CLUSTER_NAME" 3)"
  log "SUCCESS: PostgreSQL $TARGET_POSTGRES_MAJOR is online on port $OLD_PORT."
  log "The unchanged PostgreSQL $OLD_MAJOR cluster is retained, stopped, on port $old_retained_port."
  log "Verified backup: $BACKUP_DIR"
  log "Check status: sudo pg_lsclusters"
  log "After several days of successful operation, remove the old cluster manually with:"
  log "  sudo pg_dropcluster --stop $OLD_MAJOR $CLUSTER_NAME"
}

main "$@"
