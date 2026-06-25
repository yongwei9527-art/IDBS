#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/yongwei9527-art/IDBS.git}"
SRC_DIR="${SRC_DIR:-/var/www/idbs-src}"
BRANCH="${BRANCH:-main}"

echo "[1/4] Installing bootstrap packages"
sudo apt-get update
sudo apt-get install -y git curl ca-certificates

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

echo "[4/4] Preparing VPS and running deployment"
cd "${SRC_DIR}"
chmod +x scripts/prepare-vps.sh
chmod +x scripts/deploy-ubuntu.sh
sudo -E env RESET_IDBS_DATA=0 ./scripts/prepare-vps.sh
sudo -E ./scripts/deploy-ubuntu.sh
