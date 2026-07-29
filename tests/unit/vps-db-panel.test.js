const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panel = fs.readFileSync(path.resolve(__dirname, '../../scripts/vps-db-panel.sh'), 'utf8');
const installer = fs.readFileSync(path.resolve(__dirname, '../../scripts/install-vps.sh'), 'utf8');
const deploy = fs.readFileSync(path.resolve(__dirname, '../../scripts/deploy-ubuntu.sh'), 'utf8');

test('VPS db panel exposes the required three-item menu', () => {
  assert.match(panel, /1\) 查看连接地址和最高管理员临时凭据/);
  assert.match(panel, /2\) 重置最高管理员账号密码/);
  assert.match(panel, /3\) 退出/);
  assert.match(panel, /SUPER_ADMIN_PASSWORD="\$password"/);
});

test('VPS install information is root-only and temporary-password risk is explicit', () => {
  assert.match(panel, /install -o root -g root -m 600/);
  assert.match(panel, /PASSWORD_STATE=temporary_must_change/);
  assert.match(panel, /明文凭据仍有风险/);
  assert.match(installer, /最高管理员临时密码/);
  assert.match(installer, /首次登录后必须立即修改/);
});

test('deployment installs canonical update command and db panel', () => {
  assert.match(deploy, /UPDATE_COMMAND="\/usr\/local\/bin\/laboratory-management-system-update"/);
  assert.match(deploy, /DB_COMMAND="\/usr\/local\/bin\/db"/);
  assert.match(deploy, /install_db_panel/);
});