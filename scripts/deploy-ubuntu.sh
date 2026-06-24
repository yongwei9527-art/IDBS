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
ENV_FILE="$APP_SHARED/.env"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
NGINX_FILE="/etc/nginx/sites-available/${APP_NAME}.conf"
NGINX_LINK="/etc/nginx/sites-enabled/${APP_NAME}.conf"
PORT="${PORT:-3000}"
DOMAIN_NAME="${DOMAIN_NAME:-_}"

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
  apt-get install -y curl ca-certificates gnupg nginx postgresql-client rsync
  if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
}

ensure_user() {
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
  fi
  mkdir -p "$APP_BASE" "$APP_SHARED" "$APP_UPLOADS"
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
    cat > "$ENV_FILE" <<EOF
PORT=$PORT
ADMIN_PASSWORD=change-me
TOKEN_SECRET=$(openssl rand -hex 32)
WECHAT_TOKEN=
WECHAT_APP_ID=
WECHAT_APP_SECRET=
WECHAT_ADMIN_OPENIDS=
UPLOAD_DIR=$APP_UPLOADS
DATABASE_URL=postgresql://idbs_user:your-password@127.0.0.1:5432/idbs
PGSSL=false
CORS_ORIGIN=https://your-domain.com
EOF
  fi
  chown "$APP_USER:$APP_GROUP" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
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

install_nginx() {
  cat > "$NGINX_FILE" <<EOF
server {
  listen 80;
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
  systemctl reload nginx
}

main() {
  require_root
  need_cmd rsync
  install_packages
  ensure_user
  sync_app
  ensure_env
  npm --prefix "$APP_CURRENT" install --omit=dev
  install_service
  install_nginx
  systemctl restart "$APP_NAME"
  log "Deployment finished. Edit $ENV_FILE and then restart $APP_NAME if needed."
}

main "$@"
