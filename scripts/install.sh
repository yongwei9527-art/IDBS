#!/usr/bin/env bash
# shellcheck disable=SC2030,SC2031
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
INSTALL_LOCK_DIR=''
INSTALL_LOCK_HELD=0
COMMON_HELPER_REF='d8c538b4fbec636b8523473d5f2bd72522b00c6d'
COMMON_HELPER_SHA256='fdabd61d92eb83be6b8a972395197016f636cd445b7d98d4aa6acd2710b09044'
cleanup_install() {
  [ -z "$TEMP_COMMON_HELPER" ] || rm -f "$TEMP_COMMON_HELPER"
  if [ "$INSTALL_LOCK_HELD" = '1' ] && [ -n "$INSTALL_LOCK_DIR" ]; then
    rm -f -- "$INSTALL_LOCK_DIR/pid"
    rmdir -- "$INSTALL_LOCK_DIR" 2>/dev/null || true
  fi
}
trap cleanup_install EXIT
if [ -z "$COMMON_HELPER" ] || [ ! -f "$COMMON_HELPER" ]; then
  TEMP_COMMON_HELPER="$(mktemp)"
  RAW_BASE_URL="${RAW_BASE_URL:-${GITHUB_PROXY_PREFIX}https://raw.githubusercontent.com/yongwei9527-art/IDBS/$COMMON_HELPER_REF}"
  echo '[安装器] 正在下载安装辅助文件……'
  helper_url="$RAW_BASE_URL/deploy/vps-common.sh"
  if [[ "$helper_url" == *\?* ]]; then
    helper_url="${helper_url}&bundle=${COMMON_HELPER_SHA256}"
  else
    helper_url="${helper_url}?bundle=${COMMON_HELPER_SHA256}"
  fi
  curl -4fL --show-error --connect-timeout 15 --max-time 120 --retry 3 --retry-delay 2 \
    "$helper_url" -o "$TEMP_COMMON_HELPER"
  actual_helper_sha256="$(sha256sum "$TEMP_COMMON_HELPER" | awk '{ print $1 }')"
  if [ "$actual_helper_sha256" != "$COMMON_HELPER_SHA256" ]; then
    echo '[安装器] 安装辅助文件完整性校验失败。代理可能返回了缓存旧文件或被篡改的内容，请更换网络或代理后重试。' >&2
    exit 1
  fi
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

wait_for_final_readiness() {
  local port="$1" attempts=0
  while [ "$attempts" -lt 60 ]; do
    attempts=$((attempts + 1))
    if systemctl is-active --quiet "$SERVICE_NAME" \
      && curl -fsS "http://127.0.0.1:${port}/ready" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  printf '[vps] 最终就绪检查超时：服务在 60 秒内未稳定通过 /ready。\n' >&2
  systemctl status "$SERVICE_NAME" --no-pager >&2 || true
  journalctl -u "$SERVICE_NAME" -n 100 --no-pager >&2 || true
  return 1
}

wait_for_public_proxy_readiness() {
  local public_origin="$1" public_host="$2" attempts=0 status_code=''
  while [ "$attempts" -lt 30 ]; do
    attempts=$((attempts + 1))
    if systemctl is-active --quiet nginx; then
      if [[ "$public_origin" == https://* ]]; then
        status_code="$(curl -sS -o /dev/null -w '%{http_code}' \
          --resolve "${public_host}:443:127.0.0.1" \
          "https://${public_host}/ready" 2>/dev/null || true)"
        if [ "$status_code" = '200' ]; then
          return 0
        fi
      else
        status_code="$(curl -sS -o /dev/null -w '%{http_code}' \
          -H "Host: ${public_host}" "http://127.0.0.1/ready" 2>/dev/null || true)"
        if [ "$status_code" = '200' ]; then
          return 0
        fi
      fi
    fi
    sleep 1
  done

  printf '[vps] Nginx 代理在 30 秒内未通过 /ready，请检查站点配置和服务日志。\n' >&2
  nginx -t >&2 || true
  systemctl status nginx --no-pager >&2 || true
  journalctl -u nginx -n 80 --no-pager >&2 || true
  return 1
}

acquire_installer_lock() {
  local existing_pid=''
  INSTALL_LOCK_DIR='/run/lock/laboratory-management-system-install.lock.d'
  mkdir -p /run/lock
  if mkdir "$INSTALL_LOCK_DIR" 2>/dev/null; then
    :
  else
    if [ -f "$INSTALL_LOCK_DIR/pid" ]; then
      existing_pid="$(cat "$INSTALL_LOCK_DIR/pid" 2>/dev/null || true)"
    fi
    if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
      die "另一个安装器正在运行（PID $existing_pid），请等待其完成。"
    fi
    rm -f -- "$INSTALL_LOCK_DIR/pid"
    rmdir -- "$INSTALL_LOCK_DIR" 2>/dev/null \
      || die '安装锁目录异常，请确认没有安装任务运行后删除 /run/lock/laboratory-management-system-install.lock.d。'
    mkdir "$INSTALL_LOCK_DIR" \
      || die '无法取得安装锁，请稍后重试。'
  fi
  printf '%s\n' "$$" > "$INSTALL_LOCK_DIR/pid"
  INSTALL_LOCK_HELD=1
}

RUNTIME_CONFIG_CHANGED=0

set_runtime_env_value() {
  local key="$1" value="$2" current
  current="$(read_env_value "$key" || true)"
  if [ "$current" = "$value" ]; then
    return 0
  fi
  set_env_value "$key" "$value"
  RUNTIME_CONFIG_CHANGED=1
}

restart_after_runtime_config_change() {
  local port="$1"
  if [ "$RUNTIME_CONFIG_CHANGED" != '1' ]; then
    return 0
  fi
  log '运行配置已更改，正在执行一次受控服务重启。'
  systemctl restart "$SERVICE_NAME"
  wait_for_final_readiness "$port"
  RUNTIME_CONFIG_CHANGED=0
}

require_supported_host_release() {
  local supported=0
  # shellcheck disable=SC1091
  source /etc/os-release
  case "${ID:-}:${VERSION_ID:-}" in
    ubuntu:22.04|ubuntu:24.04|debian:12|debian:13) supported=1 ;;
  esac
  if [ "$supported" = '1' ]; then
    return 0
  fi
  if [ -f "$APP_BASE/shared/.env" ]; then
    printf '[vps] 警告：当前系统 %s %s 不在全新生产安装支持矩阵中；仅允许继续恢复已有安装。\n' \
      "${ID:-unknown}" "${VERSION_ID:-unknown}" >&2
    return 0
  fi
  die "全新安装仅支持 Ubuntu 22.04/24.04 或 Debian 12/13；当前为 ${ID:-unknown} ${VERSION_ID:-unknown}。"
}

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
  if ask_yes_no '是否由系统自动生成最高管理员密码？（推荐；安装完成后仅显示一次）' 'Y'; then
    admin_password="$generated_password"
    echo '已选择自动生成密码。安装完成后请立即保存，并在首次登录后修改。'
  else
    echo '手动输入密码时，终端不会显示字符、圆点或星号，这是正常的安全保护。'
    while true; do
      password_input=''
      password_confirm=''
      if ! read -r -s -p '请输入最高管理员密码（12-128 个字符，输入时不会显示）：' password_input </dev/tty; then
        echo
        die '无法从当前终端读取密码，请重新运行安装器并选择自动生成密码。'
      fi
      echo
      if [ "${#password_input}" -lt 12 ] || [ "${#password_input}" -gt 128 ]; then
        echo '密码长度必须为 12-128 个字符，请重新输入。' >&2
        continue
      fi
      if ! read -r -s -p '请再次输入相同密码（输入时不会显示）：' password_confirm </dev/tty; then
        echo
        die '无法从当前终端读取确认密码，请重新运行安装器并选择自动生成密码。'
      fi
      echo
      if [ "$password_input" != "$password_confirm" ]; then
        echo '两次输入的密码不一致，请重新输入；安装不会退出。' >&2
        continue
      fi
      admin_password="$password_input"
      break
    done
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
      set_runtime_env_value APK_DOWNLOAD_URL "$apk_url"
    fi
    set_runtime_env_value APK_DOWNLOAD_URL_MANAGED "$managed_mode"
    return 0
  fi

  echo '尚未配置 APK 下载地址。请将已签名 APK 放到 public/download/app.apk，或手动设置 APK_DOWNLOAD_URL。' >&2
}

fetch_source() {
  local -a git_network=(git -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=30)
  local current_origin=''
  log "正在从 GitHub 下载应用程序源码（$BRANCH）"
  if [ -d "$SRC_DIR/.git" ]; then
    if [ "$(git -C "$SRC_DIR" config --bool core.sparseCheckout 2>/dev/null || true)" = 'true' ]; then
      log '检测到稀疏检出，正在恢复完整项目文件。'
      git -C "$SRC_DIR" sparse-checkout disable
    fi
    # Recover required tracked files that an interrupted/sparse checkout left
    # absent before deciding whether the operator has real local modifications.
    restore_required_source_files
    if [ -n "$(git -C "$SRC_DIR" status --porcelain)" ]; then
      die "Refusing to overwrite local source changes in $SRC_DIR."
    fi
    current_origin="$(git -C "$SRC_DIR" remote get-url origin 2>/dev/null || true)"
    if [ "$current_origin" != "$REPO_URL" ]; then
      log "正在更新 GitHub 下载地址：$REPO_URL"
      git -C "$SRC_DIR" remote set-url origin "$REPO_URL"
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
      git -C "$SRC_DIR" reset --hard "origin/$BRANCH"
    elif git -C "$SRC_DIR" show-ref --verify --quiet "refs/tags/$BRANCH"; then
      git -C "$SRC_DIR" checkout --detach "refs/tags/$BRANCH"
    else
      die "Git branch or tag not found on origin: $BRANCH"
    fi
  else
    [ ! -e "$SRC_DIR" ] || [ -z "$(find "$SRC_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ] || die "$SRC_DIR is not an empty Git repository directory."
    "${git_network[@]}" clone --progress --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
  fi

  # A stale sparse-index or an incomplete third-party Git proxy checkout can
  # report the correct commit while leaving tracked files absent on disk. Force
  # all skip-worktree entries back into the worktree before deployment.
  git -C "$SRC_DIR" config core.sparseCheckout false
  git -C "$SRC_DIR" config core.sparseCheckoutCone false
  git -C "$SRC_DIR" read-tree -mu HEAD
  git -C "$SRC_DIR" checkout --ignore-skip-worktree-bits --force HEAD -- .
  verify_source_checkout
}

verify_source_checkout() {
  local relative expected actual
  while IFS= read -r relative; do
    [ -n "$relative" ] || continue
    git -C "$SRC_DIR" ls-files --error-unmatch -- "$relative" >/dev/null 2>&1 \
      || die "当前版本不包含安装所需文件：$relative"
    [ -s "$SRC_DIR/$relative" ] \
      || die "源码检出不完整，缺少安装所需文件：$SRC_DIR/$relative。请停用有缓存问题的 GitHub 代理后重试。"
    expected="$(git -C "$SRC_DIR" rev-parse "HEAD:$relative")"
    actual="$(git -C "$SRC_DIR" hash-object --path="$relative" -- "$SRC_DIR/$relative")"
    [ "$actual" = "$expected" ] \
      || die "源码文件与当前 Git 提交不一致：$SRC_DIR/$relative。请停用有缓存问题的 GitHub 代理后重试。"
  done < <(required_source_files)
}

required_source_files() {
  printf '%s\n' \
    package.json \
    package-lock.json \
    server.js \
    deploy/vps-common.sh \
    scripts/deploy-ubuntu.sh \
    scripts/upgrade-postgresql.sh \
    scripts/migrate-db.js \
    scripts/backup-database.js \
    scripts/provision-super-admin.js \
    scripts/doctor.js \
    web/package.json \
    web/package-lock.json
}

restore_required_source_files() {
  local relative
  while IFS= read -r relative; do
    [ -n "$relative" ] || continue
    if [ ! -s "$SRC_DIR/$relative" ] \
      && git -C "$SRC_DIR" ls-files --error-unmatch -- "$relative" >/dev/null 2>&1; then
      git -C "$SRC_DIR" checkout --ignore-skip-worktree-bits --force HEAD -- "$relative"
    fi
  done < <(required_source_files)
}

main() {
  require_root
  acquire_installer_lock
  require_debian
  require_supported_host_release
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
  if [ ! -x /usr/bin/node ] \
    || [ "$(/usr/bin/node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -lt 22 ]; then
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
    if [ -n "$domain" ] && ask_yes_no "域名 DNS 生效后，是否自动配置 Let's Encrypt HTTPS？" 'Y'; then
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
  # Export deployment settings inside a subshell instead of passing KEY=value
  # arguments to env, so the initial administrator password never enters argv.
  (
    # The outer installer owns the user-facing failure report. Do not inherit
    # its ERR trap into the deployment subshell or the same error is printed
    # twice.
    trap - ERR
    export APP_BASE="$APP_BASE"
    export SERVICE_NAME="$SERVICE_NAME"
    export LEGACY_SERVICE_NAME="$LEGACY_SERVICE_NAME"
    export HOST="127.0.0.1"
    export PORT="$deploy_port"
    export DOMAIN_NAME="$host"
    export ENABLE_HTTPS="$enable_https"
    export CORS_ORIGIN="$cors_origin"
    export UPLOAD_DIR="$upload_dir"
    export EXPORT_DIR="$export_dir"
    export BACKUP_DIR="$backup_dir"
    export DATABASE_DIR="$database_dir"
    if [ "$is_new_install" = '1' ]; then
      export INITIAL_SUPER_ADMIN_PHONE="$admin_phone"
      export INITIAL_SUPER_ADMIN_NAME="$admin_name"
      export INITIAL_SUPER_ADMIN_PASSWORD="$admin_password"
    fi
    bash "$SRC_DIR/scripts/deploy-ubuntu.sh"
  )

  CURRENT_STEP='配置持久化目录和运行环境'
  ENV_FILE="$APP_BASE/shared/.env"
  ensure_directory "$export_dir" "$APP_USER:$APP_USER" 750
  # Nginx serves non-export uploads directly; exports remain application-only.
  ensure_directory "$upload_dir" "$APP_USER:$APP_USER" 755
  ensure_directory "$backup_dir" root:root 750
  # PostgreSQL is provisioned by the existing deployment script. This directory is retained for DB operational artifacts.
  ensure_directory "$database_dir" postgres:postgres 700
  set_runtime_env_value UPLOAD_DIR "$upload_dir"
  set_runtime_env_value EXPORT_DIR "$export_dir"
  set_runtime_env_value BACKUP_DIR "$backup_dir"
  set_runtime_env_value DATABASE_DIR "$database_dir"
  if [ -z "$(read_env_value EXPORT_RETENTION_DAYS || true)" ]; then
    set_runtime_env_value EXPORT_RETENTION_DAYS "30"
  fi
  set_runtime_env_value APP_PUBLIC_URL "$origin"
  set_runtime_env_value CORS_ORIGIN "$cors_origin"
  if [ -z "$(read_env_value APP_PAIRING_SECRET || true)" ]; then
    set_runtime_env_value APP_PAIRING_SECRET "$(generate_secret)"
  fi
  if [ -z "$(read_env_value APP_PAIRING_TTL_MINUTES || true)" ]; then
    set_runtime_env_value APP_PAIRING_TTL_MINUTES "10"
  fi
  if [ -n "$firebase_service_account_base64" ]; then
    set_runtime_env_value FCM_SERVICE_ACCOUNT_JSON_BASE64 "$firebase_service_account_base64"
    set_runtime_env_value FCM_SERVICE_ACCOUNT_JSON ""
  fi

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
      set_runtime_env_value APP_PUBLIC_URL "$origin"
      set_runtime_env_value CORS_ORIGIN "https://localhost,$origin"
      if [ "$certbot_succeeded" != '1' ]; then
        echo 'Certbot 返回错误，但 Nginx 当前正在使用可读取且与域名匹配的证书。请检查证书有效期和 Certbot 日志。' >&2
      fi
    else
      origin="http://$host"
      set_runtime_env_value APP_PUBLIC_URL "$origin"
      set_runtime_env_value CORS_ORIGIN "https://localhost,$origin"
      echo '已安装的 Nginx 站点尚未启用 HTTPS，服务仍可通过 HTTP 访问。请检查 DNS 和 Certbot 日志后重试证书配置。' >&2
    fi
  fi

  CURRENT_STEP='配置 Android APK 下载地址'
  configure_default_apk_download_url "$existing_origin"

  CURRENT_STEP='执行最终就绪检查'
  local ready_port
  ready_port="$(read_env_value PORT || true)"
  ready_port="${ready_port:-3000}"
  [[ "$ready_port" =~ ^[0-9]+$ ]] && [ "$ready_port" -ge 1 ] && [ "$ready_port" -le 65535 ] \
    || die 'PORT 必须是 1 到 65535 之间的整数。'
  restart_after_runtime_config_change "$ready_port"
  wait_for_final_readiness "$ready_port"
  wait_for_public_proxy_readiness "$origin" "$host"
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
