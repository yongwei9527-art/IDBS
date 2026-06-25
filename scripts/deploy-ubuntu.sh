#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="idbs"
APP_USER="${APP_USER:-idbs}"
APP_GROUP="${APP_GROUP:-$APP_USER}"
APP_BASE="${APP_BASE:-/var/www/idbs}"
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
  if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
}

ensure_user() {
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
  fi
  mkdir -p "$APP_BASE" "$APP_SHARED" "$APP_UPLOADS" "$APP_BACKUPS"
  chown -R "$APP_USER:$APP_GROUP" "$APP_BASE"
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
    ADMIN_PASSWORD="$(printf 'IDBS_%s' "$(openssl rand -hex 6)")"
    DEFAULT_ORIGIN="${CORS_ORIGIN:-$(detect_default_origin)}"
    cat > "$ENV_FILE" <<EOF
PORT=$PORT
ADMIN_PASSWORD=${ADMIN_PASSWORD}
TOKEN_SECRET=$(openssl rand -hex 32)
WECHAT_TOKEN=
WECHAT_APP_ID=
WECHAT_APP_SECRET=
WECHAT_ADMIN_OPENIDS=
UPLOAD_DIR=$APP_UPLOADS
DATABASE_URL=postgresql://idbs_user:${DB_PASSWORD}@127.0.0.1:5432/idbs
PGSSL=false
CORS_ORIGIN=${DEFAULT_ORIGIN}
EOF
    ENV_CREATED=1
  fi
  repair_env_placeholders
  chown "$APP_USER:$APP_GROUP" "$ENV_FILE"
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
  local current_admin current_secret current_cors current_db
  current_admin="$(get_env_value ADMIN_PASSWORD || true)"
  current_secret="$(get_env_value TOKEN_SECRET || true)"
  current_cors="$(get_env_value CORS_ORIGIN || true)"
  current_db="$(get_env_value DATABASE_URL || true)"

  if [ -z "$current_admin" ] || [ "$current_admin" = "change-me" ] || [ "$current_admin" = "your-admin-password" ]; then
    set_env_value ADMIN_PASSWORD "IDBS_$(openssl rand -hex 6)"
    ADMIN_PASSWORD_ROTATED=1
  fi

  if [ -z "$current_secret" ] || [ "$current_secret" = "change-me-please" ] || [ "$current_secret" = "your-long-random-secret" ]; then
    set_env_value TOKEN_SECRET "$(openssl rand -hex 32)"
  fi

  if [ -z "$current_cors" ] || [ "$current_cors" = "https://your-domain.com" ]; then
    set_env_value CORS_ORIGIN "${CORS_ORIGIN:-$(detect_default_origin)}"
  fi

  if [ -z "$current_db" ] || printf '%s' "$current_db" | grep -q 'your-password'; then
    set_env_value DATABASE_URL "postgresql://idbs_user:$(openssl rand -hex 16)@127.0.0.1:5432/idbs"
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
    printf '*'
  fi
}

get_env_value() {
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d '=' -f 2-
}

ensure_local_database() {
  local database_url db_password
  database_url="$(get_env_value DATABASE_URL)"

  case "$database_url" in
    postgresql://idbs_user:*@127.0.0.1:5432/idbs|postgres://idbs_user:*@127.0.0.1:5432/idbs)
      db_password="${database_url#*://idbs_user:}"
      db_password="${db_password%@127.0.0.1:5432/idbs}"
      ;;
    *)
      log "Skipping local PostgreSQL setup because DATABASE_URL is not the default local idbs database."
      return 0
      ;;
  esac

  systemctl enable postgresql
  systemctl start postgresql

  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='idbs_user'" | grep -q 1; then
    sudo -u postgres psql -c "CREATE USER idbs_user WITH PASSWORD '${db_password}';"
  else
    sudo -u postgres psql -c "ALTER USER idbs_user WITH PASSWORD '${db_password}';"
  fi

  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='idbs'" | grep -q 1; then
    sudo -u postgres createdb -O idbs_user idbs
  fi

  sudo -u postgres psql -d idbs -c "GRANT ALL PRIVILEGES ON DATABASE idbs TO idbs_user;"
  sudo -u postgres psql -d idbs -f "$APP_CURRENT/sql/schema.sql"
  sudo -u postgres psql -d idbs -c "GRANT ALL ON SCHEMA public TO idbs_user;"
  sudo -u postgres psql -d idbs -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO idbs_user;"
  sudo -u postgres psql -d idbs -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO idbs_user;"
  sudo -u postgres psql -d idbs -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO idbs_user;"
  sudo -u postgres psql -d idbs -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO idbs_user;"
}

install_service() {
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=IDBS VPS service
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
Description=IDBS PostgreSQL daily backup
After=network.target postgresql.service

[Service]
Type=oneshot
User=$APP_USER
Group=$APP_GROUP
EnvironmentFile=$ENV_FILE
Environment=APP_BACKUPS=$APP_BACKUPS
ExecStart=/bin/bash -lc 'set -euo pipefail; mkdir -p "$APP_BACKUPS"; pg_dump "\$DATABASE_URL" | gzip > "$APP_BACKUPS/idbs_\$(date +%%F).sql.gz"; find "$APP_BACKUPS" -type f -name "idbs_*.sql.gz" -mtime +14 -delete'
EOF

  cat > "$BACKUP_TIMER_FILE" <<EOF
[Unit]
Description=Run IDBS PostgreSQL backup once per day

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

install_nginx() {
  rm -f /etc/nginx/sites-enabled/default
  rm -f /etc/nginx/conf.d/default.conf

  cat > "$NGINX_FILE" <<EOF
server {
  listen 80 default_server;
  server_name $DOMAIN_NAME;

  client_max_body_size 20m;

  location /uploads/ {
    alias $APP_UPLOADS/;
    expires 7d;
    add_header Cache-Control "public, immutable";
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

main() {
  require_root
  install_packages
  need_cmd rsync
  ensure_user
  sync_app
  ensure_env
  npm --prefix "$APP_CURRENT" install --omit=dev
  chown -R "$APP_USER:$APP_GROUP" "$APP_CURRENT"
  ensure_local_database
  install_service
  install_backup_timer
  install_nginx
  systemctl restart "$APP_NAME"
  if [ "$ENV_CREATED" = "1" ] || [ "$ADMIN_PASSWORD_ROTATED" = "1" ]; then
    log "Initial admin password: $(get_env_value ADMIN_PASSWORD)"
    log "The password can be changed later in the admin security page."
  else
    log "Existing environment file kept: $ENV_FILE"
  fi
  log "Deployment finished. Open http://SERVER_IP/ or your bound domain."
}

main "$@"
