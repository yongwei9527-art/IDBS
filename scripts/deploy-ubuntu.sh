#!/usr/bin/env bash
set -euo pipefail

APP_NAME="idbs"
APP_ROOT="/var/www/${APP_NAME}"
CURRENT_DIR="${APP_ROOT}/current"
SHARED_DIR="${APP_ROOT}/shared"
UPLOAD_DIR="${APP_ROOT}/uploads"
LOG_DIR="/var/log/${APP_NAME}"
SERVICE_NAME="${APP_NAME}.service"

echo "[1/8] Installing system packages"
sudo apt-get update
sudo apt-get install -y nginx curl ca-certificates rsync

if ! command -v node >/dev/null 2>&1; then
  echo "[2/8] Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "[2/8] Node.js already installed: $(node -v)"
fi

echo "[3/8] Preparing directories"
sudo mkdir -p "${CURRENT_DIR}" "${SHARED_DIR}" "${UPLOAD_DIR}" "${LOG_DIR}"
sudo chown -R "$USER":"$USER" "${APP_ROOT}"
sudo touch "${LOG_DIR}/app.log" "${LOG_DIR}/error.log"
sudo chown -R www-data:www-data "${LOG_DIR}"

echo "[4/8] Copying project files"
rsync -av --delete \
  --exclude node_modules \
  --exclude uploads \
  --exclude .git \
  ./ "${CURRENT_DIR}/"

echo "[5/8] Installing npm dependencies"
cd "${CURRENT_DIR}"
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

if [ ! -f "${SHARED_DIR}/.env" ]; then
  echo "[6/8] Creating .env from template"
  cp .env.example "${SHARED_DIR}/.env"
  sed -i "s|^UPLOAD_DIR=.*|UPLOAD_DIR=${UPLOAD_DIR}|" "${SHARED_DIR}/.env"
  echo "Edit ${SHARED_DIR}/.env before going live."
else
  echo "[6/8] Reusing existing ${SHARED_DIR}/.env"
fi

echo "[7/8] Installing systemd service"
sudo cp deploy/idbs.service "/etc/systemd/system/${SERVICE_NAME}"
sudo sed -i "s|/var/www/idbs|${APP_ROOT}|g" "/etc/systemd/system/${SERVICE_NAME}"
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"
sudo systemctl restart "${SERVICE_NAME}"

echo "[8/8] Installing nginx config"
sudo cp deploy/nginx.idbs.conf "/etc/nginx/sites-available/${APP_NAME}"
sudo ln -sf "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo
echo "Deployment finished."
echo "Health check: curl http://127.0.0.1:3000/health"
echo "Service log: sudo journalctl -u ${SERVICE_NAME} -f"
echo "App env file: ${SHARED_DIR}/.env"
