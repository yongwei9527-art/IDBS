const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panel = fs.readFileSync(path.resolve(__dirname, '../../scripts/vps-db-panel.sh'), 'utf8');
const installer = fs.readFileSync(path.resolve(__dirname, '../../scripts/install.sh'), 'utf8');
const compatibilityInstaller = fs.readFileSync(path.resolve(__dirname, '../../scripts/install-vps.sh'), 'utf8');
const deploy = fs.readFileSync(path.resolve(__dirname, '../../scripts/deploy-ubuntu.sh'), 'utf8');
const prepare = fs.readFileSync(path.resolve(__dirname, '../../scripts/prepare-vps.sh'), 'utf8');
const update = fs.readFileSync(path.resolve(__dirname, '../../scripts/update-vps.sh'), 'utf8');
const backup = fs.readFileSync(path.resolve(__dirname, '../../scripts/backup.sh'), 'utf8');
const common = fs.readFileSync(path.resolve(__dirname, '../../deploy/vps-common.sh'), 'utf8');
const firebase = fs.readFileSync(path.resolve(__dirname, '../../scripts/configure-firebase.sh'), 'utf8');
const uninstall = fs.readFileSync(path.resolve(__dirname, '../../scripts/uninstall-vps.sh'), 'utf8');
const localDbPasswordHelper = fs.readFileSync(path.resolve(__dirname, '../../scripts/set-local-db-role-password.js'), 'utf8');
const legacyBackup = fs.readFileSync(path.resolve(__dirname, '../../scripts/backup-database.sh'), 'utf8');
const doctor = fs.readFileSync(path.resolve(__dirname, '../../scripts/doctor.js'), 'utf8');
const resetAdmin = fs.readFileSync(path.resolve(__dirname, '../../scripts/reset-admin-password.js'), 'utf8');

test('VPS db panel exposes the required three-item menu', () => {
  assert.match(panel, /1\) 查看连接地址和最高管理员临时凭据/);
  assert.match(panel, /2\) 重置最高管理员账号密码/);
  assert.match(panel, /3\) 退出/);
  assert.match(panel, /SUPER_ADMIN_PASSWORD="\$password"/);
  assert.match(panel, /请选择 \[1-3\]: " choice <\/dev\/tty/);
});

test('VPS install information is root-only and temporary-password risk is explicit', () => {
  assert.match(panel, /install -o root -g root -m 600/);
  assert.match(panel, /PASSWORD_STATE=temporary_must_change/);
  assert.match(panel, /明文凭据仍有风险/);
  assert.match(installer, /最高管理员密码/);
  assert.match(installer, /首次登录后立即修改/);
});

test('VPS installer defaults to generated admin passwords and retries manual input safely', () => {
  assert.match(installer, /是否由系统自动生成最高管理员密码？（推荐；安装完成后仅显示一次）' 'Y'/);
  assert.match(installer, /终端不会显示字符、圆点或星号/);
  assert.match(installer, /两次输入的密码不一致，请重新输入；安装不会退出/);
  assert.match(installer, /while true; do[\s\S]*continue[\s\S]*break/);
  assert.doesNotMatch(installer, /die '两次输入的密码不一致/);
});

test('deployment installs canonical update command and db panel', () => {
  assert.match(deploy, /UPDATE_COMMAND="\/usr\/local\/bin\/laboratory-management-system-update"/);
  assert.match(deploy, /DB_COMMAND="\/usr\/local\/bin\/db"/);
  assert.match(deploy, /install_db_panel/);
  assert.match(deploy, /PostgreSQL 15\+/);
});

test('VPS installation has one canonical entrypoint and one canonical service name', () => {
  assert.match(compatibilityInstaller, /exec bash "\$LOCAL_INSTALLER"/);
  assert.match(compatibilityInstaller, /scripts\/install\.sh/);
  assert.match(deploy, /SERVICE_NAME="\$\{SERVICE_NAME:-laboratory-management-system\}"/);
  assert.match(deploy, /LEGACY_SERVICE_NAME="\$\{LEGACY_SERVICE_NAME:-laboratory_management_system\}"/);
  assert.match(prepare, /raw\.githubusercontent\.com\/yongwei9527-art\/IDBS\/main\/scripts\/install\.sh/);
  assert.doesNotMatch(prepare, /main\/scripts\/install-vps\.sh/);
});

test('interrupted first installation preserves credentials and records final connection info', () => {
  assert.match(installer, /\.initial-super-admin-pending/);
  assert.match(installer, /install -o root -g root -m 600/);
  assert.match(installer, /检测到未完成的安装/);
  assert.match(installer, /数据库中不存在最高管理员/);
  assert.match(installer, /\/usr\/local\/bin\/db --record/);
  assert.match(installer, /rm -f "\$PENDING_ADMIN_FILE"/);
  assert.match(installer, /安装在以下步骤失败/);
  assert.doesNotMatch(installer, /RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA=0 bash/);
});

test('custom persistent directories reach Nginx, backups, and the deployed environment', () => {
  assert.match(installer, /UPLOAD_DIR="\$upload_dir"/);
  assert.match(installer, /EXPORT_DIR="\$export_dir"/);
  assert.match(installer, /BACKUP_DIR="\$backup_dir"/);
  assert.match(deploy, /existing_uploads:-\$APP_BASE\/uploads/);
  assert.match(deploy, /existing_exports:-\$APP_BASE\/exports/);
  assert.match(deploy, /existing_backups:-\$APP_BASE\/backups/);
  assert.match(deploy, /mkdir -p -- .*"\$APP_UPLOADS" "\$APP_EXPORTS" "\$APP_BACKUPS" "\$APP_DATABASE_OPS"/);
  assert.match(deploy, /User=root\nGroup=root\nUMask=0077\nEnvironmentFile=\$ENV_FILE/);
  assert.match(deploy, /Environment=APP_BASE=\$APP_BASE/);
  assert.match(deploy, /Environment=APP_CURRENT=\$APP_CURRENT/);
  assert.match(deploy, /Environment=ENV_FILE=\$ENV_FILE/);
  assert.match(deploy, /ExecStart=\/bin\/bash \$APP_CURRENT\/scripts\/backup\.sh/);
  assert.doesNotMatch(deploy, /ExecStart=.*pg_dump/);
  assert.match(backup, /archive_directory "\$upload_dir" uploads/);
  assert.match(backup, /archive_directory "\$export_dir" exports/);
});

test('VPS directory validation rejects dangerous and nested targets', () => {
  assert.match(common, /canonicalize_absolute_dir/);
  assert.match(common, /validate_managed_root/);
  assert.match(common, /validate_disjoint_directories/);
  assert.match(common, /must be separate, non-nested directories/);
  assert.match(common, /\/home\|\/lib/);
  assert.match(common, /\/media\|\/mnt\|\/opt/);
  assert.match(common, /\/sbin\/\*\|\/srv\|\/sys/);
  assert.match(common, /\/var\/lib\|\/var\/lib\/postgresql/);
  assert.match(common, /\/var\/lib\/postgresql/);
  assert.match(installer, /数据库运维文件目录（不是 PostgreSQL PGDATA）/);
  assert.match(prepare, /realpath -m -s --/);
  assert.match(prepare, /rm -rf --one-file-system --/);
  assert.match(prepare, /RESET_CONFIRMATION=DELETE-LABORATORY-MANAGEMENT-SYSTEM-DATA/);
  assert.match(uninstall, /UNINSTALL_CONFIRMATION=DELETE-LABORATORY-MANAGEMENT-SYSTEM/);
});

test('remote uninstall is root-only, self-contained, and removes all installed control commands', () => {
  assert.match(uninstall, /require_root/);
  assert.match(uninstall, /TEMP_COMMON_HELPER/);
  assert.match(uninstall, /curl -fsSL "\$RAW_BASE_URL\/deploy\/vps-common\.sh"/);
  assert.match(uninstall, /grep -Fq 'vps-db-panel\.sh' \/usr\/local\/bin\/db/);
  assert.match(uninstall, /rm -f -- \/usr\/local\/bin\/db/);
  assert.match(uninstall, /systemctl stop "\$\{service\}-backup\.service"/);
  assert.match(uninstall, /validate_managed_root "\$SRC_DIR" 'Source directory'/);
  assert.match(uninstall, /rm -rf --one-file-system -- "\$resolved_src_dir"/);
  assert.match(uninstall, /Custom upload, export, backup, or database-operation directories outside the application base were preserved/);
});

test('VPS environment and local database password updates avoid shell and SQL interpolation', () => {
  assert.match(common, /awk -v key="\$key" -v value_file="\$value_file"/);
  assert.doesNotMatch(deploy, /sed -i/);
  assert.match(deploy, /decodeURIComponent\(parsed\.password\)/);
  assert.match(deploy, /printf '%s' "\$password"[\s\S]*set-local-db-role-password\.js" "\$operation"/);
  assert.doesNotMatch(deploy, /\\prompt db_password/);
  assert.doesNotMatch(deploy, /PASSWORD '\$\{db_password\}'/);
  assert.match(localDbPasswordHelper, /fs\.readFileSync\(0, 'utf8'\)/);
  assert.match(localDbPasswordHelper, /format\('[^']*PASSWORD %L', \$1::text\)/);
  assert.match(localDbPasswordHelper, /\[password\]/);
  assert.doesNotMatch(localDbPasswordHelper, /process\.argv\[[^\]]+\].*password/i);
  assert.match(deploy, /数据库角色辅助文件缺失，正在使用内置安全回退流程/);
  assert.match(deploy, /NODE_PATH="\$CANDIDATE_RELEASE\/node_modules" node -e/);
  assert.match(deploy, /fs\.readFileSync\(0, "utf8"\)/);
  assert.match(deploy, /format\(\$fmt\$\$\{operation\} ROLE \$\{roleName\} WITH LOGIN PASSWORD %L\$fmt\$, \$1::text\)/);
  assert.match(firebase, /value_file="\$\(mktemp/);
});

test('VPS secrets stay out of argv and dotenv files are parsed instead of shell-sourced', () => {
  assert.match(installer, /export INITIAL_SUPER_ADMIN_PASSWORD="\$admin_password"/);
  assert.doesNotMatch(installer, /env "\$\{deploy_env\[@\]\}"/);
  assert.doesNotMatch(deploy, /\. "\$ENV_FILE"/);
  assert.doesNotMatch(legacyBackup, /source .*\.env/);
  assert.match(legacyBackup, /export ENV_FILE=/);
  assert.match(doctor, /process\.env\.ENV_FILE/);
  assert.match(resetAdmin, /process\.env\.ENV_FILE/);
  assert.doesNotMatch(resetAdmin, /process\.argv\[2\]/);
  assert.doesNotMatch(deploy, /reset-admin-password 'NewStrongPassword123'/);
  assert.match(deploy, /Do not pass a password as a command-line argument/);
});

test('VPS updates honor custom uploads and preserve export retention settings', () => {
  assert.match(update, /backup_before_update "\$upload_dir" "\$export_dir"/);
  assert.match(update, /dirname "\$upload_dir"/);
  assert.match(update, /pre-update-exports-/);
  assert.match(update, /dirname "\$export_dir"/);
  assert.doesNotMatch(update, /-C "\$APP_BASE" uploads/);
  assert.match(update, /show-ref --verify --quiet "refs\/tags\/\$RELEASE_REF"/);
  assert.match(deploy, /EXPORT_RETENTION_DAYS=30/);
  assert.match(deploy, /EXPORT_RETENTION_DAYS must be a whole number from 1 to 3650/);
  assert.match(deploy, /BACKUP_RETENTION_DAYS=14/);
  assert.match(deploy, /BACKUP_RETENTION_DAYS must be a whole number from 1 to 3650/);
  assert.match(update, /set_env_value EXPORT_RETENTION_DAYS 30/);
  assert.match(backup, /validate_disjoint_directories/);
  assert.match(backup, /-mtime \+"\$retention" -delete/);
});

test('APK delivery defaults to the matching GitHub release and preserves self-hosted packages on update', () => {
  assert.match(common, /github_release_apk_url()/);
  assert.match(common, /Laboratory-Management-System-v%s\.apk/);
  assert.match(installer, /configure_default_apk_download_url()/);
  assert.match(installer, /set_env_value APK_DOWNLOAD_URL_MANAGED "\$managed_mode"/);
  assert.match(installer, /previous_origin/);
  assert.match(installer, /\$\{previous_origin%\/\}\/download\/app\.apk/);
  assert.match(installer, /Android APK：%s/);
  assert.match(update, /refresh_managed_apk_download_url()/);
  assert.match(deploy, /--exclude 'public\/download\/'/);
});

test('VPS installer preserves existing public URL, directories, and pairing TTL on rerun', () => {
  assert.match(installer, /existing_origin="\$\(read_env_value APP_PUBLIC_URL/);
  assert.match(installer, /已保留现有 HTTPS 公网地址/);
  assert.match(installer, /enable_https=1/);
  assert.match(installer, /existing_export_dir="\$\(read_env_value EXPORT_DIR/);
  assert.match(installer, /existing_upload_dir="\$\(read_env_value UPLOAD_DIR/);
  assert.match(installer, /existing_backup_dir="\$\(read_env_value BACKUP_DIR/);
  assert.match(installer, /existing_database_dir="\$\(read_env_value DATABASE_DIR/);
  assert.match(installer, /if \[ -z "\$\(read_env_value APP_PAIRING_TTL_MINUTES/);
  assert.match(installer, /show-ref --verify --quiet "refs\/tags\/\$BRANCH"/);
  assert.match(installer, /checkout --detach "refs\/tags\/\$BRANCH"/);
});

test('VPS installer supports a domain-free install and secure defaults for blank admin input', () => {
  assert.match(installer, /DEFAULT_ADMIN_PHONE="\$\{DEFAULT_ADMIN_PHONE:-13900000000\}"/);
  assert.match(installer, /ask_value '最高管理员手机号\/登录账号' "\$DEFAULT_ADMIN_PHONE"/);
  assert.match(installer, /admin_password="\$generated_password"/);
  assert.match(installer, /当前没有可用的交互终端/);
  assert.match(common, /generate_password\(\)[\s\S]*openssl rand -hex 12/);
  assert.match(common, /is_ipv4\(\)/);
  assert.match(common, /is_non_public_ipv4\(\)/);
  assert.match(installer, /server_ip="\$\(detect_public_ip \|\| true\)"/);
  assert.match(installer, /ip_was_auto_detected=1/);
  assert.match(installer, /仅自动检测到内网\/LAN IPv4/);
  assert.match(installer, /无人值守安装需要公网 IPv4 或域名/);
  assert.match(installer, /origin="http:\/\/\$host"/);
  assert.match(installer, /DOMAIN_NAME="\$\{domain:-_\}"/);
  assert.match(installer, /if \[ "\$enable_https" = '1' \]; then/);
});

test('VPS redeploy keeps HTTPS available when a managed certificate already exists', () => {
  assert.match(common, /find_letsencrypt_live_dir\(\)/);
  assert.match(common, /letsencrypt_paths_match_domain\(\)/);
  assert.match(common, /\^\[0-9\]\+\$/);
  assert.match(deploy, /existing_certificate/);
  assert.match(deploy, /fullchain\.pem/);
  assert.match(deploy, /privkey\.pem/);
  assert.match(deploy, /listen 443 ssl/);
  assert.match(deploy, /return 301 https:\/\/\\\$host\\\$request_uri/);
  assert.match(installer, /nginx_domain_uses_https/);
  assert.match(installer, /certbot_succeeded=0/);
  assert.match(installer, /origin="http:\/\/\$host"/);
  assert.match(deploy, /ssl_certificate_key/);
  assert.match(deploy, /nginx_backup_dir/);
  assert.match(deploy, /cp -a --parents/);
  assert.match(deploy, /cp -a -- "\$nginx_backup_dir\/etc\/nginx\/\." \/etc\/nginx\//);
  assert.match(deploy, /if ! nginx -t/);
});

test('VPS rerun refreshes db panel addresses without replacing administrator credentials', () => {
  assert.match(installer, /\/usr\/local\/bin\/db --record-addresses/);
  assert.match(panel, /--record-addresses\) record_addresses_from_stdin/);
  assert.match(panel, /validate_install_addresses/);
  assert.match(panel, /phone="\$\(read_info_value SUPER_ADMIN_PHONE\)"/);
  assert.match(panel, /temporary_password="\$\(read_info_value SUPER_ADMIN_TEMP_PASSWORD\)"/);
  assert.match(panel, /PASSWORD_STATE=%s/);
  assert.match(panel, /mv -f "\$tmp" "\$INFO_FILE"/);
  assert.match(panel, /credentials_not_recorded/);
  assert.match(panel, /Legacy installation detected/);
});

test('VPS runtime stays behind Nginx and preserves the configured port', () => {
  assert.match(deploy, /HOST="\$\{HOST:-127\.0\.0\.1\}"/);
  assert.match(deploy, /set_env_value HOST "\$HOST"/);
  assert.match(deploy, /set_env_value PORT "\$PORT"/);
  assert.match(update, /PORT="\$port"/);
  assert.match(update, /HOST="127\.0\.0\.1"/);
  assert.match(deploy, /HOST must be 127\.0\.0\.1/);
});

test('installer explicitly controls HTTPS and probes every configured PostgreSQL database', () => {
  assert.match(installer, /ENABLE_HTTPS="\$enable_https"/);
  assert.match(deploy, /ENABLE_HTTPS="\$\{ENABLE_HTTPS:-auto\}"/);
  assert.match(deploy, /"\$ENABLE_HTTPS" != '0'/);
  assert.doesNotMatch(installer, /External\/custom PostgreSQL detected/);
  assert.doesNotMatch(installer, /return 3/);
  assert.match(installer, /connectionString: process\.env\.DATABASE_URL/);
  assert.doesNotMatch(installer, /psql "\$database_url"/);
});

test('canonical and legacy systemd names remain compatible without exposing deployment secrets', () => {
  assert.match(deploy, /ln -sfn "\$\{SERVICE_NAME\}\.service"/);
  assert.match(deploy, /ln -sfn "\$\{SERVICE_NAME\}-backup\.timer"/);
  assert.match(firebase, /for service in "\$SERVICE_NAME" "\$LEGACY_SERVICE_NAME"/);
  assert.doesNotMatch(deploy, /echo .*DB_PASSWORD/);
  assert.doesNotMatch(installer, /echo .*APP_PAIRING_SECRET/);
});
