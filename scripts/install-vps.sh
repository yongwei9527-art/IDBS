#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/yongwei9527-art/IDBS.git}"
SRC_DIR="${SRC_DIR:-/var/www/laboratory-management-system-src}"
BRANCH="${BRANCH:-main}"

ask_yes_no() {
  local prompt="$1" default="$2" reply
  read -r -p "${prompt} [${default}] " reply || true
  reply="${reply:-$default}"
  case "$reply" in
    [Yy]*) return 0 ;;
    *) return 1 ;;
  esac
}

ask_input() {
  local prompt="$1" default="$2" reply
  read -r -p "${prompt}${default:+ [$default]} " reply || true
  printf '%s' "${reply:-$default}"
}

normalize_domain() {
  local value="$1"
  value="${value#http://}"
  value="${value#https://}"
  value="${value%%/*}"
  printf '%s' "$value"
}

detect_server_ip() {
  local ip
  ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  if [ -z "$ip" ]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  printf '%s' "$ip"
}

cors_origin_list() {
  local endpoint="$1"
  printf 'https://localhost,%s' "$endpoint"
}

random_token() {
  openssl rand -hex 16
}

ensure_env_value() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

echo "[1/4] Installing bootstrap packages"
sudo apt-get update
sudo apt-get install -y git curl ca-certificates openssl

if ! command -v node >/dev/null 2>&1; then
  echo "[2/4] Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "[2/4] Node.js already installed: $(node -v)"
fi

echo "[3/4] Fetching project"
sudo mkdir -p "$(dirname "${SRC_DIR}")"
sudo chown -R "$USER":"$USER" "$(dirname "${SRC_DIR}")"
if [ -d "${SRC_DIR}/.git" ]; then
  git -C "${SRC_DIR}" fetch origin "${BRANCH}"
  git -C "${SRC_DIR}" checkout "${BRANCH}"
  git -C "${SRC_DIR}" pull --ff-only origin "${BRANCH}"
else
  rm -rf "${SRC_DIR}"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${SRC_DIR}"
fi

cd "${SRC_DIR}"
if [ ! -f .env ]; then
  cp .env.example .env
fi

if ask_yes_no "服务器是否有域名？" Y; then
  DOMAIN_INPUT="$(ask_input "请输入域名（不要带 http/https）" "北苑绿洲.online")"
  DOMAIN_NAME="$(normalize_domain "$DOMAIN_INPUT")"
  CORS_ORIGIN="$(cors_origin_list "https://${DOMAIN_NAME}")"
  WECHAT_TOKEN="$(random_token)"
  ensure_env_value CORS_ORIGIN "$CORS_ORIGIN"
  ensure_env_value WECHAT_TOKEN "$WECHAT_TOKEN"
  echo "[4/4] Deploying with domain: https://${DOMAIN_NAME}"
else
  DOMAIN_NAME="_"
  SERVER_IP="$(detect_server_ip)"
  PUBLIC_ORIGIN="http://${SERVER_IP:-SERVER_IP}"
  CORS_ORIGIN="$(cors_origin_list "$PUBLIC_ORIGIN")"
  ensure_env_value CORS_ORIGIN "$CORS_ORIGIN"
  echo "[4/4] Deploying without domain: ${PUBLIC_ORIGIN}"
fi

chmod +x scripts/prepare-vps.sh
chmod +x scripts/deploy-ubuntu.sh
sudo -E env RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA=0 DOMAIN_NAME="$DOMAIN_NAME" ./scripts/prepare-vps.sh
sudo -E DOMAIN_NAME="$DOMAIN_NAME" CORS_ORIGIN="$CORS_ORIGIN" ./scripts/deploy-ubuntu.sh

if [ "$DOMAIN_NAME" = "_" ]; then
  echo "Open: ${PUBLIC_ORIGIN}/"
  echo "APK login server address: ${SERVER_IP:-SERVER_IP}"
else
  echo "Open: https://${DOMAIN_NAME}/"
  echo "APK login server address: ${DOMAIN_NAME}"
fi

