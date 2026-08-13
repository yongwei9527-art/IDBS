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
REMOVE_OLD_POSTGRES_AFTER_SUCCESS="${REMOVE_OLD_POSTGRES_AFTER_SUCCESS:-1}"

OLD_MAJOR=''
CLUSTER_NAME=''
OLD_PORT=''
APP_WAS_ACTIVE=0
MIGRATION_STARTED=0
UPGRADE_VERIFIED=0
BACKUP_DIR=''
PRE_UPGRADE_INVENTORY=''
POST_UPGRADE_INVENTORY=''
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

apt_package_has_candidate() {
  apt-cache policy "$1" 2>/dev/null | awk '
    $1 == "Candidate:" { found = 1; if ($2 != "(none)") available = 1 }
    END { exit(found && available ? 0 : 1) }
  '
}

disable_conflicting_pgdg_sources() {
  local selected_file="$1" codename="$2" source_file backup_file disabled_file
  for source_file in /etc/apt/sources.list /etc/apt/sources.list.d/*.list; do
    [ -f "$source_file" ] || continue
    [ "$source_file" = "$selected_file" ] && continue
    grep -Eq "^[[:space:]]*deb(-src)?[[:space:]].*https?://(apt|download|ftp|apt-archive)\\.postgresql\\.org/[^[:space:]]*[[:space:]]+${codename}-pgdg(-archive)?([[:space:]]|$)" "$source_file" || continue
    backup_file="${source_file}.laboratory-management-system-backup"
    [ -e "$backup_file" ] || cp -a -- "$source_file" "$backup_file"
    sed -E -i "/^[[:space:]]*deb(-src)?[[:space:]].*https?:\\/\\/(apt|download|ftp|apt-archive)\\.postgresql\\.org\\/[^[:space:]]*[[:space:]]+${codename}-pgdg(-archive)?([[:space:]]|$)/ s|^|# Disabled conflicting PGDG source by Laboratory Management System: |" "$source_file"
    log "Disabled a conflicting PGDG entry in $source_file"
  done
  for source_file in /etc/apt/sources.list.d/*.sources; do
    [ -f "$source_file" ] || continue
    grep -Eq '^[[:space:]]*URIs:[[:space:]].*https?://(apt|download|ftp|apt-archive)\.postgresql\.org/' "$source_file" || continue
    grep -Eq "^[[:space:]]*Suites:[[:space:]].*(^|[[:space:]])${codename}-pgdg(-archive)?([[:space:]]|$)" "$source_file" || continue
    awk '$1 == "URIs:" { seen = 1; for (i = 2; i <= NF; i++) if ($i !~ /^https?:\/\/(apt|download|ftp|apt-archive)\.postgresql\.org\//) bad = 1 } END { exit(seen && !bad ? 0 : 1) }' "$source_file" \
      || die "Conflicting PGDG stanza shares a deb822 file with another repository: $source_file. Split that file and rerun the upgrade."
    disabled_file="${source_file}.disabled-by-laboratory-management-system"
    [ ! -e "$disabled_file" ] || disabled_file="${disabled_file}.$(date -u +%Y%m%dT%H%M%SZ)"
    mv -- "$source_file" "$disabled_file"
    log "Disabled conflicting PGDG source file $source_file"
  done
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
  case "$REMOVE_OLD_POSTGRES_AFTER_SUCCESS" in
    0|1) ;;
    *) die 'REMOVE_OLD_POSTGRES_AFTER_SUCCESS must be 0 or 1.' ;;
  esac
  [[ "$DATABASE_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die 'DATABASE_NAME is invalid.'
  [[ "$BACKUP_ROOT" = /* ]] || die 'BACKUP_ROOT must be an absolute path.'
  case "$BACKUP_ROOT" in
    /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/proc|/root|/run|/sbin|/sys|/usr|/var|/var/lib|/var/lib/postgresql|/var/lib/postgresql/*)
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
  if [ "$REMOVE_OLD_POSTGRES_AFTER_SUCCESS" = '1' ]; then
    printf 'After all database and application checks pass, the old cluster and old version packages are deleted.\n'
  else
    printf 'The old cluster will be retained because REMOVE_OLD_POSTGRES_AFTER_SUCCESS=0.\n'
  fi
  printf 'Type UPGRADE-POSTGRESQL to continue: '
  read -r answer
  [ "$answer" = 'UPGRADE-POSTGRESQL' ] || die 'Upgrade cancelled.'
}

check_free_space() {
  local data_dir resolved_data resolved_backup data_kb available_kb required_kb
  data_dir="$(cluster_field "$OLD_MAJOR" "$CLUSTER_NAME" 6)"
  [ -d "$data_dir" ] || die "Old PostgreSQL data directory does not exist: $data_dir"
  resolved_data="$(readlink -m -- "$data_dir")"
  resolved_backup="$(readlink -m -- "$BACKUP_ROOT")"
  [ "$resolved_backup" != "$resolved_data" ] && [[ "$resolved_backup" != "$resolved_data"/* ]] \
    || die "BACKUP_ROOT must be outside the old PostgreSQL data directory: $resolved_data"
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

create_database_inventory() {
  local version="$1" port="$2" output="$3"
  run_cluster_psql "$version" "$port" "$DATABASE_NAME" --quiet --tuples-only --no-align \
    --set ON_ERROR_STOP=1 > "$output" <<'SQL'
SELECT 'database|' || current_database();
SELECT 'encoding|' || current_setting('server_encoding');
SELECT 'object|' || c.relkind || '|' || n.nspname || '.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
ORDER BY c.relkind, n.nspname, c.relname;
SELECT 'extension|' || extname || '|' || extversion FROM pg_extension ORDER BY extname;
CREATE TEMP TABLE inventory_row_counts (object_name text PRIMARY KEY, row_count bigint NOT NULL);
DO $inventory$
DECLARE
  relation record;
  exact_count bigint;
BEGIN
  FOR relation IN
    SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY schemaname, tablename
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', relation.schemaname, relation.tablename) INTO exact_count;
    INSERT INTO inventory_row_counts(object_name, row_count)
    VALUES (format('%I.%I', relation.schemaname, relation.tablename), exact_count);
  END LOOP;
END
$inventory$;
SELECT 'rows|' || object_name || '|' || row_count FROM inventory_row_counts ORDER BY object_name;
SQL
  chmod 600 "$output"
}

compare_database_inventories() {
  if ! cmp -s -- "$PRE_UPGRADE_INVENTORY" "$POST_UPGRADE_INVENTORY"; then
    diff -u -- "$PRE_UPGRADE_INVENTORY" "$POST_UPGRADE_INVENTORY" >&2 || true
    die 'PostgreSQL upgrade changed the project schema, extensions, or table row counts; the old cluster was not deleted.'
  fi
  log 'Verified identical project objects, extensions, and all public-table row counts before and after upgrade.'
}

configure_pgdg_if_needed() {
  local codename key_dir key_file key_tmp repo_file pgdg_base pgdg_suite candidate release_url key_url
  # Do not trust a candidate from stale package indexes. Re-select a reachable
  # official source on every upgrade attempt before package installation.

  [ -r /etc/os-release ] || die '/etc/os-release is missing.'
  # shellcheck disable=SC1091
  source /etc/os-release
  codename="${VERSION_CODENAME:-}"
  [ -n "$codename" ] || die 'The operating-system codename could not be detected.'
  pgdg_base=''
  pgdg_suite="${codename}-pgdg"
  for candidate in \
    "https://apt.postgresql.org/pub/repos/apt|${codename}-pgdg" \
    "https://download.postgresql.org/pub/repos/apt|${codename}-pgdg" \
    "https://ftp.postgresql.org/pub/repos/apt|${codename}-pgdg" \
    "https://apt-archive.postgresql.org/pub/repos/apt|${codename}-pgdg-archive"; do
    pgdg_base="${candidate%%|*}"
    pgdg_suite="${candidate#*|}"
    release_url="${pgdg_base}/dists/${pgdg_suite}/Release"
    if curl -4fL --silent --show-error --connect-timeout 15 --max-time 60 \
        --retry 2 --retry-delay 2 "$release_url" -o /dev/null; then
      break
    fi
    pgdg_base=''
  done
  [ -n "$pgdg_base" ] || die "Could not reach a PostgreSQL official APT mirror for ${codename}-pgdg. This is normally a VPS DNS/network problem, not proof that $codename is unsupported. Check DNS access to apt.postgresql.org or download.postgresql.org, then rerun the upgrade."

  key_dir='/usr/share/postgresql-common/pgdg'
  key_file="$key_dir/apt.postgresql.org.asc"
  repo_file='/etc/apt/sources.list.d/laboratory-management-system-pgdg.list'
  mkdir -p -- "$key_dir"
  key_tmp="$(mktemp "$key_dir/.apt.postgresql.org.asc.XXXXXX")"
  key_url="$pgdg_base/ACCC4CF8.asc"
  if [[ "$pgdg_base" == https://apt-archive.postgresql.org/* ]]; then
    key_url='https://www.postgresql.org/media/keys/ACCC4CF8.asc'
  fi
  curl -4fL --show-error --connect-timeout 15 --max-time 120 --retry 3 --retry-delay 2 \
    "$key_url" -o "$key_tmp"
  [ "$(gpg --show-keys --with-colons "$key_tmp" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }')" \
      = 'B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8' ] \
    || die 'The downloaded PostgreSQL repository signing-key fingerprint is invalid.'
  install -o root -g root -m 0644 "$key_tmp" "$key_file"
  rm -f -- "$key_tmp"
  disable_conflicting_pgdg_sources "$repo_file" "$codename"
  printf 'deb [signed-by=%s] %s %s main\n' \
    "$key_file" "$pgdg_base" "$pgdg_suite" > "$repo_file"
  chmod 644 "$repo_file"
  apt-get update \
    -o "Dir::Etc::sourcelist=$repo_file" \
    -o 'Dir::Etc::sourceparts=-' \
    -o 'APT::Get::List-Cleanup=0'
  apt-get update
  apt_package_has_candidate "postgresql-$TARGET_POSTGRES_MAJOR" \
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
  if apt-cache show "postgresql-contrib-$TARGET_POSTGRES_MAJOR" >/dev/null 2>&1; then
    apt-get install -y "postgresql-contrib-$TARGET_POSTGRES_MAJOR"
  fi
  [ -x "/usr/lib/postgresql/$TARGET_POSTGRES_MAJOR/bin/postgres" ] \
    || die "PostgreSQL $TARGET_POSTGRES_MAJOR server binary was not installed."
  for extension in pgcrypto btree_gist; do
    [ -r "/usr/share/postgresql/$TARGET_POSTGRES_MAJOR/extension/${extension}.control" ] \
      || die "PostgreSQL $TARGET_POSTGRES_MAJOR project extension is unavailable: $extension"
  done

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
  local extensions unavailable
  extensions="$(run_cluster_psql "$OLD_MAJOR" "$OLD_PORT" "$DATABASE_NAME" --tuples-only --no-align \
    --command "SELECT extname FROM pg_extension WHERE extname NOT IN ('plpgsql', 'pgcrypto', 'btree_gist') ORDER BY extname")"
  [ -z "$extensions" ] \
    || die "PostgreSQL extensions outside the project-tested set require manual compatibility review: $extensions"
  unavailable="$(run_cluster_psql "$OLD_MAJOR" "$OLD_PORT" "$DATABASE_NAME" --tuples-only --no-align \
    --command "SELECT e.extname FROM pg_extension e WHERE e.extname IN ('pgcrypto', 'btree_gist') AND NOT EXISTS (SELECT 1 FROM pg_available_extensions a WHERE a.name = e.extname) ORDER BY e.extname")"
  [ -z "$unavailable" ] || die "Installed project extensions are unavailable to PostgreSQL $OLD_MAJOR: $unavailable"
}

stop_application() {
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    APP_WAS_ACTIVE=1
    systemctl stop "$SERVICE_NAME"
  fi
}

verify_application() {
  local port attempt
  port="$(read_env_value PORT)"
  port="${port:-3000}"
  [[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ] \
    || die "Invalid application PORT in $ENV_FILE"
  # A partially installed VPS may have no active unit yet. In that case the
  # database checks and a target-version backup are the available verification
  # gates; the parent installer will later migrate/start/check the application.
  [ "$APP_WAS_ACTIVE" = '1' ] || return 0
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

set_env_value() {
  local key="$1" value="$2" env_dir tmp
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "Invalid environment key: $key"
  env_dir="$(dirname "$ENV_FILE")"
  tmp="$(mktemp "$env_dir/.env.postgresql-upgrade.XXXXXX")"
  awk -v key="$key" 'index($0, key "=") != 1 { print }' "$ENV_FILE" > "$tmp"
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chown root:root "$tmp"
  chmod 600 "$tmp"
  mv -f -- "$tmp" "$ENV_FILE"
}

verify_target_backup_and_tools() {
  local dump_tool restore_tool post_dump dump_major restore_major
  dump_tool="/usr/lib/postgresql/$TARGET_POSTGRES_MAJOR/bin/pg_dump"
  restore_tool="/usr/lib/postgresql/$TARGET_POSTGRES_MAJOR/bin/pg_restore"
  [ -x "$dump_tool" ] && [ -x "$restore_tool" ] \
    || die "PostgreSQL $TARGET_POSTGRES_MAJOR backup tools are missing."
  dump_major="$("$dump_tool" --version | awk '{ print $NF }' | cut -d. -f1)"
  restore_major="$("$restore_tool" --version | awk '{ print $NF }' | cut -d. -f1)"
  [ "$dump_major" = "$TARGET_POSTGRES_MAJOR" ] && [ "$restore_major" = "$TARGET_POSTGRES_MAJOR" ] \
    || die 'The installed PostgreSQL backup tools do not match the upgraded server major version.'

  post_dump="$BACKUP_DIR/${DATABASE_NAME}-postgresql-${TARGET_POSTGRES_MAJOR}-verified.dump"
  log "Creating a second verified backup with PostgreSQL $TARGET_POSTGRES_MAJOR tools..."
  runuser -u postgres -- "$dump_tool" --host /var/run/postgresql --port "$OLD_PORT" \
    --format custom --no-owner --no-acl --dbname "$DATABASE_NAME" > "$post_dump"
  "$restore_tool" --list "$post_dump" >/dev/null
  chmod 600 "$post_dump"
  sha256sum "$post_dump" >> "$BACKUP_DIR/SHA256SUMS"
  (cd "$BACKUP_DIR" && sha256sum --check SHA256SUMS)

  # Pin scheduled/manual backups to the same major-version tools as the live
  # server. DATABASE_URL remains unchanged because the replacement keeps 5432.
  set_env_value PG_DUMP_PATH "$dump_tool"
  set_env_value PG_RESTORE_PATH "$restore_tool"
}

old_major_packages() {
  dpkg-query -W -f='${binary:Package}\t${db:Status-Abbrev}\n' 2>/dev/null \
    | awk -v major="$OLD_MAJOR" '
      $2 ~ /^ii/ {
        package = $1
        base = package
        sub(/:[^:]+$/, "", base)
        if (base == "postgresql-" major
            || base == "postgresql-client-" major
            || base == "postgresql-contrib-" major
            || base == "postgresql-server-dev-" major
            || index(base, "postgresql-" major "-") == 1
            || index(base, "postgresql-client-" major "-") == 1) {
          print package
        }
      }
    '
}

old_major_packages_remaining() {
  old_major_packages | grep -q .
}

remove_old_postgresql() {
  local target_port target_status target_major remaining_old_clusters apt_simulation protected_package removed_package allowed
  local -a packages=()
  [ "$REMOVE_OLD_POSTGRES_AFTER_SUCCESS" = '1' ] || {
    log "PostgreSQL $OLD_MAJOR was retained by explicit operator request."
    return 0
  }
  [ "$UPGRADE_VERIFIED" = '1' ] \
    || die 'Internal safety check refused to delete the old PostgreSQL before upgrade verification.'

  # Recheck the live target immediately before the irreversible operation.
  target_port="$(cluster_field "$TARGET_POSTGRES_MAJOR" "$CLUSTER_NAME" 3)"
  target_status="$(cluster_field "$TARGET_POSTGRES_MAJOR" "$CLUSTER_NAME" 4)"
  [ "$target_port" = "$OLD_PORT" ] && [ "$target_status" = 'online' ] \
    || die 'The upgraded PostgreSQL cluster is not online on the application port; the old cluster was not deleted.'
  target_major="$(run_cluster_psql "$TARGET_POSTGRES_MAJOR" "$target_port" postgres --tuples-only --no-align \
    --command "SELECT current_setting('server_version_num')::integer / 10000")"
  [ "$target_major" = "$TARGET_POSTGRES_MAJOR" ] \
    || die 'The live PostgreSQL server version changed before cleanup; the old cluster was not deleted.'

  if cluster_exists "$OLD_MAJOR" "$CLUSTER_NAME"; then
    log "Deleting the replaced PostgreSQL $OLD_MAJOR/$CLUSTER_NAME cluster..."
    pg_dropcluster --stop "$OLD_MAJOR" "$CLUSTER_NAME"
  fi
  cluster_exists "$OLD_MAJOR" "$CLUSTER_NAME" \
    && die "The PostgreSQL $OLD_MAJOR/$CLUSTER_NAME cluster still exists; old packages were not removed."

  remaining_old_clusters="$(pg_lsclusters --no-header 2>/dev/null | awk -v major="$OLD_MAJOR" '$1 == major { print }')"
  if [ -n "$remaining_old_clusters" ]; then
    log "Other PostgreSQL $OLD_MAJOR clusters exist, so version $OLD_MAJOR packages were retained:"
    printf '%s\n' "$remaining_old_clusters"
    return 0
  fi

  mapfile -t packages < <(old_major_packages)
  if [ "${#packages[@]}" -gt 0 ]; then
    apt_simulation="$(apt-get -s purge -y -- "${packages[@]}")"
    for protected_package in \
      "postgresql-$TARGET_POSTGRES_MAJOR" \
      "postgresql-client-$TARGET_POSTGRES_MAJOR" \
      postgresql-common postgresql-client-common; do
      if printf '%s\n' "$apt_simulation" | grep -Eq "^(Remv|Purg)[[:space:]]+${protected_package}([[:space:]]|$)"; then
        die "APT simulation would remove protected package $protected_package; old packages were not purged."
      fi
    done
    while IFS= read -r removed_package; do
      [ -n "$removed_package" ] || continue
      allowed=0
      for protected_package in "${packages[@]}" postgresql postgresql-client postgresql-contrib; do
        if [ "$removed_package" = "${protected_package%%:*}" ]; then
          allowed=1
          break
        fi
      done
      [ "$allowed" = '1' ] \
        || die "APT simulation would also remove unrelated package $removed_package; old packages were not purged."
    done < <(printf '%s\n' "$apt_simulation" | awk '/^(Remv|Purg)[[:space:]]+/ { print $2 }')
    log "Purging replaced PostgreSQL $OLD_MAJOR packages (without autoremove): ${packages[*]}"
    apt-get purge -y -- "${packages[@]}"
  fi
  old_major_packages_remaining \
    && die "Some PostgreSQL $OLD_MAJOR version-specific packages remain installed; inspect with: dpkg-query -W 'postgresql*$OLD_MAJOR*'"
  # Remove only empty version directories. Never recursively delete PostgreSQL
  # paths: non-package or operator-created files must remain visible for review.
  rmdir --ignore-fail-on-non-empty "/etc/postgresql/$OLD_MAJOR" "/var/lib/postgresql/$OLD_MAJOR" 2>/dev/null || true
  cluster_exists "$TARGET_POSTGRES_MAJOR" "$CLUSTER_NAME" \
    || die 'Target cluster disappeared during old-package cleanup.'
  [ "$(cluster_field "$TARGET_POSTGRES_MAJOR" "$CLUSTER_NAME" 3)" = "$OLD_PORT" ] \
    || die 'Target cluster port changed during old-package cleanup.'
  wait_for_cluster "$TARGET_POSTGRES_MAJOR" "$OLD_PORT" \
    || die 'Target cluster stopped responding during old-package cleanup.'
  verify_application \
    || die 'The application failed its final readiness check after old-package cleanup.'
  log "PostgreSQL $OLD_MAJOR cluster data and installed version-specific packages were removed."
}

perform_upgrade() {
  local server_major new_port unavailable
  stop_application
  MIGRATION_STARTED=1
  log "Upgrading PostgreSQL $OLD_MAJOR/$CLUSTER_NAME to $TARGET_POSTGRES_MAJOR..."
  pg_upgradecluster --method="$UPGRADE_METHOD" -v "$TARGET_POSTGRES_MAJOR" "$OLD_MAJOR" "$CLUSTER_NAME"

  new_port="$(cluster_field "$TARGET_POSTGRES_MAJOR" "$CLUSTER_NAME" 3)"
  [ "$new_port" = "$OLD_PORT" ] \
    || die "The upgraded cluster is on unexpected port $new_port instead of $OLD_PORT."
  wait_for_cluster "$TARGET_POSTGRES_MAJOR" "$new_port" \
    || die 'The upgraded PostgreSQL cluster did not become ready.'
  unavailable="$(run_cluster_psql "$TARGET_POSTGRES_MAJOR" "$new_port" "$DATABASE_NAME" --tuples-only --no-align \
    --command "SELECT e.extname FROM pg_extension e WHERE e.extname IN ('pgcrypto', 'btree_gist') AND NOT EXISTS (SELECT 1 FROM pg_available_extensions a WHERE a.name = e.extname) ORDER BY e.extname")"
  [ -z "$unavailable" ] \
    || die "Project extensions are unavailable after PostgreSQL upgrade: $unavailable"
  server_major="$(run_cluster_psql "$TARGET_POSTGRES_MAJOR" "$new_port" postgres --tuples-only --no-align \
    --command "SELECT current_setting('server_version_num')::integer / 10000")"
  [ "$server_major" = "$TARGET_POSTGRES_MAJOR" ] \
    || die "The running database reports PostgreSQL $server_major instead of $TARGET_POSTGRES_MAJOR."
  run_cluster_psql "$TARGET_POSTGRES_MAJOR" "$new_port" "$DATABASE_NAME" \
    --set ON_ERROR_STOP=1 --command 'SELECT 1' >/dev/null
  POST_UPGRADE_INVENTORY="$BACKUP_DIR/post-upgrade-inventory.txt"
  create_database_inventory "$TARGET_POSTGRES_MAJOR" "$new_port" "$POST_UPGRADE_INVENTORY"
  compare_database_inventories

  verify_application || die 'The application failed its readiness check on the upgraded database.'
  verify_target_backup_and_tools
  UPGRADE_VERIFIED=1
}

main() {
  trap on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  validate_inputs
  for command in apt-get awk cmp curl cut df diff dpkg-query du flock gpg grep mktemp node pg_conftool pg_ctlcluster pg_dropcluster pg_lsclusters pg_upgradecluster readlink runuser sha256sum systemctl; do
    need_cmd "$command"
  done
  acquire_lock
  validate_database_url
  detect_old_cluster
  confirm_upgrade
  check_free_space
  create_verified_backup
  PRE_UPGRADE_INVENTORY="$BACKUP_DIR/pre-upgrade-inventory.txt"
  create_database_inventory "$OLD_MAJOR" "$OLD_PORT" "$PRE_UPGRADE_INVENTORY"
  # Recheck because the safety backup may share the same filesystem as PGDATA.
  check_free_space
  check_extensions
  install_target_version
  perform_upgrade
  remove_old_postgresql

  log "SUCCESS: PostgreSQL $TARGET_POSTGRES_MAJOR is online on port $OLD_PORT."
  log "Verified backup: $BACKUP_DIR"
  log "Check status: sudo pg_lsclusters"
  if [ "$REMOVE_OLD_POSTGRES_AFTER_SUCCESS" = '1' ]; then
    log "PostgreSQL $OLD_MAJOR was replaced and removed after all verification gates passed."
  else
    log "PostgreSQL $OLD_MAJOR remains stopped because automatic removal was disabled."
  fi
}

main "$@"
