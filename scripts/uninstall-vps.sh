#!/usr/bin/env bash
set -euo pipefail

echo "[1/4] Stopping 实验室管理系统 service"
sudo systemctl stop laboratory_management_system || true
sudo systemctl disable laboratory_management_system || true

echo "[2/4] Removing systemd and Nginx configuration"
sudo rm -f /etc/systemd/system/laboratory-management-system.service
sudo systemctl daemon-reload
sudo rm -f /etc/nginx/conf.d/laboratory-management-system.conf
sudo systemctl reload nginx || true

echo "[3/4] Removing application files"
sudo rm -rf /var/www/laboratory-management-system

echo "[4/4] Cleanup reminder"
echo "If you want to remove the PostgreSQL database and user as well, please back up data first and delete them manually in PostgreSQL."
