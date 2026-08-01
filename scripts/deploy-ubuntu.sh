#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="laboratory_management_system"
APP_USER="${APP_USER:-laboratory_management_system}"
APP_GROUP="${APP_GROUP:-$APP_USER}"
APP_BASE="${APP_BASE:-/var/www/laboratory-management-system}"
APP_CURRENT="$APP_BASE/current"
APP_SHARED="$APP_BASE/shared"
APP_UPLOADS="$APP_BASE/uploads"
APP_BACKUPS="$APP_BASE/backups"
ENV_FILE="$APP_SHARED/.env"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
BACKUP_SERVICE_FILE="/etc/systemd/system/${APP_NAME}-backup.service"
BACKUP_TIMER_FILE="/etc/systemd/system/${APP_NAME}-backup.timer"
NGINX_FILE="/etc/nginx/sites-available/${APP_NAME}.conf"
NGINX_LINK="/etc/nginx/sites-enabled/${APP_NAME}.conf"
ADMIN_RESET_COMMAND="/usr/local/bin/${APP_NAME}-reset-admin-password"
UPDATE_COMMAND="/usr/local/bin/laboratory-management-system-update"
LEGACY_UPDATE_COMMAND="/usr/local/bin/${APP_NAME}-update"
DB_COMMAND="/usr/local/bin/db"
FIREBASE_CONFIG_COMMAND="/usr/local/sbin/laboratory-management-system-configure-firebase"
INSTALL_INFO_FILE="$APP_SHARED/install-info"
PENDING_ADMIN_FILE="$APP_SHARED/.initial-super-admin-pending"
PORT="${PORT:-3000}"
DOMAIN_NAME="${DOMAIN_NAME:-_}"
ENV_CREATED=0
ADMIN_PASSWORD_ROTATED=0

log() { printf '\n[%s] %s\n' "${APP_NAME}" "$*"; }

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
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y curl ca-certificates gnupg nginx openssl postgresql postgresql-client rsync
  if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -lt 22 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
}

ensure_user() {
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
  fi
  mkdir -p "$APP_BASE" "$APP_CURRENT" "$APP_SHARED" "$APP_UPLOADS" "$APP_BACKUPS"
  chown root:root "$APP_BASE" "$APP_SHARED"
  chmod 755 "$APP_BASE"
  chmod 700 "$APP_SHARED"
  chown -R "$APP_USER:$APP_GROUP" "$APP_CURRENT" "$APP_UPLOADS" "$APP_BACKUPS"
  for root_only_file in "$INSTALL_INFO_FILE" "$PENDING_ADMIN_FILE"; do
    if [ -f "$root_only_file" ]; then
      chown root:root "$root_only_file"
      chmod 600 "$root_only_file"
    fi
  done
}

sync_app() {
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'uploads' \
    --exclude '.env' \
    "$ROOT_DIR/" "$APP_CURRENT/"
  chown -R "$APP_USER:$APP_GROUP" "$APP_CURRENT"
}

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    DB_PASSWORD="$(openssl rand -hex 16)"
    ADMIN_PASSWORD="$(printf 'LABORATORY_MANAGEMENT_SYSTEM_%s' "$(openssl rand -hex 6)")"
    DEFAULT_ORIGIN="${CORS_ORIGIN:-$(detect_default_origin)}"
    cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=$PORT
ADMIN_PASSWORD=${ADMIN_PASSWORD}
TOKEN_SECRET=$(openssl rand -hex 32)
WECHAT_TOKEN=
WECHAT_APP_ID=
WECHAT_APP_SECRET=
WECHAT_ADMIN_OPENIDS=
UPLOAD_DIR=$APP_UPLOADS
DATABASE_URL=postgresql://laboratory_management_system_user:${DB_PASSWORD}@127.0.0.1:5432/laboratory_management_system
PGSSL=false
PGSSL_REJECT_UNAUTHORIZED=true
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
  chown root:root "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

set_env_value() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

repair_env_placeholders() {
  local current_admin current_secret current_cors current_db current_node_env current_trust_proxy
  current_admin="$(get_env_value ADMIN_PASSWORD || true)"
  current_secret="$(get_env_value TOKEN_SECRET || true)"
  current_cors="$(get_env_value CORS_ORIGIN || true)"
  current_db="$(get_env_value DATABASE_URL || true)"
  current_node_env="$(get_env_value NODE_ENV || true)"
  current_trust_proxy="$(get_env_value TRUST_PROXY || true)"

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
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d '=' -f 2-
}

ensure_local_database() {
  local database_url db_password
  database_url="$(get_env_value DATABASE_URL)"

  case "$database_url" in
    postgresql://laboratory_management_system_user:*@127.0.0.1:5432/laboratory_management_system|postgres://laboratory_management_system_user:*@127.0.0.1:5432/laboratory_management_system)
      db_password="${database_url#*://laboratory_management_system_user:}"
      db_password="${db_password%@127.0.0.1:5432/laboratory_management_system}"
      ;;
    *)
      log "Skipping local PostgreSQL setup because DATABASE_URL is not the default local laboratory_management_system database."
      return 0
      ;;
  esac

  systemctl enable postgresql
  systemctl start postgresql

  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='laboratory_management_system_user'" | grep -q 1; then
    sudo -u postgres psql -c "CREATE USER laboratory_management_system_user WITH PASSWORD '${db_password}';"
  else
    sudo -u postgres psql -c "ALTER USER laboratory_management_system_user WITH PASSWORD '${db_password}';"
  fi

  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='laboratory_management_system'" | grep -q 1; then
    sudo -u postgres createdb -O laboratory_management_system_user laboratory_management_system
  fi

  sudo -u postgres psql -d laboratory_management_system -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE laboratory_management_system TO laboratory_management_system_user;"
  sudo -u postgres psql -d laboratory_management_system -v ON_ERROR_STOP=1 -f "$APP_CURRENT/sql/schema.sql"
  if [ -d "$APP_CURRENT/sql/migrations" ]; then
    sudo -u postgres psql -d laboratory_management_system -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());"
    for migration in "$APP_CURRENT"/sql/migrations/*.sql; do
      [ -e "$migration" ] || continue
      migration_name="$(basename "$migration")"
      case "${migration_name,,}" in
        *rollback*) continue ;;
      esac
      version="${migration_name%.sql}"
      if ! sudo -u postgres psql -d laboratory_management_system -tAc "SELECT 1 FROM schema_migrations WHERE version='${version}'" | grep -q 1; then
        sudo -u postgres psql -d laboratory_management_system -v ON_ERROR_STOP=1 --single-transaction -f "$migration" -c "INSERT INTO schema_migrations (version) VALUES ('${version}') ON CONFLICT DO NOTHING;"
      fi
    done
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

run_doctor_check() {
  log "Running deployment doctor check..."
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  NODE_ENV=production npm --prefix "$APP_CURRENT" run doctor
}

install_service() {
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=实验室管理系统 VPS service
After=network.target postgresql.service

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

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$APP_NAME"
}

install_backup_timer() {
  cat > "$BACKUP_SERVICE_FILE" <<EOF
[Unit]
Description=实验室管理系统 PostgreSQL daily backup
After=network.target postgresql.service

[Service]
Type=oneshot
User=$APP_USER
Group=$APP_GROUP
EnvironmentFile=$ENV_FILE
Environment=APP_BACKUPS=$APP_BACKUPS
ExecStart=/bin/bash -lc 'set -euo pipefail; mkdir -p "$APP_BACKUPS"; pg_dump "\$DATABASE_URL" | gzip > "$APP_BACKUPS/laboratory_management_system_\$(date +%%F).sql.gz"; find "$APP_BACKUPS" -type f -name "laboratory_management_system_*.sql.gz" -mtime +14 -delete'
EOF

  cat > "$BACKUP_TIMER_FILE" <<EOF
[Unit]
Description=Run 实验室管理系统 PostgreSQL backup once per day

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
Unit=${APP_NAME}-backup.service

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload
  systemctl enable --now "${APP_NAME}-backup.timer"
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
  sudo laboratory-management-system-reset-admin-password 'NewStrongPassword123'
  sudo ADMIN_NEW_PASSWORD='NewStrongPassword123' laboratory-management-system-reset-admin-password

When no password is passed, the command asks for it without echoing input.
HELP
  exit 0
fi

NEW_PASSWORD="${ADMIN_NEW_PASSWORD:-${1:-}}"
if [ -z "$NEW_PASSWORD" ]; then
  read -r -s -p "New admin password (at least 12 chars): " NEW_PASSWORD
  echo
  read -r -s -p "Confirm new admin password: " CONFIRM_PASSWORD
  echo
  if [ "$NEW_PASSWORD" != "$CONFIRM_PASSWORD" ]; then
    echo "Passwords do not match." >&2
    exit 1
  fi
fi

if [ "${#NEW_PASSWORD}" -lt 12 ]; then
  echo "Password must be at least 12 characters." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

cd "$APP_CURRENT"
ADMIN_NEW_PASSWORD="$NEW_PASSWORD" node scripts/reset-admin-password.js
echo "Done. Please log in to the admin console with the new password."
EOF
  chmod 755 "$ADMIN_RESET_COMMAND"
}

install_update_command() {
  local quoted_app_base quoted_src_dir quoted_update_script
  printf -v quoted_app_base '%q' "$APP_BASE"
  printf -v quoted_src_dir '%q' "$ROOT_DIR"
  printf -v quoted_update_script '%q' "$APP_CURRENT/scripts/update-vps.sh"
  cat > "$UPDATE_COMMAND" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec env APP_BASE=$quoted_app_base SRC_DIR=$quoted_src_dir bash $quoted_update_script "\$@"
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
  rm -f /etc/nginx/sites-enabled/default
  rm -f /etc/nginx/conf.d/default.conf

  cat > "$NGINX_FILE" <<EOF
server {
  listen 80 default_server;
  server_name $DOMAIN_NAME;

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

  ln -sf "$NGINX_FILE" "$NGINX_LINK"
  nginx -t
  systemctl enable nginx
  systemctl start nginx
  systemctl reload nginx
}

build_v3_frontend() {
  if [ ! -f "$APP_CURRENT/web/package.json" ]; then
    log "实验室管理系统 5.0 React frontend package not found; skip compatible /v5 build."
    return
  fi

  log "Building 实验室管理系统 5.0 React frontend into public/v5..."
  npm --prefix "$APP_CURRENT/web" ci
  npm --prefix "$APP_CURRENT/web" run build
  npm --prefix "$APP_CURRENT/web" prune --omit=dev
}

provision_initial_super_admin() {
  if [ -z "${INITIAL_SUPER_ADMIN_PHONE:-}" ] || [ -z "${INITIAL_SUPER_ADMIN_PASSWORD:-}" ]; then
    return 0
  fi

  log "Provisioning the highest administrator login account..."
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  SUPER_ADMIN_PHONE="$INITIAL_SUPER_ADMIN_PHONE" \
    SUPER_ADMIN_NAME="${INITIAL_SUPER_ADMIN_NAME:-系统管理员}" \
    SUPER_ADMIN_PASSWORD="$INITIAL_SUPER_ADMIN_PASSWORD" \
    node "$APP_CURRENT/scripts/provision-super-admin.js"
  unset INITIAL_SUPER_ADMIN_PASSWORD SUPER_ADMIN_PASSWORD
}

verify_service_health() {
  local attempt
  for attempt in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$PORT/ready" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  journalctl -u "$APP_NAME" -n 80 --no-pager || true
  log "Service readiness check failed."
  return 1
}

main() {
  require_root
  install_packages
  need_cmd rsync
  ensure_user
  sync_app
  ensure_env
  npm --prefix "$APP_CURRENT" ci --omit=dev
  build_v3_frontend
  chown -R "$APP_USER:$APP_GROUP" "$APP_CURRENT"
  ensure_local_database
  provision_initial_super_admin
  run_doctor_check
  install_service
  install_backup_timer
  install_admin_reset_command
  install_update_command
  install_firebase_config_command
  install_db_panel
  install_nginx
  systemctl restart "$APP_NAME"
  verify_service_health
  if [ "$ENV_CREATED" = "1" ] || [ "$ADMIN_PASSWORD_ROTATED" = "1" ]; then
    log "A separate legacy administrator API password was generated and stored in $ENV_FILE."
    log "The interactive installer prints the highest administrator login account separately."
  else
    log "Existing environment file kept: $ENV_FILE"
  fi
  log "Reset admin password command: sudo ${APP_NAME}-reset-admin-password"
  log "Update command: sudo laboratory-management-system-update"
  log "Firebase command: sudo $FIREBASE_CONFIG_COMMAND /root/firebase-admin-service-account.json"
  log "VPS management panel: sudo db"
  log "Deployment finished. Open http://SERVER_IP/ or your bound domain."
}

main "$@"

