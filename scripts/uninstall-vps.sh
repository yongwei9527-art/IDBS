#!/usr/bin/env bash
set -euo pipefail

echo "[1/4] Stopping IDBS service"
sudo systemctl stop idbs || true
sudo systemctl disable idbs || true

echo "[2/4] Removing systemd and Nginx configuration"
sudo rm -f /etc/systemd/system/idbs.service
sudo systemctl daemon-reload
sudo rm -f /etc/nginx/conf.d/idbs.conf
sudo systemctl reload nginx || true

echo "[3/4] Removing application files"
sudo rm -rf /var/www/idbs

echo "[4/4] Cleanup reminder"
echo "If you want to remove the PostgreSQL database and user as well, please back up data first and delete them manually in PostgreSQL."
