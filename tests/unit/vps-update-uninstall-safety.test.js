const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const update = read('scripts/update-vps.sh');
const updateEntry = read('scripts/update.sh');
const uninstall = read('scripts/uninstall-vps.sh');
const deploy = read('scripts/deploy-ubuntu.sh');

test('pre-update PostgreSQL backup never places DATABASE_URL or its password in pg_dump argv', () => {
  assert.ok(update.includes('ENV_FILE="$ENV_FILE" BACKUP_DIR="$database_backup_dir" \\\n    node "$SCRIPT_DIR/backup-database.js" --dir "$database_backup_dir" --keep-days "$retention"'));
  assert.doesNotMatch(update, /pg_dump\s+"?\$database_url"?/i);
  assert.doesNotMatch(update, /DATABASE_URL[^\n]*(?:pg_dump|--dbname)/i);
  assert.ok(update.includes('node "$SCRIPT_DIR/backup-database.js" --verify-latest --dir "$database_backup_dir"'));
  assert.ok(update.includes('PRE_MIGRATION_BACKUP_DIR="$VERIFIED_PRE_MIGRATION_BACKUP_DIR"'));
});

test('installer probes the highest administrator without exposing DATABASE_URL in process argv', () => {
  const installer = read('scripts/install.sh');
  assert.doesNotMatch(installer, /psql\s+"\$database_url"/);
  assert.match(installer, /ENV_FILE="\$ENV_FILE" APP_CURRENT="\$APP_CURRENT" node <<'NODE'/);
  assert.match(installer, /connectionString: process\.env\.DATABASE_URL/);
  assert.match(installer, /ar\.role_key = 'super_admin'/);
  assert.match(installer, /ar\.permissions \? '\*'/);
});

test('full-data uninstall validates confirmation and resolved paths before stopping services', () => {
  const confirmation = uninstall.indexOf('UNINSTALL_CONFIRMATION:-}');
  const symlinkCheck = uninstall.indexOf('traverses a symbolic link');
  const markerCheck = uninstall.indexOf('Installation ownership marker does not match APP_BASE');
  const firstStop = uninstall.indexOf('systemctl disable --now');
  assert.ok(confirmation >= 0 && confirmation < firstStop);
  assert.ok(symlinkCheck >= 0 && symlinkCheck < firstStop);
  assert.ok(markerCheck >= 0 && markerCheck < firstStop);
  assert.match(uninstall, /REMOVE_APP_DATA must be 0 or 1/);
  assert.ok(uninstall.includes('rm -rf --one-file-system -- "$resolved_app_base"'));
  assert.ok(uninstall.includes('rm -rf --one-file-system -- "$resolved_src_dir"'));
});

test('deployment records a root-only ownership marker for destructive uninstall', () => {
  assert.match(deploy, /INSTALL_OWNER_FILE="\$APP_SHARED\/installation-owner"/);
  assert.match(deploy, /install -o root -g root -m 600 "\$marker_temp" "\$INSTALL_OWNER_FILE"/);
  assert.match(deploy, /write_installation_owner_marker/);
});

test('installed update entrypoint preserves customized service and runtime ownership names', () => {
  for (const variable of ['SERVICE_NAME', 'LEGACY_SERVICE_NAME', 'APP_USER', 'APP_GROUP']) {
    assert.ok(updateEntry.includes(variable + '="$'));
  }
});
