#!/usr/bin/env bash
set -euo pipefail

APP_BASE="${APP_BASE:-/var/www/laboratory-management-system}"
APP_CURRENT="${APP_CURRENT:-$APP_BASE/current}"
ENV_FILE="${ENV_FILE:-$APP_BASE/shared/.env}"
INFO_FILE="${INSTALL_INFO_FILE:-$APP_BASE/shared/install-info}"

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "请使用 sudo db 运行 VPS 管理面板。" >&2
    exit 1
  fi
}

read_info_value() {
  local key="$1"
  [ -f "$INFO_FILE" ] || return 0
  awk -v prefix="${key}=" 'index($0, prefix) == 1 { value = substr($0, length(prefix) + 1) } END { print value }' "$INFO_FILE"
}

generate_password() {
  printf 'IDBS!%s' "$(openssl rand -hex 8)"
}

validate_credentials() {
  local phone="$1" name="$2" password="$3"
  [[ "$phone" =~ ^\+?[0-9-]{6,20}$ ]] || { echo "登录账号必须为 6–20 位数字，可包含开头的 + 或连字符。" >&2; return 1; }
  [ -n "$name" ] && [ "${#name}" -le 50 ] || { echo "最高管理员姓名不能为空且不能超过 50 个字符。" >&2; return 1; }
  [ "${#password}" -ge 12 ] && [ "${#password}" -le 128 ] || {
    echo "临时密码必须为 12–128 个字符。" >&2
    return 1
  }
}

write_install_info() {
  local app_server_address="$1" web_access_url="$2" phone="$3" name="$4" temporary_password="$5"
  local tmp
  validate_credentials "$phone" "$name" "$temporary_password"
  mkdir -p "$(dirname "$INFO_FILE")"
  chown root:root "$(dirname "$INFO_FILE")"
  chmod 700 "$(dirname "$INFO_FILE")"
  tmp="$(mktemp)"
  chmod 600 "$tmp"
  {
    printf 'APP_SERVER_ADDRESS=%s\n' "$app_server_address"
    printf 'WEB_ACCESS_URL=%s\n' "$web_access_url"
    printf 'SUPER_ADMIN_PHONE=%s\n' "$phone"
    printf 'SUPER_ADMIN_NAME=%s\n' "$name"
    printf 'SUPER_ADMIN_TEMP_PASSWORD=%s\n' "$temporary_password"
    printf 'PASSWORD_STATE=temporary_must_change\n'
    printf 'UPDATED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$tmp"
  if ! install -o root -g root -m 600 "$tmp" "$INFO_FILE"; then
    rm -f "$tmp"
    return 1
  fi
  rm -f "$tmp"
}

record_from_stdin() {
  local app_server_address web_access_url phone name temporary_password
  IFS= read -r app_server_address
  IFS= read -r web_access_url
  IFS= read -r phone
  IFS= read -r name
  IFS= read -r temporary_password
  write_install_info "$app_server_address" "$web_access_url" "$phone" "$name" "$temporary_password"
}

show_install_info() {
  if [ ! -f "$INFO_FILE" ]; then
    echo "尚未找到安装信息：$INFO_FILE"
    return 0
  fi

  echo
  echo "=== 实验室管理系统连接信息 ==="
  printf 'App 服务器连接地址：%s\n' "$(read_info_value APP_SERVER_ADDRESS)"
  printf '网页访问地址：%s\n' "$(read_info_value WEB_ACCESS_URL)"
  printf '最高管理员账号：%s\n' "$(read_info_value SUPER_ADMIN_PHONE)"
  printf '最高管理员姓名：%s\n' "$(read_info_value SUPER_ADMIN_NAME)"
  printf '最近生成的临时密码：%s\n' "$(read_info_value SUPER_ADMIN_TEMP_PASSWORD)"
  printf '更新时间：%s\n' "$(read_info_value UPDATED_AT)"
  echo "安全提示：临时密码以 root-only（600）文件保存，但明文凭据仍有风险。"
  echo "首次或重置后登录必须立即修改密码；修改后，上述临时密码可能已失效。"
  echo "信息文件：$INFO_FILE"
}

ask_value() {
  local prompt="$1" default="${2:-}" reply
  read -r -p "${prompt}${default:+ [$default]}: " reply
  printf '%s' "${reply:-$default}"
}

ask_temporary_password() {
  local generated first second
  generated="$(generate_password)"
  printf '已生成默认强临时密码：%s\n' "$generated" >&2
  printf '直接按 Enter 使用默认密码，或输入 12–128 位自定义密码。\n' >&2
  read -r -s -p "新临时密码: " first
  echo >&2
  first="${first:-$generated}"
  if [ "$first" != "$generated" ]; then
    read -r -s -p "再次输入新临时密码: " second
    echo >&2
    [ "$first" = "$second" ] || { echo "两次密码不一致。" >&2; return 1; }
  fi
  printf '%s' "$first"
}

reset_super_admin() {
  [ -f "$ENV_FILE" ] || { echo "环境文件不存在：$ENV_FILE" >&2; return 1; }
  [ -f "$APP_CURRENT/scripts/provision-super-admin.js" ] || {
    echo "最高管理员初始化脚本不存在：$APP_CURRENT/scripts/provision-super-admin.js" >&2
    return 1
  }

  local current_phone current_name phone name password force_transfer=0 reply
  current_phone="$(read_info_value SUPER_ADMIN_PHONE)"
  current_name="$(read_info_value SUPER_ADMIN_NAME)"
  phone="$(ask_value "最高管理员手机号/登录账号" "$current_phone")"
  name="$(ask_value "最高管理员姓名" "${current_name:-系统管理员}")"
  password="$(ask_temporary_password)"
  validate_credentials "$phone" "$name" "$password"

  if [ -n "$current_phone" ] && [ "$phone" != "$current_phone" ]; then
    read -r -p "这将转移最高管理员身份到 ${phone}，确认继续？[y/N]: " reply
    case "$reply" in
      [Yy]*) force_transfer=1 ;;
      *) echo "已取消。"; return 0 ;;
    esac
  fi

  ENV_FILE="$ENV_FILE" \
  APP_BASE="$APP_BASE" \
  SUPER_ADMIN_PHONE="$phone" \
  SUPER_ADMIN_NAME="$name" \
  SUPER_ADMIN_PASSWORD="$password" \
  SUPER_ADMIN_FORCE_TRANSFER="$force_transfer" \
    node "$APP_CURRENT/scripts/provision-super-admin.js"

  write_install_info \
    "$(read_info_value APP_SERVER_ADDRESS)" \
    "$(read_info_value WEB_ACCESS_URL)" \
    "$phone" "$name" "$password"

  echo "最高管理员临时凭据已更新。该账号下次登录必须修改密码。"
  show_install_info
}

menu() {
  while true; do
    echo
    echo "=== 实验室管理系统 VPS 管理面板 ==="
    echo "1) 查看连接地址和最高管理员临时凭据"
    echo "2) 重置最高管理员账号密码"
    echo "3) 退出"
    read -r -p "请选择 [1-3]: " choice
    case "$choice" in
      1) show_install_info ;;
      2) reset_super_admin ;;
      3) exit 0 ;;
      *) echo "请输入 1、2 或 3。" ;;
    esac
  done
}

main() {
  require_root
  case "${1:-}" in
    --record) record_from_stdin ;;
    --show) show_install_info ;;
    --help|-h)
      echo "用法：sudo db"
      echo "打开 VPS 管理面板，查看连接信息或重置最高管理员临时凭据。"
      ;;
    '') menu ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
}

main "$@"
