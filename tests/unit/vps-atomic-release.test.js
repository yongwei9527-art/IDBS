const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const deploy = read('scripts/deploy-ubuntu.sh');
const update = read('scripts/update-vps.sh');
const prepare = read('scripts/prepare-vps.sh');
const common = read('deploy/vps-common.sh');
const service = read('deploy/laboratory-management-system.service');

function ordered(source, snippets) {
  let cursor = -1;
  for (const snippet of snippets) {
    const next = source.indexOf(snippet, cursor + 1);
    assert.ok(next > cursor, `expected ordered snippet: ${snippet}`);
    cursor = next;
  }
}

test('deployment builds an isolated release before interrupting the current service', () => {
  const main = deploy.slice(deploy.lastIndexOf('\nmain() {'));
  assert.match(deploy, /APP_RELEASES="\$APP_BASE\/releases"/);
  assert.match(deploy, /CANDIDATE_RELEASE="\$APP_RELEASES\/\$RELEASE_ID"/);
  assert.match(deploy, /"\$ROOT_DIR\/" "\$CANDIDATE_RELEASE\/"/);
  assert.doesNotMatch(deploy, /"\$ROOT_DIR\/" "\$APP_CURRENT\/"/);
  assert.match(deploy, /chown -R root:root "\$CANDIDATE_RELEASE"/);
  assert.match(deploy, /chmod -R go-w "\$CANDIDATE_RELEASE"/);
  ordered(main, [
    'prepare_candidate_release',
    'npm --prefix "$CANDIDATE_RELEASE" ci --omit=dev',
    'build_v3_frontend',
    'ensure_verified_pre_migration_backup',
    'stop_application_for_migration',
    'apply_database_schema',
    'activate_candidate_release',
    'systemctl restart "$SERVICE_NAME"',
    'verify_service_health'
  ]);
});

test('update creates, verifies, and passes one reusable pre-migration backup', () => {
  ordered(update, [
    'node "$SCRIPT_DIR/backup-database.js" --dir "$database_backup_dir" --keep-days "$retention"',
    'node "$SCRIPT_DIR/backup-database.js" --verify-latest --dir "$database_backup_dir"',
    'VERIFIED_PRE_MIGRATION_BACKUP_DIR="$database_backup_dir"',
    'update_source',
    'PRE_MIGRATION_BACKUP_DIR="$VERIFIED_PRE_MIGRATION_BACKUP_DIR"'
  ]);
  assert.match(deploy, /Reusing and re-verifying the pre-update database backup/);
  assert.match(deploy, /PRE_MIGRATION_BACKUP_DIR must be inside the configured backup directory/);
});

test('current and previous are replaced with same-filesystem atomic symbolic links', () => {
  assert.match(common, /mktemp -d "\$link_parent\/\.release-link\.XXXXXX"/);
  assert.match(common, /ln -s -- "\$target" "\$temp_link"/);
  assert.match(common, /mv -Tf -- "\$temp_link" "\$link_path"/);
  ordered(deploy, [
    'atomic_symlink_replace "$ROLLBACK_RELEASE" "$APP_PREVIOUS"',
    'atomic_symlink_replace "$CANDIDATE_RELEASE" "$APP_CURRENT"'
  ]);
  assert.match(service, /WorkingDirectory=\/var\/www\/laboratory-management-system\/current/);
  assert.match(service, /ExecStart=\/usr\/bin\/node \/var\/www\/laboratory-management-system\/current\/server\.js/);
});

test('health failure rolls code back but never pretends to roll the database back', () => {
  assert.match(deploy, /rollback_application_release/);
  assert.match(deploy, /atomic_symlink_replace "\$ROLLBACK_RELEASE" "\$APP_CURRENT"/);
  assert.match(deploy, /Database changes were NOT rolled back automatically/);
  assert.doesNotMatch(deploy, /(?:pg_restore|psql)[^\n]*(?:ROLLBACK_RELEASE|rollback_application_release)/i);
});

test('normal prepare mode never stops services or removes nginx configuration', () => {
  const branch = prepare.match(/if \[ "\$RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA" = '1' \]; then([\s\S]*?)else([\s\S]*?)fi/);
  assert.ok(branch, 'destructive prepare branch should be explicit');
  assert.match(branch[1], /stop_old_services/);
  assert.match(branch[1], /cleanup_nginx_defaults/);
  assert.doesNotMatch(branch[2], /stop_old_services|cleanup_nginx_defaults|reset_data_if_requested/);
  assert.match(prepare, /RESET_LABORATORY_MANAGEMENT_SYSTEM_DATA must be 0 or 1/);
});

test('persistent data paths cannot overlap release links, release storage, or APK storage', () => {
  for (const protectedPath of [
    '$APP_CURRENT',
    '$APP_BASE/previous',
    '$APP_BASE/releases',
    '$APP_BASE/downloads',
    '$APP_BASE/shared'
  ]) {
    assert.ok(common.includes(`readlink -m -- "${protectedPath}"`), `missing protected path: ${protectedPath}`);
  }
  assert.match(common, /must not overlap release, download, source, or shared-secret directories/);
});

test('fault injection model restores old code after candidate health failure without undoing migration', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vps-release-fault-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const current = path.join(dir, 'current.pointer');
  const previous = path.join(dir, 'previous.pointer');
  const database = path.join(dir, 'database.version');
  fs.writeFileSync(current, 'release-old');
  fs.writeFileSync(database, 'schema-v1');

  const replacePointer = (file, value) => {
    const temporary = `${file}.temporary`;
    fs.writeFileSync(temporary, value);
    fs.renameSync(temporary, file);
  };

  // Candidate is built and its backup is verified while release-old is still current.
  assert.equal(fs.readFileSync(current, 'utf8'), 'release-old');
  fs.writeFileSync(database, 'schema-v2'); // forward migration is intentionally not reversible here
  replacePointer(previous, fs.readFileSync(current, 'utf8'));
  replacePointer(current, 'release-candidate');

  const injectedHealthCheckSucceeded = false;
  if (!injectedHealthCheckSucceeded) {
    replacePointer(current, fs.readFileSync(previous, 'utf8'));
  }

  assert.equal(fs.readFileSync(current, 'utf8'), 'release-old');
  assert.equal(fs.readFileSync(previous, 'utf8'), 'release-old');
  assert.equal(fs.readFileSync(database, 'utf8'), 'schema-v2');
});

test('atomic symlink helper survives an injected health failure in a real bash filesystem', (t) => {
  const probe = spawnSync('bash', ['--version'], { encoding: 'utf8', windowsHide: true });
  if (probe.error || probe.status !== 0) {
    t.skip('bash is not available on this host');
    return;
  }
  const script = String.raw`
set -euo pipefail
source deploy/vps-common.sh
base="$(mktemp -d)"
trap 'rm -rf -- "$base"' EXIT
mkdir -p "$base/releases/old" "$base/releases/candidate"
atomic_symlink_replace "$base/releases/old" "$base/current"
atomic_symlink_replace "$base/releases/old" "$base/previous"
atomic_symlink_replace "$base/releases/candidate" "$base/current"
# Inject /ready failure after activation and perform the same code-only rollback.
health_ok=0
if [ "$health_ok" != 1 ]; then
  atomic_symlink_replace "$(readlink -f "$base/previous")" "$base/current"
fi
[ "$(readlink -f "$base/current")" = "$base/releases/old" ]
[ "$(readlink -f "$base/previous")" = "$base/releases/old" ]
`;
  const result = spawnSync('bash', ['-s'], {
    cwd: root,
    encoding: 'utf8',
    input: script,
    windowsHide: true
  });
  assert.equal(result.status, 0, `${result.stdout || ''}\n${result.stderr || ''}`);
});

test('VPS host normalization and public-IP checks reject reserved addresses', (t) => {
  const probe = spawnSync('bash', ['--version'], { encoding: 'utf8', windowsHide: true });
  if (probe.error || probe.status !== 0) {
    t.skip('bash is not available on this host');
    return;
  }
  const script = String.raw`
set -euo pipefail
source deploy/vps-common.sh
[ "$(normalize_host 'HTTPS://LAB.Example.COM./v5/')" = 'lab.example.com' ]
for address in 10.0.0.1 100.64.0.1 192.0.2.1 198.18.0.1 198.51.100.1 203.0.113.1 224.0.0.1 255.255.255.255; do
  is_non_public_ipv4 "$address"
done
! is_non_public_ipv4 8.8.8.8
`;
  const result = spawnSync('bash', ['-s'], {
    cwd: root,
    encoding: 'utf8',
    input: script,
    windowsHide: true
  });
  assert.equal(result.status, 0, `${result.stdout || ''}\n${result.stderr || ''}`);
});
