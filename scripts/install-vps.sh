#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/yongwei9527-art/IDBS.git}"
SRC_DIR="${SRC_DIR:-/var/www/laboratory-management-system-src}"
APP_BASE="${APP_BASE:-/var/www/laboratory-management-system}"
BRANCH="${BRANCH:-main}"
DEFAULT_ADMIN_PHONE="${DEFAULT_ADMIN_PHONE:-13900000000}"
DEFAULT_ADMIN_NAME="${DEFAULT_ADMIN_NAME:-系统管理员}"
PENDING_ADMIN_FILE="$APP_BASE/shared/.initial-super-admin-pending"
INSTALL_INFO_FILE="$APP_BASE/shared/install-info"

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
  local prompt="$1" default="${2:-}" reply
  read -r -p "${prompt}${default:+ [$default]}: " reply || true
  printf '%s' "${reply:-$default}"
}

ask_password() {
  local generated="$1" first second
  printf '\n系统已生成默认强临时密码：%s\n' "$generated" >&2
  printf '直接按 Enter 使用默认密码，或输入自定义密码（12–128 位）。\n' >&2
  read -r -s -p "最高管理员临时密码: " first || true
  echo >&2
  first="${first:-$generated}"
  if [ "$first" != "$generated" ]; then
    read -r -s -p "再次输入临时密码: " second || true
    echo >&2
    [ "$first" = "$second" ] || { echo "两次密码不一致。" >&2; exit 1; }
  fi
  [ "${#first}" -ge 12 ] && [ "${#first}" -le 128 ] || {
    echo "密码必须为 12–128 位。" >&2
    exit 1
  }
  printf '%s' "$first"
}

validate_admin_credentials() {
  local phone="$1" name="$2" password="$3"
  [[ "$phone" =~ ^\+?[0-9-]{6,20}$ ]] || { echo "最高管理员账号必须为 6–20 位数字，可包含开头的 + 或连字符。" >&2; exit 1; }
  [ -n "$name" ] && [ "${#name}" -le 50 ] || { echo "最高管理员姓名不能为空且不能超过 50 个字符。" >&2; exit 1; }
  [ "${#password}" -ge 12 ] && [ "${#password}" -le 128 ] || { echo "密码必须为 12–128 位。" >&2; exit 1; }
}

normalize_domain() {
  local value="$1"
  value="${value#http://}"
  value="${value#https://}"
  value="${value%%/*}"
  value="${value%.}"
  printf '%s' "$value"
}

validate_domain() {
  [ -z "$1" ] && return 0
  [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || {
    echo "域名格式不正确，请不要包含协议、端口或路径。" >&2
    exit 1
  }
}

detect_server_ip() {
  local ip
  ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  [ -n "$ip" ] || ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf '%s' "$ip"
}

install_node() {
  if command -v node >/dev/null 2>&1 && [ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -ge 22 ]; then
    echo "Node.js already installed: $(node -v)"
    return
  fi
  echo "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
}

fetch_project() {
  sudo mkdir -p "$SRC_DIR"
  sudo chown -R "$(id -u):$(id -g)" "$SRC_DIR"
  if [ -d "$SRC_DIR/.git" ]; then
    git -C "$SRC_DIR" config core.fileMode false
    if [ -n "$(git -C "$SRC_DIR" status --porcelain)" ]; then
      echo "源码目录存在本地修改，拒绝覆盖：$SRC_DIR" >&2
      exit 1
    fi
    git -C "$SRC_DIR" fetch origin "$BRANCH" --tags
    git -C "$SRC_DIR" checkout "$BRANCH"
    git -C "$SRC_DIR" pull --ff-only origin "$BRANCH"
  else
    [ -z "$(find "$SRC_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ] || {
      echo "源码目录非空且不是 Git 仓库：$SRC_DIR" >&2
      exit 1
    }
    git clone --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
    git -C "$SRC_DIR" config core.fileMode false
  fi
}

configure_https() {
  local domain="$1" email="$2" env_file="$APP_BASE/shared/.env"
  sudo apt-get install -y certbot python3-certbot-nginx
  local email_args=(--register-unsafely-without-email)
  if [ -n "$email" ]; then
    email_args=(--email "$email")
  fi

  if sudo certbot --nginx --non-interactive --agree-tos --redirect "${email_args[@]}" -d "$domain"; then
    if sudo grep -qE '^CORS_ORIGIN=' "$env_file"; then
      sudo sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=https://localhost,https://${domain}|" "$env_file"
    else
      printf 'CORS_ORIGIN=https://localhost,https://%s\n' "$domain" | sudo tee -a "$env_file" >/dev/null
    fi
    sudo systemctl restart laboratory_management_system
    PUBLIC_ORIGIN="https://${domain}"
    return 0
  fi

  echo "Let's Encrypt 配置未成功，系统继续使用 HTTP。请确认域名已经解析到本机后运行："
  echo "  sudo certbot --nginx -d ${domain}"
  return 1
}

read_root_value() {
  local file="$1" key="$2"
  sudo awk -v prefix="${key}=" 'index($0, prefix) == 1 { value = substr($0, length(prefix) + 1) } END { print value }' "$file"
}

protect_root_files() {
  local file
  sudo chown root:root "$APP_BASE/shared"
  sudo chmod 700 "$APP_BASE/shared"
  for file in "$PENDING_ADMIN_FILE" "$INSTALL_INFO_FILE"; do
    if sudo test -f "$file"; then
      sudo chown root:root "$file"
      sudo chmod 600 "$file"
    fi
  done
}

save_pending_credentials() {
  local phone="$1" name="$2" password="$3" tmp
  validate_admin_credentials "$phone" "$name" "$password"
  sudo mkdir -p "$(dirname "$PENDING_ADMIN_FILE")"
  sudo chown root:root "$(dirname "$PENDING_ADMIN_FILE")"
  sudo chmod 700 "$(dirname "$PENDING_ADMIN_FILE")"
  tmp="$(mktemp)"
  chmod 600 "$tmp"
  {
    printf 'SUPER_ADMIN_PHONE=%s\n' "$phone"
    printf 'SUPER_ADMIN_NAME=%s\n' "$name"
    printf 'SUPER_ADMIN_TEMP_PASSWORD=%s\n' "$password"
  } > "$tmp"
  sudo install -o root -g root -m 600 "$tmp" "$PENDING_ADMIN_FILE"
  rm -f "$tmp"
}

record_install_info() {
  local app_server_address="$1" web_access_url="$2" phone="$3" name="$4" password="$5"
  printf '%s\n%s\n%s\n%s\n%s\n' \
    "$app_server_address" "$web_access_url" "$phone" "$name" "$password" \
    | sudo /usr/local/bin/db --record
  sudo rm -f "$PENDING_ADMIN_FILE"
}

main() {
  command -v sudo >/dev/null 2>&1 || { echo "需要 sudo/root 权限。" >&2; exit 1; }
  echo "=== 实验室管理系统 VPS 安装向导 ==="
  echo "支持 Ubuntu 22.04 / 24.04；现有业务数据默认不会删除。"

  sudo apt-get update
  sudo apt-get install -y git curl ca-certificates openssl
  install_node
  fetch_project

  local domain_input domain server_ip cors_origin enable_https=0 tls_email=''
  domain_input="$(ask_input "域名（可留空；留空时使用服务器 IP）" "")"
  domain="$(normalize_domain "$domain_input")"
  validate_domain "$domain"
  server_ip="$(detect_server_ip)"

  if [ -n "$domain" ]; then
    DOMAIN_NAME="$domain"
    PUBLIC_ORIGIN="http://${domain}"
    cors_origin="https://localhost,http://${domain}"
    if ask_yes_no "是否自动申请 Let's Encrypt HTTPS 证书？" "Y"; then
      enable_https=1
      tls_email="$(ask_input "证书到期通知邮箱（可留空）" "")"
    fi
  else
    DOMAIN_NAME="_"
    PUBLIC_ORIGIN="http://${server_ip:-SERVER_IP}"
    cors_origin="https://localhost,${PUBLIC_ORIGIN}"
  fi

  sudo -E env \
    RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA=0 \
    APP_BASE="$APP_BASE" \
    SRC_DIR="$SRC_DIR" \
    bash "$SRC_DIR/scripts/prepare-vps.sh"
  protect_root_files

  local initialize_admin=0 admin_phone='' admin_name='' admin_password='' generated_password=''
  if sudo test -f "$PENDING_ADMIN_FILE"; then
    initialize_admin=1
    admin_phone="$(read_root_value "$PENDING_ADMIN_FILE" SUPER_ADMIN_PHONE)"
    admin_name="$(read_root_value "$PENDING_ADMIN_FILE" SUPER_ADMIN_NAME)"
    admin_password="$(read_root_value "$PENDING_ADMIN_FILE" SUPER_ADMIN_TEMP_PASSWORD)"
    validate_admin_credentials "$admin_phone" "$admin_name" "$admin_password"
    echo "检测到未完成的首次安装，将继续使用 root-only 文件中的临时最高管理员凭据。"
  elif ! sudo test -f "$APP_BASE/shared/.env"; then
    initialize_admin=1
    generated_password="IDBS!$(openssl rand -hex 8)"
    printf '\n=== 初始化最高管理员 ===\n'
    admin_phone="$(ask_input "最高管理员手机号/登录账号" "$DEFAULT_ADMIN_PHONE")"
    admin_name="$(ask_input "最高管理员姓名" "$DEFAULT_ADMIN_NAME")"
    admin_password="$(ask_password "$generated_password")"
    validate_admin_credentials "$admin_phone" "$admin_name" "$admin_password"
    save_pending_credentials "$admin_phone" "$admin_name" "$admin_password"
    echo "临时凭据已保存到 root-only（600）恢复文件；安装成功后会转存为安装信息。"
  else
    echo "检测到已有安装：保留现有数据库、上传文件、配置和最高管理员账号。"
  fi

  sudo -E env \
    APP_BASE="$APP_BASE" \
    DOMAIN_NAME="$DOMAIN_NAME" \
    CORS_ORIGIN="$cors_origin" \
    INITIAL_SUPER_ADMIN_PHONE="$admin_phone" \
    INITIAL_SUPER_ADMIN_NAME="$admin_name" \
    INITIAL_SUPER_ADMIN_PASSWORD="$admin_password" \
    bash "$SRC_DIR/scripts/deploy-ubuntu.sh"

  if [ "$enable_https" = "1" ]; then
    configure_https "$domain" "$tls_email" || true
  fi

  local app_server_address="${PUBLIC_ORIGIN%/}" web_access_url="${PUBLIC_ORIGIN%/}/"
  if [ "$initialize_admin" = "1" ]; then
    record_install_info "$app_server_address" "$web_access_url" "$admin_phone" "$admin_name" "$admin_password"
  fi

  printf '\n=== 安装完成 ===\n'
  printf 'App 服务器连接地址：%s\n' "$app_server_address"
  printf '网页访问地址：%s\n' "$web_access_url"
  if [ "$initialize_admin" = "1" ]; then
    printf '最高管理员账号：%s\n' "$admin_phone"
    printf '最高管理员临时密码：%s\n' "$admin_password"
    printf '安全警告：临时密码为敏感明文，首次登录后必须立即修改。\n'
  else
    printf '最高管理员凭据：沿用现有配置；运行 sudo db 可查看最近保存的信息或重置。\n'
  fi
  printf 'VPS 管理面板：sudo db\n'
  printf '升级命令：sudo laboratory-management-system-update\n'
  printf '运行状态：systemctl status laboratory_management_system\n'
  printf '完整说明：%s/docs/VPS_DEPLOYMENT.md\n' "$SRC_DIR"
}

main "$@"
