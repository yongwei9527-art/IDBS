const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const upgrade = read('scripts/upgrade-postgresql.sh');
const deploy = read('scripts/deploy-ubuntu.sh');
const uninstall = read('scripts/uninstall-vps.sh');

test('PostgreSQL major upgrade defaults to the project-tested PostgreSQL 16 dump method', () => {
  assert.match(upgrade, /TARGET_POSTGRES_MAJOR="\$\{TARGET_POSTGRES_MAJOR:-16\}"/);
  assert.match(upgrade, /UPGRADE_METHOD="\$\{UPGRADE_METHOD:-dump\}"/);
  assert.match(upgrade, /pg_upgradecluster --method="\$UPGRADE_METHOD" -v "\$TARGET_POSTGRES_MAJOR"/);
});

test('upgrade requires explicit confirmation before backup, package installation, or migration', () => {
  const main = upgrade.slice(upgrade.indexOf('main() {'));
  const confirmation = main.indexOf('confirm_upgrade');
  const backup = main.indexOf('create_verified_backup');
  const install = main.indexOf('install_target_version');
  const migrate = main.indexOf('perform_upgrade');
  assert.ok(confirmation >= 0 && confirmation < backup);
  assert.ok(confirmation < install);
  assert.ok(confirmation < migrate);
  assert.match(upgrade, /CONFIRM_POSTGRES_UPGRADE:-}" = 'UPGRADE-POSTGRESQL'/);
});

test('upgrade serializes concurrent major-upgrade attempts with a root lock', () => {
  assert.match(upgrade, /LOCK_FILE="\$\{LOCK_FILE:-\/run\/lock\/laboratory-management-system-postgresql-upgrade\.lock\}"/);
  assert.match(upgrade, /flock -n 9 \|\| die 'Another PostgreSQL upgrade is already running\.'/);
});

test('upgrade creates and validates native database and global-object backups before installing target packages', () => {
  assert.match(upgrade, /--format custom --no-owner --no-acl --dbname "\$DATABASE_NAME"/);
  assert.match(upgrade, /"\$restore_tool" --list "\$database_tmp"/);
  assert.match(upgrade, /"\$dumpall_tool"[\s\S]*--globals-only/);
  assert.match(upgrade, /sha256sum "\$BACKUP_DIR\/\$\{DATABASE_NAME\}\.dump" "\$BACKUP_DIR\/globals\.sql"/);
  const main = upgrade.slice(upgrade.indexOf('main() {'));
  assert.ok(main.indexOf('create_verified_backup') < main.indexOf('install_target_version'));
});

test('upgrade protects unrelated databases and keeps old cluster for rollback', () => {
  assert.match(upgrade, /datname NOT IN \('postgres', '\$DATABASE_NAME'\)/);
  assert.match(upgrade, /restore_old_cluster/);
  assert.match(upgrade, /UPGRADE_VERIFIED/);
  assert.match(upgrade, /The unchanged PostgreSQL \$OLD_MAJOR cluster is retained/);
  assert.doesNotMatch(upgrade, /^\s*pg_dropcluster --stop "\$OLD_MAJOR"/m);
});

test('PGDG repository key is pinned to the official signing-key fingerprint', () => {
  assert.match(upgrade, /B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8/);
  assert.match(upgrade, /signed-by=%s/);
});

test('deployment installs and uninstall removes the PostgreSQL upgrade command', () => {
  assert.match(deploy, /POSTGRES_UPGRADE_COMMAND="\/usr\/local\/sbin\/laboratory-management-system-upgrade-postgresql"/);
  assert.match(deploy, /install_postgres_upgrade_command/);
  assert.match(uninstall, /\/usr\/local\/sbin\/laboratory-management-system-upgrade-postgresql/);
});
