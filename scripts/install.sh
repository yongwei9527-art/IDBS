#!/usr/bin/env bash
# Interactive Ubuntu/Debian VPS installer. Download it first, then run it with sudo bash.
set -Eeuo pipefail
umask 077

GITHUB_PROXY_PREFIX="${GITHUB_PROXY_PREFIX:-}"
if [ -n "$GITHUB_PROXY_PREFIX" ]; then
  [[ "$GITHUB_PROXY_PREFIX" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] \
    || { echo '[安装器] GITHUB_PROXY_PREFIX 无效；请填写不带路径、查询参数或凭据的 HTTPS 地址。' >&2; exit 1; }
  GITHUB_PROXY_PREFIX="${GITHUB_PROXY_PREFIX%/}/"
  echo "[安装器] 正在使用您指定的第三方 GitHub 代理：$GITHUB_PROXY_PREFIX"
  echo '[安装器] 此代理并非由本项目运营或担保，请确认信任后再继续。'
fi
REPO_URL="${REPO_URL:-${GITHUB_PROXY_PREFIX}https://github.com/yongwei9527-art/IDBS.git}"
BRANCH="${BRANCH:-main}"
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=''
if [ -n "$SCRIPT_SOURCE" ] && [ -f "$SCRIPT_SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
fi
COMMON_HELPER="${SCRIPT_DIR:+$SCRIPT_DIR/../deploy/vps-common.sh}"
TEMP_COMMON_HELPER=''
cleanup_install() {
  [ -z "$TEMP_COMMON_HELPER" ] || rm -f "$TEMP_COMMON_HELPER"
}
trap cleanup_install EXIT
if [ -z "$COMMON_HELPER" ] || [ ! -f "$COMMON_HELPER" ]; then
  TEMP_COMMON_HELPER="$(mktemp)"
  RAW_BASE_URL="${RAW_BASE_URL:-${GITHUB_PROXY_PREFIX}https://raw.githubusercontent.com/yongwei9527-art/IDBS/$BRANCH}"
  echo '[安装器] 正在下载安装辅助文件……'
  curl -4fL --show-error --connect-timeout 15 --max-time 120 --retry 3 --retry-delay 2 \
    "$RAW_BASE_URL/deploy/vps-common.sh" -o "$TEMP_COMMON_HELPER"
  COMMON_HELPER="$TEMP_COMMON_HELPER"
fi
# shellcheck disable=SC1090
source "$COMMON_HELPER"

DEFAULT_ADMIN_PHONE="${DEFAULT_ADMIN_PHONE:-13900000000}"
DEFAULT_ADMIN_NAME="${DEFAULT_ADMIN_NAME:-系统最高管理员}"
PENDING_ADMIN_FILE="$APP_BASE/shared/.initial-super-admin-pending"
CURRENT_STEP='启动安装器'

report_install_failure() {
  local status=$?
  trap - ERR
  printf '\n[vps] 安装在以下步骤失败：%s\n' "$CURRENT_STEP" >&2
  printf '[vps] 可以安全地重新运行安装器；已有数据库和上传文件会被保留。\n' >&2
  printf '[vps] 诊断命令：\n' >&2
  printf '  sudo systemctl status %s --no-pager\n' "$SERVICE_NAME" >&2
  printf '  sudo journalctl -u %s -n 100 --no-pager\n' "$SERVICE_NAME" >&2
  printf '  sudo nginx -t\n' >&2
  exit "$status"
}
trap report_install_failure ERR

read_pending_value() {
  local key="$1"
  [ -f "$PENDING_ADMIN_FILE" ] || return 0
  awk -v key="$key" 'index($0, key "=") == 1 { value = substr($0, length(key) + 2) } END { print value }' "$PENDING_ADMIN_FILE"
}

save_pending_credentials() {
  local phone="$1" name="$2" password="$3" temp
  mkdir -p "$(dirname "$PENDING_ADMIN_FILE")"
  chown root:root "$(dirname "$PENDING_ADMIN_FILE")"
  chmod 700 "$(dirname "$PENDING_ADMIN_FILE")"
  temp="$(mktemp)"
  chmod 600 "$temp"
  {
    printf 'SUPER_ADMIN_PHONE=%s\n' "$phone"
    printf 'SUPER_ADMIN_NAME=%s\n' "$name"
    printf 'SUPER_ADMIN_TEMP_PASSWORD=%s\n' "$password"
  } > "$temp"
  install -o root -g root -m 600 "$temp" "$PENDING_ADMIN_FILE"
  rm -f "$temp"
}

prompt_admin_credentials() {
  admin_phone="$(ask_value '最高管理员手机号/登录账号' "$DEFAULT_ADMIN_PHONE")"
  validate_phone "$admin_phone"
  admin_name="$(ask_value '最高管理员姓名' "$DEFAULT_ADMIN_NAME")"
  [ -n "$admin_name" ] && [ "${#admin_name}" -le 50 ] \
    && [[ "$admin_name" != *$'\n'* && "$admin_name" != *$'\r'* ]] \
    || die '最高管理员姓名不能为空，长度不能超过 50 个字符，且不能包含换行符。'
  generated_password="$(generate_password)"
  read -r -s -p '最高管理员密码（留空则自动生成，输入时不会显示）：' password_input </dev/tty || true
  echo
  if [ -n "$password_input" ]; then
    read -r -s -p '请再次输入最高管理员密码（输入时不会显示）：' password_confirm </dev/tty || true
    echo
    [ "$password_input" = "$password_confirm" ] || die '两次输入的密码不一致。'
    admin_password="$password_input"
  else
    admin_password="$generated_password"
  fi
  [ "${#admin_password}" -ge 12 ] && [ "${#admin_password}" -le 128 ] \
    || die '最高管理员密码长度必须为 12-128 个字符。'
}

highest_admin_exists() {
  local node_status=0
  [ -n "$(read_env_value DATABASE_URL || true)" ] || return 2
  [ -d "$APP_CURRENT/node_modules/pg" ] || return 2
  ENV_FILE="$ENV_FILE" APP_CURRENT="$APP_CURRENT" node <<'NODE' || node_status=$?
const path = require('node:path');
const current = process.env.APP_CURRENT;
require(path.join(current, 'node_modules/dotenv')).config({
  path: process.env.ENV_FILE,
  quiet: true,
  override: true
});
const { Pool } = require(path.join(current, 'node_modules/pg'));
const { postgresSslOptions } = require(path.join(current, 'src/lib/postgres-ssl'));
const sslMode = String(process.env.PGSSLMODE || '').trim().toLowerCase();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslMode && sslMode !== 'disable' ? postgresSslOptions() : undefined,
  max: 1,
  connectionTimeoutMillis: 10_000
});
(async () => {
  try {
    const result = await pool.query(
      `select 1
       from users u
       left join admin_roles ar on ar.user_id = u.id
       where u.deleted_at is null
         and (u.role = 'super_admin' or ar.role_key = 'super_admin' or ar.permissions ? '*')
       limit 1`
    );
    process.exitCode = result.rowCount > 0 ? 0 : 1;
  } catch {
    process.exitCode = 2;
  } finally {
    await pool.end().catch(() => {});
  }
})();
NODE
  return "$node_status"
}

provision_recovery_admin() {
  local provision_script="$APP_BASE/current/scripts/provision-super-admin.js"
  ENV_FILE="$ENV_FILE" \
    APP_BASE="$APP_BASE" \
    SUPER_ADMIN_PHONE="$admin_phone" \
    SUPER_ADMIN_NAME="$admin_name" \
    SUPER_ADMIN_PASSWORD="$admin_password" \
    node "$provision_script"
}

nginx_domain_uses_https() {
  local domain="$1" candidate configured_domain certificate certificate_key
  for candidate in "/etc/nginx/sites-available/${SERVICE_NAME}.conf" "/etc/nginx/sites-available/${LEGACY_SERVICE_NAME}.conf"; do
    [ -f "$candidate" ] || continue
    configured_domain="$(awk '$1 == "server_name" { gsub(/;/, "", $2); if ($2 != "_") { print $2; exit } }' "$candidate")"
    [ "$configured_domain" = "$domain" ] || continue
    grep -Eq '^[[:space:]]*listen[[:space:]]+443[[:space:]]+ssl;' "$candidate" || continue
    certificate="$(awk '$1 == "ssl_certificate" { gsub(/;/, "", $2); print $2; exit }' "$candidate")"
    certificate_key="$(awk '$1 == "ssl_certificate_key" { gsub(/;/, "", $2); print $2; exit }' "$candidate")"
    letsencrypt_paths_match_domain "$domain" "$certificate" "$certificate_key" || continue
    return 0
  done
  return 1
}

record_install_info() {
  local app_server_address="${origin%/}" web_access_url="${origin%/}/v5/"
  [ -x /usr/local/bin/db ] || die 'VPS 数据库管理命令 db 尚未安装。'
  if [ "$is_new_install" = '1' ]; then
    printf '%s\n%s\n%s\n%s\n%s\n' \
      "$app_server_address" "$web_access_url" "$admin_phone" "$admin_name" "$admin_password" \
      | /usr/local/bin/db --record
    rm -f "$PENDING_ADMIN_FILE"
  else
    printf '%s\n%s\n' "$app_server_address" "$web_access_url" \
      | /usr/local/bin/db --record-addresses
  fi
}

configure_default_apk_download_url() {
  local previous_origin="${1:-}" current_url managed_mode apk_url=''
  current_url="$(read_env_value APK_DOWNLOAD_URL || true)"
  managed_mode="$(read_env_value APK_DOWNLOAD_URL_MANAGED || true)"

  if [ "$managed_mode" = 'self_hosted' ]; then
    apk_url="${origin%/}/download/app.apk"
    if [ ! -f "$APP_CURRENT/public/download/app.apk" ]; then
      echo "警告：已启用本机 APK 托管模式，但 $APP_CURRENT/public/download/app.apk 不存在。" >&2
    fi
  elif [ "$managed_mode" = 'github_release' ]; then
    apk_url="$(github_release_apk_url "$SRC_DIR" || true)"
  elif [ -n "$current_url" ]; then
    if [ -n "$previous_origin" ] \
      && [ "$current_url" = "${previous_origin%/}/download/app.apk" ]; then
      apk_url="${origin%/}/download/app.apk"
      managed_mode='self_hosted'
    else
      return 0
    fi
  elif [ -f "$APP_CURRENT/public/download/app.apk" ]; then
    apk_url="${origin%/}/download/app.apk"
    managed_mode='self_hosted'
  else
    apk_url="$(github_release_apk_url "$SRC_DIR" || true)"
    managed_mode='github_release'
  fi

  if [ -n "$apk_url" ]; then
    if [ "$apk_url" != "$current_url" ]; then
      set_env_value APK_DOWNLOAD_URL "$apk_url"
    fi
    set_env_value APK_DOWNLOAD_URL_MANAGED "$managed_mode"
    systemctl restart "$SERVICE_NAME"
    return 0
  fi

  echo '尚未配置 APK 下载地址。请将已签名 APK 放到 public/download/app.apk，或手动设置 APK_DOWNLOAD_URL。' >&2
}

fetch_source() {
  local -a git_network=(git -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=30)
  log "正在从 GitHub 下载应用程序源码（$BRANCH）"
  if [ -d "$SRC_DIR/.git" ]; then
    if [ -n "$(git -C "$SRC_DIR" status --porcelain)" ]; then
      die "Refusing to overwrite local source changes in $SRC_DIR."
    fi
    "${git_network[@]}" -C "$SRC_DIR" fetch origin --tags
    if git -C "$SRC_DIR" show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
      if git -C "$SRC_DIR" show-ref --verify --quiet "refs/heads/$BRANCH"; then
        git -C "$SRC_DIR" checkout "$BRANCH"
      else
        git -C "$SRC_DIR" checkout -b "$BRANCH" "origin/$BRANCH"
      fi
      git -C "$SRC_DIR" merge --ff-only "origin/$BRANCH"
      [ "$(git -C "$SRC_DIR" rev-parse HEAD)" = "$(git -C "$SRC_DIR" rev-parse "origin/$BRANCH")" ] \
        || die "Local source branch contains unpublished commits: $SRC_DIR ($BRANCH)"
    elif git -C "$SRC_DIR" show-ref --verify --quiet "refs/tags/$BRANCH"; then
      git -C "$SRC_DIR" checkout --detach "refs/tags/$BRANCH"
    else
      die "Git branch or tag not found on origin: $BRANCH"
    fi
  else
    [ ! -e "$SRC_DIR" ] || [ -z "$(find "$SRC_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ] || die "$SRC_DIR is not an empty Git repository directory."
    "${git_network[@]}" clone --progress --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
  fi
}

main() {
  require_root
  require_debian
  validate_systemd_unit_name "$SERVICE_NAME" '正式服务名称'
  validate_systemd_unit_name "$LEGACY_SERVICE_NAME" '旧版兼容服务名称'
  [[ "$APP_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die '应用程序运行用户名称无效。'
  validate_managed_root "$APP_BASE" '应用程序根目录'
  validate_managed_root "$SRC_DIR" '源码目录'
  validate_disjoint_directories \
    '应用程序根目录' "$APP_BASE" \
    '源码目录' "$SRC_DIR"
  command -v apt-get >/dev/null || die '系统中必须安装 apt-get。'

  echo '=== 实验室管理系统 VPS 安装器 ==='
  echo '除非您明确卸载并删除数据，否则已有应用数据会被保留。'
  echo "正式服务名称：$SERVICE_NAME（旧版兼容名称：$LEGACY_SERVICE_NAME）"
  CURRENT_STEP='安装基础软件包'
  safe_apt_update
  apt-get install -y git curl ca-certificates openssl
  if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]; then
    curl -4fL --show-error --connect-timeout 15 --max-time 180 --retry 3 \
      https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi

  local existing_origin='' existing_host='' existing_ip=''
  existing_origin="$(read_env_value APP_PUBLIC_URL || true)"
  if [[ "$existing_origin" =~ ^https?://[^/]+/?$ ]]; then
    existing_host="$(normalize_host "$existing_origin")"
    if is_ipv4 "$existing_host"; then
      existing_ip="$existing_host"
    elif [[ "$existing_host" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
      die "已有 APP_PUBLIC_URL 包含无效的 IPv4 地址：$existing_host"
    fi
  fi

  local input input_host domain host enable_https=0 tls_email='' server_ip origin cors_origin ip_was_auto_detected=0
  input="$(ask_value '请输入域名或公网 IPv4（留空则自动检测 VPS IP）' "$existing_host")"
  input_host="$(normalize_host "$input")"
  if is_ipv4 "$input_host"; then
    existing_ip="$input_host"
    domain=''
  elif [[ "$input_host" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
    die "IPv4 地址无效：$input_host"
  else
    domain="$input_host"
  fi
  validate_domain "$domain"
  if [ -z "$domain" ]; then
    if [ -n "$existing_ip" ]; then
      server_ip="$existing_ip"
    else
      server_ip="$(detect_public_ip || true)"
      ip_was_auto_detected=1
    fi
    is_ipv4 "$server_ip" \
      || die '无法检测到有效的 IPv4 地址。请重新运行安装器，并输入 VPS 公网 IPv4 或域名。'
    if is_non_public_ipv4 "$server_ip"; then
      echo "警告：$server_ip 不是公网 IPv4 地址，互联网用户无法通过此地址访问。" >&2
      if [ "$ip_was_auto_detected" = '1' ]; then
        ask_yes_no '仅自动检测到内网/LAN IPv4，是否继续并仅允许局域网访问？' 'N' \
          || die '无人值守安装需要公网 IPv4 或域名。请重新运行并明确输入。'
      fi
    fi
  fi
  host="${domain:-$server_ip}"

  if [ "$existing_origin" = "https://$host" ] && [ -n "$domain" ]; then
    origin="$existing_origin"
    enable_https=1
    echo "已保留现有 HTTPS 公网地址；接下来会验证 Nginx 证书配置：$origin"
  else
    if [ -n "$domain" ] && ask_yes_no '域名 DNS 生效后，是否自动配置 Let’s Encrypt HTTPS？' 'Y'; then
      enable_https=1
      tls_email="$(ask_value '证书到期通知邮箱（可留空）' '')"
    fi
    origin="http://$host"
  fi
  cors_origin="https://localhost,${origin}"

  local is_new_install=0 admin_phone='' admin_name='' admin_password='' generated_password='' password_input='' password_confirm=''
  if [ -f "$PENDING_ADMIN_FILE" ]; then
    is_new_install=1
    admin_phone="$(read_pending_value SUPER_ADMIN_PHONE)"
    admin_name="$(read_pending_value SUPER_ADMIN_NAME)"
    admin_password="$(read_pending_value SUPER_ADMIN_TEMP_PASSWORD)"
    validate_phone "$admin_phone"
    [ "${#admin_password}" -ge 12 ] && [ "${#admin_password}" -le 128 ] || die '最高管理员密码长度必须为 12-128 个字符。'
    echo '检测到未完成的安装：将继续使用受保护的待创建最高管理员凭据。'
  elif [ ! -f "$APP_BASE/shared/.env" ]; then
    is_new_install=1
    prompt_admin_credentials
    save_pending_credentials "$admin_phone" "$admin_name" "$admin_password"
    echo '最高管理员临时凭据已保存到仅 root 可读的恢复文件中，安装成功后会自动清除。'
  else
    echo '检测到已有安装：将保留现有最高管理员账号和密码。'
  fi
  local existing_export_dir existing_upload_dir existing_backup_dir existing_database_dir
  existing_export_dir="$(read_env_value EXPORT_DIR || true)"
  existing_upload_dir="$(read_env_value UPLOAD_DIR || true)"
  existing_backup_dir="$(read_env_value BACKUP_DIR || true)"
  existing_database_dir="$(read_env_value DATABASE_DIR || true)"
  local export_dir upload_dir backup_dir database_dir
  export_dir="$(ask_value '导出文件保存目录' "${existing_export_dir:-$APP_BASE/exports}")"
  upload_dir="$(ask_value '上传文件保存目录' "${existing_upload_dir:-$APP_BASE/uploads}")"
  backup_dir="$(ask_value '备份文件保存目录' "${existing_backup_dir:-$APP_BASE/backups}")"
  database_dir="$(ask_value '数据库运维文件目录（不是 PostgreSQL PGDATA）' "${existing_database_dir:-$APP_BASE/database}")"
  export_dir="$(canonicalize_absolute_dir "$export_dir" 'Export directory')"
  upload_dir="$(canonicalize_absolute_dir "$upload_dir" 'Upload directory')"
  backup_dir="$(canonicalize_absolute_dir "$backup_dir" 'Backup directory')"
  database_dir="$(canonicalize_absolute_dir "$database_dir" 'Database operations directory')"
  validate_absolute_dir "$export_dir" 'Export directory'
  validate_absolute_dir "$upload_dir" 'Upload directory'
  validate_absolute_dir "$backup_dir" 'Backup directory'
  validate_absolute_dir "$database_dir" 'Database operations directory'
  validate_disjoint_directories \
    'Export directory' "$export_dir" \
    'Upload directory' "$upload_dir" \
    'Backup directory' "$backup_dir" \
    'Database operations directory' "$database_dir"

  local firebase_service_account_file='' firebase_service_account_base64=''
  if ask_yes_no '是否现在配置 Firebase Android 消息推送？' 'N'; then
    firebase_service_account_file="$(ask_value 'Firebase 服务账号 JSON 文件的 Linux 绝对路径' '')"
    [[ "$firebase_service_account_file" == /* ]] || die 'Firebase 服务账号文件路径必须是 Linux 绝对路径。'
    firebase_service_account_base64="$(encode_firebase_service_account "$firebase_service_account_file")"
    [ -n "$firebase_service_account_base64" ] || die 'Firebase 服务账号文件编码失败。'
    echo 'Firebase 服务账号 JSON 已验证；安装器不会打印其内容。'
  fi

  CURRENT_STEP='下载项目源码'
  fetch_source
  # deploy-ubuntu.sh owns service shutdown, directory preparation, and Nginx replacement.
  # Do not run prepare-vps.sh during a normal install/rerun because it removes the working
  # service and Nginx units before the replacement release has been validated.
  CURRENT_STEP='部署应用、数据库、systemd 和 Nginx'
  local deploy_port
  deploy_port="$(read_env_value PORT || true)"
  deploy_port="${deploy_port:-3000}"
  [[ "$deploy_port" =~ ^[0-9]+$ ]] && [ "$deploy_port" -ge 1 ] && [ "$deploy_port" -le 65535 ] \
    || die 'PORT 必须是 1 到 65535 之间的整数。'
  deploy_env=(
    APP_BASE="$APP_BASE"
    SERVICE_NAME="$SERVICE_NAME"
    LEGACY_SERVICE_NAME="$LEGACY_SERVICE_NAME"
    HOST="127.0.0.1"
    PORT="$deploy_port"
    DOMAIN_NAME="${domain:-_}"
    ENABLE_HTTPS="$enable_https"
    CORS_ORIGIN="$cors_origin"
    UPLOAD_DIR="$upload_dir"
    EXPORT_DIR="$export_dir"
    BACKUP_DIR="$backup_dir"
    DATABASE_DIR="$database_dir"
  )
  if [ "$is_new_install" = '1' ]; then
    deploy_env+=(INITIAL_SUPER_ADMIN_PHONE="$admin_phone" INITIAL_SUPER_ADMIN_NAME="$admin_name" INITIAL_SUPER_ADMIN_PASSWORD="$admin_password")
  fi
  env "${deploy_env[@]}" bash "$SRC_DIR/scripts/deploy-ubuntu.sh"

  CURRENT_STEP='配置持久化目录和运行环境'
  ENV_FILE="$APP_BASE/shared/.env"
  ensure_directory "$export_dir" "$APP_USER:$APP_USER" 750
  # Nginx serves non-export uploads directly; exports remain application-only.
  ensure_directory "$upload_dir" "$APP_USER:$APP_USER" 755
  ensure_directory "$backup_dir" root:root 750
  # PostgreSQL is provisioned by the existing deployment script. This directory is retained for DB operational artifacts.
  ensure_directory "$database_dir" postgres:postgres 700
  set_env_value UPLOAD_DIR "$upload_dir"
  set_env_value EXPORT_DIR "$export_dir"
  set_env_value BACKUP_DIR "$backup_dir"
  set_env_value DATABASE_DIR "$database_dir"
  if [ -z "$(read_env_value EXPORT_RETENTION_DAYS || true)" ]; then
    set_env_value EXPORT_RETENTION_DAYS "30"
  fi
  set_env_value APP_PUBLIC_URL "$origin"
  set_env_value CORS_ORIGIN "$cors_origin"
  if [ -z "$(read_env_value APP_PAIRING_SECRET || true)" ]; then
    set_env_value APP_PAIRING_SECRET "$(generate_secret)"
  fi
  if [ -z "$(read_env_value APP_PAIRING_TTL_MINUTES || true)" ]; then
    set_env_value APP_PAIRING_TTL_MINUTES "10"
  fi
  if [ -n "$firebase_service_account_base64" ]; then
    set_env_value FCM_SERVICE_ACCOUNT_JSON_BASE64 "$firebase_service_account_base64"
    set_env_value FCM_SERVICE_ACCOUNT_JSON ""
  fi
  systemctl restart "$SERVICE_NAME"

  local admin_probe_status=0
  if highest_admin_exists; then
    admin_probe_status=0
  else
    admin_probe_status=$?
  fi
  if [ "$admin_probe_status" = '1' ]; then
    echo '数据库中不存在最高管理员，正在恢复未完成的安装。'
    if [ -z "$admin_phone" ] || [ -z "$admin_password" ]; then
      is_new_install=1
      prompt_admin_credentials
      save_pending_credentials "$admin_phone" "$admin_name" "$admin_password"
    fi
    CURRENT_STEP='创建恢复用最高管理员'
    provision_recovery_admin
  elif [ "$admin_probe_status" != '0' ]; then
    die '无法验证最高管理员账号。请检查 DATABASE_URL、PostgreSQL 连接及 users 表权限后重试。'
  fi

  if [ "$enable_https" = '1' ]; then
    apt-get install -y certbot python3-certbot-nginx
    certbot_args=(--nginx --non-interactive --agree-tos -d "$domain")
    if [ -n "$tls_email" ]; then certbot_args+=(--email "$tls_email"); else certbot_args+=(--register-unsafely-without-email); fi
    certbot_succeeded=0
    if certbot "${certbot_args[@]}"; then
      certbot_succeeded=1
    fi
    if nginx_domain_uses_https "$domain"; then
      origin="https://$domain"
      set_env_value APP_PUBLIC_URL "$origin"
      set_env_value CORS_ORIGIN "https://localhost,$origin"
      systemctl restart "$SERVICE_NAME"
      if [ "$certbot_succeeded" != '1' ]; then
        echo 'Certbot 返回错误，但 Nginx 当前正在使用可读取且与域名匹配的证书。请检查证书有效期和 Certbot 日志。' >&2
      fi
    else
      origin="http://$host"
      set_env_value APP_PUBLIC_URL "$origin"
      set_env_value CORS_ORIGIN "https://localhost,$origin"
      systemctl restart "$SERVICE_NAME"
      echo '已安装的 Nginx 站点尚未启用 HTTPS，服务仍可通过 HTTP 访问。请检查 DNS 和 Certbot 日志后重试证书配置。' >&2
    fi
  fi

  CURRENT_STEP='配置 Android APK 下载地址'
  configure_default_apk_download_url "$existing_origin"

  CURRENT_STEP='执行最终就绪检查'
  local ready_port
  ready_port="$(read_env_value PORT || true)"
  ready_port="${ready_port:-3000}"
  curl -fsS "http://127.0.0.1:${ready_port}/ready" >/dev/null
  CURRENT_STEP='记录仅 root 可读的安装信息'
  record_install_info
  echo
  echo '=== 安装完成 ==='
  printf '服务名称：%s\n' "$SERVICE_NAME"
  printf '系统地址：%s/v5/\n' "${origin%/}"
  printf '后台管理地址：%s/v5/admin\n' "${origin%/}"
  printf 'App 下载页：%s/download\n' "${origin%/}"
  printf 'Android APK：%s\n' "$(read_env_value APK_DOWNLOAD_URL || true)"
  if [ "$is_new_install" = '1' ]; then
    printf '最高管理员登录账号：%s\n' "$admin_phone"
    if { printf '最高管理员密码：%s\n' "$admin_password" >/dev/tty; } 2>/dev/null; then
      echo '密码只会在当前交互终端显示一次，请在首次登录后立即修改。'
    else
      echo '当前没有可用的交互终端，因此未打印临时密码。请运行“sudo db”并选择菜单 1 查看。'
    fi
  else
    echo '已保留现有最高管理员凭据。'
  fi
  if [ -n "$firebase_service_account_base64" ]; then
    echo 'Firebase Android 消息推送：已配置。'
    echo '完成加密离线备份后，请从 VPS 安全删除上传的原始 JSON 文件。'
  else
    echo 'Firebase Android 消息推送：未更改。可稍后运行 /usr/local/sbin/laboratory-management-system-configure-firebase 配置。'
  fi
  echo '部署密钥保存在仅 root 可读的环境文件中，安装器不会打印这些密钥；安装期间请妥善保护终端会话日志。'
  CURRENT_STEP='完成'
}

main "$@"
