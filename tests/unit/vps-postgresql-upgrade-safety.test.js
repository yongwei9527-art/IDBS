const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const upgrade = read('scripts/upgrade-postgresql.sh');
const deploy = read('scripts/deploy-ubuntu.sh');
const prepare = read('scripts/prepare-vps.sh');
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

test('upgrade protects unrelated databases and retains the old cluster until all rollback gates pass', () => {
  assert.match(upgrade, /datname NOT IN \('postgres', '\$DATABASE_NAME'\)/);
  assert.match(upgrade, /restore_old_cluster/);
  assert.match(upgrade, /UPGRADE_VERIFIED/);
  const perform = upgrade.slice(upgrade.indexOf('perform_upgrade() {'), upgrade.indexOf('\nmain() {'));
  const verifyApp = perform.indexOf('verify_application');
  const verifyBackup = perform.indexOf('verify_target_backup_and_tools');
  const verified = perform.indexOf('UPGRADE_VERIFIED=1');
  assert.ok(verifyApp >= 0 && verifyApp < verified);
  assert.ok(verifyBackup >= 0 && verifyBackup < verified);
  assert.match(upgrade, /\[ "\$UPGRADE_VERIFIED" = '1' \][\s\\\n]+\|\| die 'Internal safety check refused to delete the old PostgreSQL/);
});

test('successful replacement removes only the exact old cluster and version-specific packages', () => {
  assert.match(upgrade, /REMOVE_OLD_POSTGRES_AFTER_SUCCESS="\$\{REMOVE_OLD_POSTGRES_AFTER_SUCCESS:-1\}"/);
  assert.match(upgrade, /pg_dropcluster --stop "\$OLD_MAJOR" "\$CLUSTER_NAME"/);
  assert.match(upgrade, /remaining_old_clusters=.*pg_lsclusters/);
  assert.match(upgrade, /apt-get purge -y -- "\$\{packages\[@\]\}"/);
  assert.doesNotMatch(upgrade, /apt-get (?:auto)?remove/);
  assert.doesNotMatch(upgrade, /rm\s+-rf[^\n]*(?:postgresql|OLD_MAJOR)/);
  assert.match(upgrade, /Target cluster stopped responding during old-package cleanup/);
  assert.match(upgrade, /application failed its final readiness check after old-package cleanup/);
  const main = upgrade.slice(upgrade.indexOf('main() {'));
  assert.ok(main.indexOf('perform_upgrade') < main.indexOf('remove_old_postgresql'));
});

test('replacement pins future backup and restore tools to PostgreSQL 16 and verifies a post-upgrade dump', () => {
  assert.match(upgrade, /set_env_value PG_DUMP_PATH "\$dump_tool"/);
  assert.match(upgrade, /set_env_value PG_RESTORE_PATH "\$restore_tool"/);
  assert.match(upgrade, /postgresql-\$\{TARGET_POSTGRES_MAJOR\}-verified\.dump/);
  assert.match(upgrade, /"\$restore_tool" --list "\$post_dump"/);
  assert.match(upgrade, /sha256sum --check SHA256SUMS/);
});

test('upgrade accepts the project extensions and compares all public table row counts before deletion', () => {
  assert.match(upgrade, /extname NOT IN \('plpgsql', 'pgcrypto', 'btree_gist'\)/);
  assert.match(upgrade, /pg_available_extensions/);
  assert.match(upgrade, /create_database_inventory/);
  assert.match(upgrade, /EXECUTE format\('SELECT count\(\*\) FROM %I\.%I'/);
  assert.match(upgrade, /compare_database_inventories/);
  const perform = upgrade.slice(upgrade.indexOf('perform_upgrade() {'), upgrade.indexOf('\nmain() {'));
  assert.ok(perform.indexOf('compare_database_inventories') < perform.indexOf('UPGRADE_VERIFIED=1'));
});

test('upgrade keeps safety backups outside PostgreSQL data roots and simulates package cleanup first', () => {
  assert.match(upgrade, /\/var\/lib\/postgresql\/\*/);
  assert.match(upgrade, /BACKUP_ROOT must be outside the old PostgreSQL data directory/);
  assert.match(upgrade, /apt-get -s purge -y -- "\$\{packages\[@\]\}"/);
  assert.match(upgrade, /postgresql-client-common/);
  assert.match(upgrade, /APT simulation would also remove unrelated package/);
  assert.match(upgrade, /"postgresql-contrib-\$TARGET_POSTGRES_MAJOR"/);
});

test('PGDG repository key is pinned to the official signing-key fingerprint', () => {
  assert.match(upgrade, /B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8/);
  assert.match(upgrade, /signed-by=%s/);
});

test('PGDG setup distinguishes mirror DNS failures from unsupported distributions and uses official fallbacks', () => {
  for (const script of [upgrade, deploy]) {
    assert.match(script, /https:\/\/apt\.postgresql\.org\/pub\/repos\/apt/);
    assert.match(script, /https:\/\/download\.postgresql\.org\/pub\/repos\/apt/);
    assert.match(script, /https:\/\/ftp\.postgresql\.org\/pub\/repos\/apt/);
    assert.match(script, /https:\/\/apt-archive\.postgresql\.org\/pub\/repos\/apt/);
    assert.match(script, /\$\{codename\}-pgdg-archive/);
    assert.match(script, /DNS\/network problem, not proof that .* is unsupported/);
    assert.doesNotMatch(script, /repository does not support this OS codename/);
    assert.match(script, /key_url="\$pgdg_base\/ACCC4CF8\.asc"/);
    assert.match(script, /www\.postgresql\.org\/media\/keys\/ACCC4CF8\.asc/);
  }
});

test('PGDG setup replaces conflicting legacy sources and requires an installable package candidate', () => {
  for (const script of [upgrade, deploy]) {
    assert.match(script, /apt_package_has_candidate\(\)/);
    assert.match(script, /apt-cache policy "\$1"/);
    assert.match(script, /disable_conflicting_pgdg_sources\(\)/);
    assert.match(script, /Disabled conflicting PGDG source/);
    assert.match(script, /\.laboratory-management-system-backup/);
    assert.match(script, /Dir::Etc::sourcelist=\$repo_file/);
    assert.match(script, /Dir::Etc::sourceparts=-/);
    assert.match(script, /obsolete indexes|apt-get update\n/);
    assert.match(script, /no installable APT candidate|is unavailable after configuring PGDG/);
  }
  assert.doesNotMatch(upgrade, /apt-cache show "postgresql-\$TARGET_POSTGRES_MAJOR"/);
  assert.doesNotMatch(deploy, /apt-cache show postgresql-16/);
  assert.match(upgrade, /Do not trust a candidate from stale package indexes/);
  assert.match(deploy, /stale APT[\s\S]*enabled repository still points at an unreachable hostname/);
});

test('deployment installs and uninstall removes the PostgreSQL upgrade command', () => {
  assert.match(deploy, /POSTGRES_UPGRADE_COMMAND="\/usr\/local\/sbin\/laboratory-management-system-upgrade-postgresql"/);
  assert.match(deploy, /install_postgres_upgrade_command/);
  assert.match(uninstall, /\/usr\/local\/sbin\/laboratory-management-system-upgrade-postgresql/);
});

test('deployment pins PostgreSQL 16 on both fresh and existing installs and upgrades managed older clusters', () => {
  assert.match(deploy, /apt-get install -y postgresql-16 postgresql-client-16/);
  assert.match(deploy, /apt-get install -y postgresql-contrib-16/);
  assert.doesNotMatch(deploy, /apt-get install -y postgresql postgresql-client/);
  assert.match(deploy, /upgrade_managed_local_postgres_if_required/);
  assert.match(deploy, /CONFIRM_POSTGRES_UPGRADE=UPGRADE-POSTGRESQL/);
  assert.match(deploy, /REMOVE_OLD_POSTGRES_AFTER_SUCCESS=1/);
  const main = deploy.slice(deploy.indexOf('main() {'));
  assert.ok(main.indexOf('ensure_env') < main.indexOf('upgrade_managed_local_postgres_if_required'));
  assert.ok(main.indexOf('upgrade_managed_local_postgres_if_required') < main.indexOf('verify_local_postgres_target'));
  assert.doesNotMatch(prepare, /apt-get install -y[^\n]*\bpostgresql\s+postgresql-client\b/);
  assert.match(prepare, /postgresql-common/);
});
